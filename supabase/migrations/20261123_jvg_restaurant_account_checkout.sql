-- Attach QR table service requests to verified restaurant customers and provide
-- an atomic, payment-aware account close action for the staff console.

begin;

alter table public.jvg_restaurant_table_requests
  add column if not exists customer_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.jvg_restaurant_table_requests'::regclass
      and conname = 'jvg_restaurant_table_requests_customer_fk'
  ) then
    alter table public.jvg_restaurant_table_requests
      add constraint jvg_restaurant_table_requests_customer_fk
      foreign key (tenant_id, company_id, customer_id)
      references public.jvg_restaurant_customers(tenant_id, company_id, id)
      on delete set null (customer_id);
  end if;
end;
$$;

create index if not exists jvg_restaurant_table_requests_customer_idx
  on public.jvg_restaurant_table_requests(tenant_id, company_id, customer_id)
  where customer_id is not null;

create or replace function public.jvg_restaurant_create_table_request_with_customer(
  p_tenant_id uuid,
  p_company_id uuid,
  p_table_id uuid,
  p_request_type text,
  p_customer_id uuid default null
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
  if p_request_type = 'request_bill' and p_customer_id is null then
    raise exception 'Conclua seu cadastro antes de pedir a conta' using errcode = '22023';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.jvg_restaurant_customers c
    where c.tenant_id = p_tenant_id and c.company_id = p_company_id
      and c.id = p_customer_id and c.full_name <> '' and c.phone <> ''
      and c.cpf is not null
  ) then
    raise exception 'Cadastro do cliente incompleto para esta solicitacao' using errcode = '22023';
  end if;

  select t.active and t.service_status = 'open'
    into v_open
  from public.jvg_restaurant_tables t
  where t.tenant_id = p_tenant_id and t.company_id = p_company_id and t.id = p_table_id
  for update;
  if coalesce(v_open, false) is not true then
    raise exception 'Mesa fechada ou indisponivel' using errcode = 'P0002';
  end if;

  select * into v_request
  from public.jvg_restaurant_table_requests r
  where r.tenant_id = p_tenant_id and r.company_id = p_company_id
    and r.table_id = p_table_id and r.request_type = p_request_type and r.status = 'pending'
  limit 1
  for update;
  if v_request.id is not null then
    update public.jvg_restaurant_table_requests r
    set customer_id = coalesce(r.customer_id, p_customer_id), updated_at = now()
    where r.id = v_request.id
    returning * into v_request;
    return v_request;
  end if;

  insert into public.jvg_restaurant_table_requests(
    tenant_id, company_id, table_id, request_type, customer_id
  ) values (
    p_tenant_id, p_company_id, p_table_id, p_request_type, p_customer_id
  ) returning * into v_request;
  return v_request;
end;
$$;

revoke all on function public.jvg_restaurant_create_table_request_with_customer(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.jvg_restaurant_create_table_request_with_customer(uuid, uuid, uuid, text, uuid)
  to service_role;

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
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao restrita ao servidor' using errcode = '42501';
  end if;

  select t.service_status into v_status
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

-- Keep the existing manual table-close action from bypassing the account's
-- payment check.
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
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao restrita ao servidor' using errcode = '42501';
  end if;
  if p_status not in ('open', 'closed') then raise exception 'Situacao de mesa invalida'; end if;
  select t.service_status into v_status
  from public.jvg_restaurant_tables t
  where t.id = p_table_id and t.tenant_id = p_tenant_id and t.company_id = p_company_id and t.active
  for update;
  if v_status is null then return false; end if;
  if v_status = p_status then return true; end if;
  if p_status = 'closed' and exists (
    select 1 from public.jvg_restaurant_orders o
    where o.tenant_id = p_tenant_id and o.company_id = p_company_id and o.table_id = p_table_id
      and o.status not in ('delivered', 'cancelled')
  ) then
    raise exception 'Finalize ou cancele os pedidos antes de fechar a mesa' using errcode = '23514';
  end if;
  if p_status = 'closed' and exists (
    select 1 from public.jvg_restaurant_orders o
    where o.tenant_id = p_tenant_id and o.company_id = p_company_id and o.table_id = p_table_id
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

