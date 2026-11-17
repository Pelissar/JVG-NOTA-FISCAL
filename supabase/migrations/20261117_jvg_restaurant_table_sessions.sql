-- Track service sessions independently from whether a table's QR is enabled.
alter table public.jvg_restaurant_tables
  add column if not exists service_status text not null default 'closed',
  add column if not exists opened_at timestamptz,
  add column if not exists closed_at timestamptz;

alter table public.jvg_restaurant_tables
  drop constraint if exists jvg_restaurant_tables_service_status_check;
alter table public.jvg_restaurant_tables
  add constraint jvg_restaurant_tables_service_status_check
  check (service_status in ('open', 'closed'));

create or replace function public.jvg_restaurant_set_table_status(
  p_tenant_id uuid,
  p_company_id uuid,
  p_table_id uuid,
  p_status text
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  v_status text;
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao restrita ao servidor' using errcode = '42501';
  end if;
  if p_status not in ('open', 'closed') then raise exception 'Situacao de mesa invalida'; end if;
  select service_status into v_status
  from public.jvg_restaurant_tables
  where id = p_table_id and tenant_id = p_tenant_id and company_id = p_company_id and active
  for update;
  if v_status is null then return false; end if;
  if v_status = p_status then return true; end if;
  if p_status = 'closed' and exists (
    select 1 from public.jvg_restaurant_orders
    where tenant_id = p_tenant_id and company_id = p_company_id and table_id = p_table_id
      and status not in ('delivered', 'cancelled')
  ) then raise exception 'Finalize ou cancele os pedidos antes de fechar a mesa'; end if;
  update public.jvg_restaurant_tables
  set service_status = p_status,
      opened_at = case when p_status = 'open' then now() else opened_at end,
      closed_at = case when p_status = 'closed' then now() else null end,
      updated_at = now()
  where id = p_table_id and tenant_id = p_tenant_id and company_id = p_company_id;
  return true;
end;
$$;

revoke all on function public.jvg_restaurant_set_table_status(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.jvg_restaurant_set_table_status(uuid, uuid, uuid, text)
  to service_role;
