-- Optional loyalty points, awarded once when a restaurant order is delivered.
alter table public.jvg_restaurant_settings
  add column if not exists loyalty_enabled boolean not null default false,
  add column if not exists loyalty_points_per_real numeric(8,4) not null default 1;
alter table public.jvg_restaurant_settings
  drop constraint if exists jvg_restaurant_settings_loyalty_points_per_real_check;
alter table public.jvg_restaurant_settings
  add constraint jvg_restaurant_settings_loyalty_points_per_real_check
  check (loyalty_points_per_real > 0 and loyalty_points_per_real <= 100);

alter table public.jvg_restaurant_customers
  add column if not exists loyalty_points integer not null default 0;
alter table public.jvg_restaurant_customers
  drop constraint if exists jvg_restaurant_customers_loyalty_points_check;
alter table public.jvg_restaurant_customers
  add constraint jvg_restaurant_customers_loyalty_points_check check (loyalty_points >= 0);

alter table public.jvg_restaurant_orders
  add column if not exists loyalty_awarded boolean not null default false;

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
