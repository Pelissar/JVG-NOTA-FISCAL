-- Login de técnico, confirmação exclusiva da OS e numeração de 0 a 10000 por empresa.

do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'jvg_company_memberships'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%role%';
  if constraint_name is not null then
    execute format('alter table public.jvg_company_memberships drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.jvg_company_memberships
  add constraint jvg_company_memberships_role_check
  check (role in ('owner', 'admin', 'manager', 'operator', 'viewer', 'technician'));

alter table public.jvg_service_orders
  add column if not exists claimed_by uuid,
  add column if not exists claimed_at timestamptz;

grant delete on public.jvg_service_orders to service_role;

create table if not exists public.jvg_service_order_counters (
  tenant_id uuid not null,
  company_id uuid not null,
  next_number integer not null check (next_number >= 0 and next_number <= 10001),
  primary key (tenant_id, company_id)
);

create table if not exists public.jvg_company_technicians (
  tenant_id uuid not null,
  company_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 80),
  email text not null check (email = lower(trim(email)) and char_length(email) between 5 and 254),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id),
  unique (company_id, email)
);

alter table public.jvg_service_order_counters enable row level security;
alter table public.jvg_company_technicians enable row level security;
revoke all on public.jvg_service_order_counters from public, anon, authenticated;
revoke all on public.jvg_company_technicians from public, anon, authenticated;
grant all on public.jvg_service_order_counters, public.jvg_company_technicians to service_role;

create or replace function public.jvg_allocate_service_order_number(p_tenant_id uuid, p_company_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  allocated integer;
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao restrita ao servidor' using errcode = '42501';
  end if;

  insert into public.jvg_service_order_counters (tenant_id, company_id, next_number)
  select p_tenant_id, p_company_id, coalesce(max(os_number), -1) + 1
  from public.jvg_service_orders
  where tenant_id = p_tenant_id and company_id = p_company_id
  on conflict (tenant_id, company_id) do nothing;

  update public.jvg_service_order_counters
     set next_number = next_number + 1
   where tenant_id = p_tenant_id
     and company_id = p_company_id
     and next_number <= 10000
  returning next_number - 1 into allocated;

  if allocated is null then
    raise exception 'Numeracao de OS esgotada nesta empresa' using errcode = '23514';
  end if;
  return allocated;
end;
$$;

revoke all on function public.jvg_allocate_service_order_number(uuid, uuid) from public, anon, authenticated;
grant execute on function public.jvg_allocate_service_order_number(uuid, uuid) to service_role;
