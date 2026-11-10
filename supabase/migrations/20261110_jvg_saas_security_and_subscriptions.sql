-- SaaS boundary: the browser never talks to tenant tables directly.
-- Tenant operations go through authenticated server routes using service_role;
-- RLS remains an independent row filter if a restricted client role is granted later.

create table if not exists public.jvg_subscription_plans (
  code text primary key check (code ~ '^[a-z][a-z0-9_-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  billing_interval text not null default 'month' check (billing_interval in ('month','year')),
  amount_minor integer check (amount_minor is null or amount_minor >= 0),
  currency char(3) not null default 'BRL',
  max_users integer check (max_users is null or max_users > 0),
  max_companies integer check (max_companies is null or max_companies > 0),
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jvg_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.jvg_tenants(id) on delete restrict,
  plan_code text not null references public.jvg_subscription_plans(code) on delete restrict,
  status text not null default 'incomplete'
    check (status in ('trialing','active','past_due','paused','canceled','incomplete')),
  billing_provider text check (billing_provider is null or char_length(billing_provider) between 2 and 40),
  provider_customer_reference text,
  provider_subscription_reference text,
  current_period_started_at timestamptz,
  current_period_ends_at timestamptz,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_ends_at is null or current_period_started_at is null
    or current_period_ends_at > current_period_started_at)
);

create unique index if not exists jvg_subscriptions_provider_reference_uidx
  on public.jvg_subscriptions (billing_provider, provider_subscription_reference)
  where provider_subscription_reference is not null;
create index if not exists jvg_subscriptions_status_idx
  on public.jvg_subscriptions (status, current_period_ends_at);

alter table public.jvg_subscription_plans enable row level security;
alter table public.jvg_subscriptions enable row level security;
revoke all on public.jvg_subscription_plans from public, anon, authenticated;
revoke all on public.jvg_subscriptions from public, anon, authenticated;
grant all on public.jvg_subscription_plans, public.jvg_subscriptions to service_role;

insert into public.jvg_subscription_plans
  (code, name, billing_interval, amount_minor, currency, max_users, max_companies, features)
values
  ('pilot', 'Piloto', 'month', 0, 'BRL', null, null, '{"fiscal_environment":"homologacao"}'::jsonb)
on conflict (code) do nothing;

-- Existing companies continue operating under the pilot plan until the billing
-- provider and commercial plans are configured by the platform owner.
insert into public.jvg_subscriptions (tenant_id, plan_code, status, billing_provider)
select t.id, 'pilot', 'active', 'manual'
from public.jvg_tenants t
on conflict (tenant_id) do nothing;

create or replace function public.jvg_create_default_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $body$
begin
  insert into public.jvg_subscriptions (tenant_id, plan_code, status, billing_provider)
  values (new.id, 'pilot', 'trialing', 'manual')
  on conflict (tenant_id) do nothing;
  return new;
end;
$body$;

drop trigger if exists jvg_tenant_default_subscription on public.jvg_tenants;
create trigger jvg_tenant_default_subscription
  after insert on public.jvg_tenants
  for each row execute function public.jvg_create_default_subscription();

-- Resolve the user's active company in one database round-trip. This is a
-- server-only RPC because application routes use the private Supabase key.
create or replace function public.jvg_resolve_site_account(p_user_id uuid)
returns table (tenant_id uuid, company_id uuid, role text)
language plpgsql
stable
security invoker
set search_path = ''
as $body$
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao somente de servidor' using errcode = '42501';
  end if;

  return query
  select cm.tenant_id, cm.company_id, cm.role
  from public.jvg_company_memberships cm
  join public.jvg_tenant_memberships tm
    on tm.tenant_id = cm.tenant_id and tm.user_id = cm.user_id and tm.active
  join public.jvg_tenants t on t.id = cm.tenant_id and t.status in ('pilot','active')
  where cm.user_id = p_user_id and cm.active
  order by cm.created_at asc, cm.company_id asc
  limit 1;
end;
$body$;

-- Revoke broad default PostgREST grants. RLS does not protect TRUNCATE,
-- REFERENCES, or TRIGGER privileges, so client roles get no direct table access.
do $security$
declare
  obj record;
begin
  for obj in
    select c.relname, c.relkind
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname like 'jvg\_%' escape '\'
      and c.relkind in ('r','p')
  loop
    execute format('alter table public.%I enable row level security', obj.relname);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', obj.relname);
    execute format('grant all privileges on table public.%I to service_role', obj.relname);
  end loop;

  for obj in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname like 'jvg\_%' escape '\'
      and c.relkind = 'S'
  loop
    execute format('revoke all privileges on sequence public.%I from public, anon, authenticated', obj.relname);
    execute format('grant usage, select on sequence public.%I to service_role', obj.relname);
  end loop;

  -- Business tables receive an explicit company-membership read policy.
  -- Sensitive control-plane and idempotency tables remain server-only.
  for obj in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name like 'jvg\_%' escape '\'
      and c.table_name not in (
        'jvg_company_memberships', 'jvg_site_accounts', 'jvg_party_counters',
        'jvg_quote_counters', 'jvg_sale_requests'
      )
    group by c.table_name
    having bool_or(c.column_name = 'tenant_id') and bool_or(c.column_name = 'company_id')
  loop
    execute format('drop policy if exists jvg_saas_member_select on public.%I', obj.table_name);
    execute format(
      'create policy jvg_saas_member_select on public.%I for select to authenticated using (
         exists (
           select 1 from public.jvg_company_memberships cm
           where cm.tenant_id = %I.tenant_id
             and cm.company_id = %I.company_id
             and cm.user_id = (select auth.uid())
             and cm.active
         )
       )', obj.table_name, obj.table_name, obj.table_name
    );
  end loop;

  -- Membership rows are safe for authenticated users to read through their
  -- own-row RLS policies; business tables stay server-only by privilege.
  execute 'grant select on public.jvg_tenant_memberships, public.jvg_company_memberships to authenticated';

  -- All application RPCs are server-only; trigger execution is unaffected.
  for obj in
    select p.oid::pg_catalog.regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'jvg\_%' escape '\'
  loop
    execute format('revoke all privileges on function %s from public, anon, authenticated', obj.signature);
    execute format('grant execute on function %s to service_role', obj.signature);
  end loop;
end;
$security$;

-- Make future objects private by default for the migration owner as well.
alter default privileges in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

revoke all privileges on function public.jvg_create_default_subscription() from public, anon, authenticated;
grant execute on function public.jvg_create_default_subscription() to service_role;
