-- Limit account totals and close checks to the current table service session.
-- Historical orders from previous openings must not be shown or block reuse.

begin;

create or replace function public.jvg_restaurant_close_table_account(
  p_tenant_id uuid,
  p_company_id uuid,
  p_table_id uuid,
  p_request_id uuid
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_opened_at timestamptz;
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao restrita ao servidor' using errcode = '42501';
  end if;

  select t.service_status, t.opened_at into v_status, v_opened_at
  from public.jvg_restaurant_tables t
  where t.tenant_id = p_tenant_id and t.company_id = p_company_id
    and t.id = p_table_id and t.active
  for update;
  if v_status is null then return false; end if;
  if v_status <> 'open' then
    raise exception 'A mesa ja esta fechada' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.jvg_restaurant_table_requests r
    where r.tenant_id = p_tenant_id and r.company_id = p_company_id
      and r.table_id = p_table_id and r.id = p_request_id
      and r.request_type = 'request_bill' and r.status = 'pending'
  ) then
    raise exception 'Solicitacao de conta nao encontrada ou ja atendida' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.jvg_restaurant_orders o
    where o.tenant_id = p_tenant_id and o.company_id = p_company_id
      and o.table_id = p_table_id
      and (v_opened_at is null or o.created_at >= v_opened_at)
      and (
        o.status not in ('delivered', 'cancelled')
        or (o.status = 'delivered' and o.payment_status <> 'paid')
      )
  ) then
    raise exception 'Finalize ou cancele os pedidos e registre no caixa os pagamentos antes de fechar a conta' using errcode = '23514';
  end if;

  update public.jvg_restaurant_tables t
  set service_status = 'closed', closed_at = now(), updated_at = now()
  where t.tenant_id = p_tenant_id and t.company_id = p_company_id and t.id = p_table_id;
  update public.jvg_restaurant_table_requests r
  set status = 'attended', updated_at = now()
  where r.tenant_id = p_tenant_id and r.company_id = p_company_id
    and r.table_id = p_table_id and r.status = 'pending';
  return true;
end;
$$;

revoke all on function public.jvg_restaurant_close_table_account(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.jvg_restaurant_close_table_account(uuid, uuid, uuid, uuid)
  to service_role;

create or replace function public.jvg_restaurant_set_table_status(
  p_tenant_id uuid,
  p_company_id uuid,
  p_table_id uuid,
  p_status text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_opened_at timestamptz;
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao restrita ao servidor' using errcode = '42501';
  end if;
  if p_status not in ('open', 'closed') then raise exception 'Situacao de mesa invalida'; end if;
  select t.service_status, t.opened_at into v_status, v_opened_at
  from public.jvg_restaurant_tables t
  where t.id = p_table_id and t.tenant_id = p_tenant_id and t.company_id = p_company_id and t.active
  for update;
  if v_status is null then return false; end if;
  if v_status = p_status then return true; end if;
  if p_status = 'closed' and exists (
    select 1 from public.jvg_restaurant_orders o
    where o.tenant_id = p_tenant_id and o.company_id = p_company_id and o.table_id = p_table_id
      and (v_opened_at is null or o.created_at >= v_opened_at)
      and o.status not in ('delivered', 'cancelled')
  ) then
    raise exception 'Finalize ou cancele os pedidos antes de fechar a mesa' using errcode = '23514';
  end if;
  if p_status = 'closed' and exists (
    select 1 from public.jvg_restaurant_orders o
    where o.tenant_id = p_tenant_id and o.company_id = p_company_id and o.table_id = p_table_id
      and (v_opened_at is null or o.created_at >= v_opened_at)
      and o.status = 'delivered' and o.payment_status <> 'paid'
  ) then
    raise exception 'Registre no caixa os pagamentos antes de fechar a conta' using errcode = '23514';
  end if;
  update public.jvg_restaurant_tables t
  set service_status = p_status,
      opened_at = case when p_status = 'open' then now() else t.opened_at end,
      closed_at = case when p_status = 'closed' then now() else null end,
      updated_at = now()
  where t.id = p_table_id and t.tenant_id = p_tenant_id and t.company_id = p_company_id;
  if p_status = 'closed' then
    update public.jvg_restaurant_table_requests r
    set status = 'attended', updated_at = now()
    where r.tenant_id = p_tenant_id and r.company_id = p_company_id
      and r.table_id = p_table_id and r.status = 'pending';
  end if;
  return true;
end;
$$;

revoke all on function public.jvg_restaurant_set_table_status(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.jvg_restaurant_set_table_status(uuid, uuid, uuid, text)
  to service_role;

commit;
