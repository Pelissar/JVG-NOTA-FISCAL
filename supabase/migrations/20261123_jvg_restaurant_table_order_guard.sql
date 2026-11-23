-- Serialize table orders with account closure and reject late QR orders.

begin;

create or replace function public.jvg_restaurant_require_open_table_order()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_open boolean;
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao restrita ao servidor' using errcode = '42501';
  end if;
  if new.table_id is null then return new; end if;

  select t.active and t.service_status = 'open'
    into v_open
  from public.jvg_restaurant_tables t
  where t.tenant_id = new.tenant_id and t.company_id = new.company_id and t.id = new.table_id
  for update;
  if coalesce(v_open, false) is not true then
    raise exception 'Esta mesa está fechada. Peça à equipe para reabri-la.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.jvg_restaurant_require_open_table_order()
  from public, anon, authenticated;
grant execute on function public.jvg_restaurant_require_open_table_order()
  to service_role;

drop trigger if exists jvg_restaurant_orders_require_open_table on public.jvg_restaurant_orders;
create trigger jvg_restaurant_orders_require_open_table
before insert on public.jvg_restaurant_orders
for each row execute function public.jvg_restaurant_require_open_table_order();

commit;
