-- Restaurant MVP: table service, public QR orders and kitchen status board.
-- All access is mediated by server routes using the service role.

create table if not exists public.jvg_restaurant_settings (
  tenant_id uuid not null,
  company_id uuid not null,
  qr_orders_enabled boolean not null default false,
  loyalty_enabled boolean not null default false,
  loyalty_points_per_real numeric(8,4) not null default 1 check (loyalty_points_per_real > 0 and loyalty_points_per_real <= 100),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, company_id),
  foreign key (tenant_id, company_id)
    references public.jvg_companies(tenant_id, id) on delete cascade
);

create table if not exists public.jvg_restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  table_number integer not null check (table_number between 1 and 9999),
  label text not null check (char_length(btrim(label)) between 1 and 60),
  qr_token uuid not null unique default gen_random_uuid(),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  unique (tenant_id, company_id, table_number),
  foreign key (tenant_id, company_id)
    references public.jvg_companies(tenant_id, id) on delete cascade
);
create index if not exists jvg_restaurant_tables_company_idx
  on public.jvg_restaurant_tables(tenant_id, company_id, active, table_number);

create table if not exists public.jvg_restaurant_customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  phone text not null check (phone ~ '^[0-9]{10,13}$'),
  cpf text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  loyalty_points integer not null default 0 check (loyalty_points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  unique (tenant_id, company_id, phone),
  foreign key (tenant_id, company_id)
    references public.jvg_companies(tenant_id, id) on delete cascade
);
create unique index if not exists jvg_restaurant_customers_company_cpf_idx
  on public.jvg_restaurant_customers(tenant_id, company_id, cpf)
  where cpf is not null;
create index if not exists jvg_restaurant_customers_company_name_idx
  on public.jvg_restaurant_customers(tenant_id, company_id, full_name);

create table if not exists public.jvg_restaurant_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  order_number bigint generated always as identity,
  table_id uuid,
  customer_id uuid,
  source text not null check (source in ('table', 'qr', 'counter')),
  status text not null default 'open'
    check (status in ('open', 'sent_to_kitchen', 'preparing', 'ready', 'delivered', 'cancelled')),
  items jsonb not null
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 100),
  customer_name_snapshot text not null default '' check (char_length(customer_name_snapshot) <= 120),
  phone_snapshot text not null default '' check (char_length(phone_snapshot) <= 20),
  total numeric(18,2) not null check (total >= 0),
  notes text not null default '' check (char_length(notes) <= 1000),
  loyalty_awarded boolean not null default false,
  request_key uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  unique (tenant_id, company_id, request_key),
  foreign key (tenant_id, company_id)
    references public.jvg_companies(tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id, table_id)
    references public.jvg_restaurant_tables(tenant_id, company_id, id) on delete restrict,
  foreign key (tenant_id, company_id, customer_id)
    references public.jvg_restaurant_customers(tenant_id, company_id, id) on delete restrict
);
create index if not exists jvg_restaurant_orders_board_idx
  on public.jvg_restaurant_orders(tenant_id, company_id, status, created_at);
create index if not exists jvg_restaurant_orders_table_idx
  on public.jvg_restaurant_orders(tenant_id, company_id, table_id, created_at desc);
create index if not exists jvg_restaurant_orders_customer_idx
  on public.jvg_restaurant_orders(tenant_id, company_id, customer_id, created_at desc);

alter table public.jvg_restaurant_settings enable row level security;
alter table public.jvg_restaurant_tables enable row level security;
alter table public.jvg_restaurant_customers enable row level security;
alter table public.jvg_restaurant_orders enable row level security;
revoke all on public.jvg_restaurant_settings, public.jvg_restaurant_tables,
  public.jvg_restaurant_customers, public.jvg_restaurant_orders
  from public, anon, authenticated;
grant select, insert, update, delete on public.jvg_restaurant_settings,
  public.jvg_restaurant_tables, public.jvg_restaurant_customers,
  public.jvg_restaurant_orders to service_role;
grant usage, select on sequence public.jvg_restaurant_orders_order_number_seq to service_role;

create or replace function public.jvg_restaurant_set_order_status(
  p_tenant_id uuid,
  p_company_id uuid,
  p_order_id uuid,
  p_status text
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  v_status text;
  v_total numeric(18,2);
  v_customer_id uuid;
  v_loyalty_awarded boolean;
  v_points_rate numeric(8,4);
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao restrita ao servidor' using errcode = '42501';
  end if;
  if p_status not in ('sent_to_kitchen', 'preparing', 'ready', 'delivered', 'cancelled') then
    raise exception 'Situacao de pedido invalida';
  end if;
  select status, total, customer_id, loyalty_awarded
    into v_status, v_total, v_customer_id, v_loyalty_awarded
  from public.jvg_restaurant_orders
  where id = p_order_id and tenant_id = p_tenant_id and company_id = p_company_id
  for update;
  if v_status is null then return false; end if;
  if v_status = p_status then return true; end if;
  if not (
    (v_status = 'open' and p_status in ('sent_to_kitchen', 'cancelled')) or
    (v_status = 'sent_to_kitchen' and p_status in ('preparing', 'ready', 'cancelled')) or
    (v_status = 'preparing' and p_status in ('ready', 'cancelled')) or
    (v_status = 'ready' and p_status in ('delivered', 'cancelled'))
  ) then
    raise exception 'Transicao de situacao do pedido nao permitida';
  end if;
  update public.jvg_restaurant_orders
  set status = p_status, updated_at = now()
  where id = p_order_id and tenant_id = p_tenant_id and company_id = p_company_id;
  if p_status = 'delivered' and v_customer_id is not null and not v_loyalty_awarded then
    select loyalty_points_per_real into v_points_rate
    from public.jvg_restaurant_settings
    where tenant_id = p_tenant_id and company_id = p_company_id and loyalty_enabled;
    if v_points_rate is not null then
      update public.jvg_restaurant_customers
      set loyalty_points = loyalty_points + least(1000000, floor(v_total * v_points_rate)::integer), updated_at = now()
      where id = v_customer_id and tenant_id = p_tenant_id and company_id = p_company_id;
      update public.jvg_restaurant_orders
      set loyalty_awarded = true
      where id = p_order_id and tenant_id = p_tenant_id and company_id = p_company_id;
    end if;
  end if;
  return true;
end;
$$;
revoke all on function public.jvg_restaurant_set_order_status(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.jvg_restaurant_set_order_status(uuid, uuid, uuid, text)
  to service_role;
