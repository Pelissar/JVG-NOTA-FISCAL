-- Public restaurant websites, QR customer identity, table service requests,
-- and the separately entitled public ordering add-on.
-- Review and apply through the normal migration workflow; this file is not applied here.

begin;

alter table public.jvg_restaurant_settings
  add column if not exists public_slug text,
  add column if not exists website_enabled boolean not null default false,
  add column if not exists website_orders_enabled boolean not null default false,
  add column if not exists website_pickup_enabled boolean not null default false,
  add column if not exists public_contact_phone text,
  add column if not exists public_whatsapp text,
  add column if not exists public_email text,
  add column if not exists public_address text,
  add column if not exists public_map_url text,
  add column if not exists public_instagram_url text,
  add column if not exists public_website_url text;

alter table public.jvg_restaurant_settings
  drop constraint if exists jvg_restaurant_settings_public_slug_check;
alter table public.jvg_restaurant_settings
  add constraint jvg_restaurant_settings_public_slug_check
  check (
    public_slug is null or
    (public_slug = lower(public_slug) and public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(public_slug) between 3 and 60)
  );

create unique index if not exists jvg_restaurant_settings_public_slug_uidx
  on public.jvg_restaurant_settings(public_slug)
  where public_slug is not null;

alter table public.jvg_restaurant_customers
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
create unique index if not exists jvg_restaurant_customers_auth_user_uidx
  on public.jvg_restaurant_customers(tenant_id, company_id, auth_user_id)
  where auth_user_id is not null;

alter table public.jvg_restaurant_orders
  drop constraint if exists jvg_restaurant_orders_source_check;
alter table public.jvg_restaurant_orders
  add constraint jvg_restaurant_orders_source_check
  check (source in ('table', 'qr', 'counter', 'website'));
alter table public.jvg_restaurant_orders
  add column if not exists fulfillment_type text,
  add column if not exists payment_method text not null default 'cashier',
  add column if not exists payment_status text not null default 'pending',
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists payment_confirmed_by uuid references auth.users(id) on delete set null;
alter table public.jvg_restaurant_orders
  drop constraint if exists jvg_restaurant_orders_fulfillment_type_check;
alter table public.jvg_restaurant_orders
  add constraint jvg_restaurant_orders_fulfillment_type_check
  check (fulfillment_type is null or fulfillment_type in ('table', 'pickup'));
alter table public.jvg_restaurant_orders
  drop constraint if exists jvg_restaurant_orders_payment_method_check;
alter table public.jvg_restaurant_orders
  add constraint jvg_restaurant_orders_payment_method_check
  check (payment_method in ('cashier'));
alter table public.jvg_restaurant_orders
  drop constraint if exists jvg_restaurant_orders_payment_status_check;
alter table public.jvg_restaurant_orders
  add constraint jvg_restaurant_orders_payment_status_check
  check (payment_status in ('pending', 'paid', 'refunded'));

create table if not exists public.jvg_restaurant_table_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  table_id uuid not null,
  request_type text not null check (request_type in ('call_waiter', 'request_bill')),
  status text not null default 'pending' check (status in ('pending', 'attended', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, company_id)
    references public.jvg_companies(tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id, table_id)
    references public.jvg_restaurant_tables(tenant_id, company_id, id) on delete cascade
);
create unique index if not exists jvg_restaurant_table_requests_pending_uidx
  on public.jvg_restaurant_table_requests(tenant_id, company_id, table_id, request_type)
  where status = 'pending';
create index if not exists jvg_restaurant_table_requests_queue_idx
  on public.jvg_restaurant_table_requests(tenant_id, company_id, status, created_at);

alter table public.jvg_restaurant_table_requests enable row level security;
revoke all on public.jvg_restaurant_table_requests from public, anon, authenticated;
grant select, insert, update, delete on public.jvg_restaurant_table_requests to service_role;

create or replace function public.jvg_restaurant_create_table_request(
  p_tenant_id uuid,
  p_company_id uuid,
  p_table_id uuid,
  p_request_type text
) returns public.jvg_restaurant_table_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.jvg_restaurant_table_requests;
  v_open boolean;
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao restrita ao servidor' using errcode = '42501';
  end if;
  if p_request_type not in ('call_waiter', 'request_bill') then
    raise exception 'Solicitacao de mesa invalida' using errcode = '22023';
  end if;
  select active and service_status = 'open'
    into v_open
  from public.jvg_restaurant_tables
  where tenant_id = p_tenant_id and company_id = p_company_id and id = p_table_id
  for update;
  if coalesce(v_open, false) is not true then
    raise exception 'Mesa fechada ou indisponivel' using errcode = 'P0002';
  end if;
  select * into v_request
  from public.jvg_restaurant_table_requests
  where tenant_id = p_tenant_id and company_id = p_company_id
    and table_id = p_table_id and request_type = p_request_type and status = 'pending'
  limit 1;
  if v_request.id is not null then return v_request; end if;
  insert into public.jvg_restaurant_table_requests(tenant_id, company_id, table_id, request_type)
  values (p_tenant_id, p_company_id, p_table_id, p_request_type)
  returning * into v_request;
  return v_request;
end;
$$;
revoke all on function public.jvg_restaurant_create_table_request(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.jvg_restaurant_create_table_request(uuid, uuid, uuid, text)
  to service_role;

create or replace function public.jvg_restaurant_inventory_balances(
  p_tenant_id uuid,
  p_company_id uuid,
  p_product_ids uuid[]
) returns table(product_id uuid, quantity_on_hand numeric)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao restrita ao servidor' using errcode = '42501';
  end if;
  return query
    select requested.product_id, coalesce(sum(m.quantity_delta), 0)::numeric
    from (select distinct unnest(coalesce(p_product_ids, '{}'::uuid[])) as product_id) requested
    join public.jvg_products p
      on p.id = requested.product_id
     and p.tenant_id = p_tenant_id
     and p.company_id = p_company_id
     and p.active
     and p.tracks_stock
    left join public.jvg_inventory_movements m
      on m.product_id = p.id
     and m.tenant_id = p_tenant_id
     and m.company_id = p_company_id
    group by requested.product_id;
end;
$$;
revoke all on function public.jvg_restaurant_inventory_balances(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.jvg_restaurant_inventory_balances(uuid, uuid, uuid[])
  to service_role;

-- Extend the existing subscription module registry. Existing plans keep the
-- prior Restaurant entitlement for the new public website/QR capability.
alter table public.jvg_company_module_overrides
  drop constraint if exists jvg_company_module_overrides_module_key_check;
alter table public.jvg_company_module_overrides
  add constraint jvg_company_module_overrides_module_key_check
  check (module_key in (
    'core','cadastros','comercial','estoque','assistencia','fiscal_nfe','nfce',
    'contabilidade','restaurante','restaurante_online'
  ));

-- Preserve company-specific restaurant grants in the new site/QR capability.
insert into public.jvg_company_module_overrides(
  tenant_id, company_id, module_key, enabled, source, note, created_by, updated_by, created_at, updated_at
)
select tenant_id, company_id, 'restaurante_online', enabled, source, note, created_by, updated_by, created_at, updated_at
from public.jvg_company_module_overrides
where module_key = 'restaurante'
on conflict (company_id, module_key) do nothing;

update public.jvg_subscription_plans p
set features = jsonb_set(
  coalesce(p.features, '{}'::jsonb),
  '{modules}',
  (case when jsonb_typeof(p.features->'modules') = 'object' then p.features->'modules' else '{}'::jsonb end)
  || jsonb_build_object(
    'restaurante_online',
    coalesce(
      (case when jsonb_typeof(p.features->'modules') = 'object' then p.features->'modules' else '{}'::jsonb end)->'restaurante_online',
      to_jsonb(coalesce((p.features #>> '{modules,restaurante}')::boolean, false))
    )
  ),
  true
)
where p.features is null
   or jsonb_typeof(p.features->'modules') <> 'object'
   or not (p.features->'modules' ? 'restaurante_online');

commit;
