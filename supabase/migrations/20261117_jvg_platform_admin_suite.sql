-- SigmaFiscal platform administration, onboarding, billing ledger and public content.
-- All writes are performed by authenticated server routes using service_role.

alter table public.jvg_companies
  add column if not exists business_type text not null default 'comercio';
alter table public.jvg_companies
  drop constraint if exists jvg_companies_business_type_check;
alter table public.jvg_companies
  add constraint jvg_companies_business_type_check
  check (business_type in (
    'comercio','restaurante','mercado','farmacia','distribuidora','industria',
    'logistica','tecnologia','assistencia_tecnica','servicos','saude','construcao',
    'agronegocio','hotelaria','petshop','educacao','beleza','outros'
  ));

alter table public.jvg_subscription_plans
  add column if not exists description text not null default '',
  add column if not exists grace_period_days integer not null default 15,
  add column if not exists is_public boolean not null default false,
  add column if not exists sort_order integer not null default 100,
  add column if not exists enabled_business_types text[] not null default array[
    'comercio','restaurante','mercado','farmacia','distribuidora','industria',
    'logistica','tecnologia','assistencia_tecnica','servicos','saude','construcao',
    'agronegocio','hotelaria','petshop','educacao','beleza','outros'
  ]::text[];

alter table public.jvg_subscription_plans
  drop constraint if exists jvg_subscription_plans_grace_period_days_check;
alter table public.jvg_subscription_plans
  add constraint jvg_subscription_plans_grace_period_days_check
  check (grace_period_days between 0 and 60);

alter table public.jvg_subscriptions
  add column if not exists temporary_access_until timestamptz,
  add column if not exists past_due_since timestamptz;

-- Additional profiles are stored distinctly. The application maps them to safe
-- permissions (commercial -> operator; accounting -> read-only) at the server.
alter table public.jvg_company_memberships
  drop constraint if exists jvg_company_memberships_role_check;
alter table public.jvg_company_memberships
  add constraint jvg_company_memberships_role_check
  check (role in ('owner','admin','manager','operator','viewer','technician','commercial','accounting'));

create table if not exists public.jvg_onboarding_requests (
  id uuid primary key default gen_random_uuid(),
  case_code text not null unique check (char_length(case_code) between 8 and 32),
  company_name text not null check (char_length(btrim(company_name)) between 2 and 160),
  contact_name text not null check (char_length(btrim(contact_name)) between 2 and 120),
  email text not null check (char_length(email) between 5 and 254),
  cnpj text not null check (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  phone text not null check (phone ~ '^[0-9]{10,13}$'),
  business_type text not null check (business_type in (
    'comercio','restaurante','mercado','farmacia','distribuidora','industria',
    'logistica','tecnologia','assistencia_tecnica','servicos','saude','construcao',
    'agronegocio','hotelaria','petshop','educacao','beleza','outros'
  )),
  message text not null default '' check (char_length(message) <= 2000),
  status text not null default 'new' check (status in ('new','contacted','approved','closed')),
  admin_note text not null default '' check (char_length(admin_note) <= 2000),
  linked_company_id uuid references public.jvg_companies(id) on delete set null,
  contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jvg_onboarding_requests_status_idx
  on public.jvg_onboarding_requests(status, created_at desc);
create index if not exists jvg_onboarding_requests_cnpj_idx
  on public.jvg_onboarding_requests(cnpj, created_at desc);

create table if not exists public.jvg_billing_charges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.jvg_tenants(id) on delete restrict,
  company_id uuid references public.jvg_companies(id) on delete restrict,
  subscription_id uuid references public.jvg_subscriptions(id) on delete restrict,
  description text not null check (char_length(btrim(description)) between 2 and 180),
  amount_minor integer not null check (amount_minor > 0),
  currency char(3) not null default 'BRL',
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open','payment_reported','paid','overdue','canceled')),
  payment_method text not null check (payment_method in ('boleto','pix','manual')),
  boleto_url text,
  boleto_line text,
  pix_copy_paste text,
  pix_qr_url text,
  provider_reference text,
  payment_reported_at timestamptz,
  temporary_access_until timestamptz,
  paid_at timestamptz,
  admin_note text not null default '' check (char_length(admin_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider_reference)
);
create index if not exists jvg_billing_charges_tenant_due_idx
  on public.jvg_billing_charges(tenant_id, due_at desc, created_at desc);
create index if not exists jvg_billing_charges_status_due_idx
  on public.jvg_billing_charges(status, due_at);

create table if not exists public.jvg_platform_content (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('changelog','article')),
  slug text not null unique check (slug ~ '^([a-z0-9]+)(-[a-z0-9]+)*$'),
  title text not null check (char_length(btrim(title)) between 3 and 180),
  summary text not null default '' check (char_length(summary) <= 500),
  body text not null default '' check (char_length(body) <= 30000),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  author_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jvg_platform_content_public_idx
  on public.jvg_platform_content(content_type, published_at desc)
  where status = 'published';

create table if not exists public.jvg_company_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.jvg_tenants(id) on delete restrict,
  company_id uuid not null references public.jvg_companies(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  email text not null check (email = lower(trim(email)) and char_length(email) between 5 and 254),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  role text not null check (role in ('technician','commercial','accounting')),
  status text not null default 'invited' check (status in ('invited','active','revoked')),
  invited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, email)
);
create index if not exists jvg_company_invites_company_idx
  on public.jvg_company_invites(tenant_id, company_id, created_at desc);

create table if not exists public.jvg_platform_audit_log (
  id bigint generated always as identity primary key,
  admin_user_id uuid references auth.users(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 2 and 80),
  entity_type text not null check (char_length(entity_type) between 2 and 80),
  entity_id text not null check (char_length(entity_id) between 1 and 100),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists jvg_platform_audit_log_recent_idx
  on public.jvg_platform_audit_log(created_at desc);

alter table public.jvg_onboarding_requests enable row level security;
alter table public.jvg_billing_charges enable row level security;
alter table public.jvg_platform_content enable row level security;
alter table public.jvg_company_invites enable row level security;
alter table public.jvg_platform_audit_log enable row level security;

revoke all on public.jvg_onboarding_requests, public.jvg_billing_charges,
  public.jvg_platform_content, public.jvg_company_invites,
  public.jvg_platform_audit_log from public, anon, authenticated;
grant all on public.jvg_onboarding_requests, public.jvg_billing_charges,
  public.jvg_platform_content, public.jvg_company_invites,
  public.jvg_platform_audit_log to service_role;
grant usage, select on sequence public.jvg_platform_audit_log_id_seq to service_role;

-- Billing pages must remain reachable after the tenant was suspended.
create or replace function public.jvg_resolve_billing_account(p_user_id uuid)
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
  where cm.user_id = p_user_id and cm.active
  order by cm.created_at asc, cm.company_id asc
  limit 1;
end;
$body$;
revoke all on function public.jvg_resolve_billing_account(uuid) from public, anon, authenticated;
grant execute on function public.jvg_resolve_billing_account(uuid) to service_role;
