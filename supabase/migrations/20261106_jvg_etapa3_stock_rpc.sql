-- Movimentacao de estoque serializada por produto e protegida no backend.
create function public.jvg_adjust_stock(
  p_tenant_id uuid,
  p_company_id uuid,
  p_product_id uuid,
  p_delta numeric,
  p_reason text
)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $body$
declare
  v_product_id uuid;
  v_location_id uuid;
  v_balance numeric;
  v_next numeric;
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao somente de servidor' using errcode = '42501';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 999999999 then
    raise exception 'Quantidade invalida';
  end if;
  if length(trim(coalesce(p_reason, ''))) not between 3 and 120 then
    raise exception 'Motivo invalido';
  end if;

  -- O lock do produto torna o saldo consistente mesmo com requisicoes paralelas.
  select id into v_product_id
  from public.jvg_products
  where tenant_id = p_tenant_id and company_id = p_company_id and id = p_product_id
    and active = true and tracks_stock = true
  for update;
  if not found then raise exception 'Produto indisponivel'; end if;

  select id into v_location_id from public.jvg_locations
  where tenant_id = p_tenant_id and company_id = p_company_id and code = 'PRINCIPAL' and active = true;
  if not found then raise exception 'Deposito principal nao localizado'; end if;

  select coalesce(sum(quantity_delta), 0) into v_balance
  from public.jvg_inventory_movements
  where tenant_id = p_tenant_id and company_id = p_company_id and product_id = p_product_id;
  v_next := v_balance + p_delta;
  if v_next < 0 then raise exception 'Saldo insuficiente'; end if;

  insert into public.jvg_inventory_movements (
    tenant_id, company_id, product_id, location_id, quantity_delta, movement_type, reason
  ) values (
    p_tenant_id, p_company_id, p_product_id, v_location_id, p_delta, 'adjustment', trim(p_reason)
  );
  return v_next;
end;
$body$;

revoke all on function public.jvg_adjust_stock(uuid,uuid,uuid,numeric,text) from public, anon, authenticated;
grant execute on function public.jvg_adjust_stock(uuid,uuid,uuid,numeric,text) to service_role;
