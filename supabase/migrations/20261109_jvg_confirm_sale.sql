-- JVG ERP: venda atomica com reserva por lock de produto e baixa de estoque.
-- Aplicar somente apos revisao e testes em ambiente isolado.
create or replace function public.jvg_confirm_sale(
  p_tenant_id uuid, p_company_id uuid, p_customer_id uuid,
  p_items jsonb, p_notes text default null
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_sale uuid;
  v_location uuid;
  v_item jsonb;
  v_product uuid;
  v_service uuid;
  v_qty numeric;
  v_price numeric;
  v_name text;
  v_unit text;
  v_stock numeric;
  v_tracks boolean;
  v_subtotal numeric(18,2) := 0;
  v_line numeric(18,2);
  v_count integer;
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao restrita ao servidor' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Itens invalidos';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count < 1 or v_count > 100 then raise exception 'Quantidade de itens invalida'; end if;
  if not exists (select 1 from public.jvg_companies where id=p_company_id and tenant_id=p_tenant_id and status <> 'inactive') then
    raise exception 'Empresa indisponivel';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.jvg_parties
    where id=p_customer_id and tenant_id=p_tenant_id and company_id=p_company_id
      and is_customer and active
  ) then raise exception 'Cliente indisponivel'; end if;
  select id into v_location from public.jvg_locations
    where tenant_id=p_tenant_id and company_id=p_company_id and code='PRINCIPAL' and active;
  if v_location is null then raise exception 'Deposito principal nao encontrado'; end if;

  -- Lock deterministico de todos os produtos antes de consultar saldos.
  perform id from public.jvg_products
    where tenant_id=p_tenant_id and company_id=p_company_id
      and id in (
        select (x->>'product_id')::uuid from jsonb_array_elements(p_items) x
        where x ? 'product_id' and x->>'product_id' is not null
      )
    order by id for update;

  insert into public.jvg_sales(tenant_id,company_id,customer_id,status,notes)
    values(p_tenant_id,p_company_id,p_customer_id,'draft',left(p_notes,2000))
    returning id into v_sale;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'Item invalido'; end if;
    v_product := nullif(v_item->>'product_id','')::uuid;
    v_service := nullif(v_item->>'service_id','')::uuid;
    if (v_product is null) = (v_service is null) then raise exception 'Informe produto ou servico'; end if;
    v_qty := (v_item->>'quantity')::numeric;
    v_price := (v_item->>'unit_price')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 999999 or
       v_price is null or v_price < 0 or v_price > 999999999 then
      raise exception 'Quantidade ou preco invalido';
    end if;
    if v_product is not null then
      select name,unit,tracks_stock into v_name,v_unit,v_tracks
        from public.jvg_products
        where id=v_product and tenant_id=p_tenant_id and company_id=p_company_id and active;
      if not found then raise exception 'Produto indisponivel'; end if;
      if v_tracks then
        select coalesce(sum(quantity_delta),0) into v_stock
          from public.jvg_inventory_movements
          where tenant_id=p_tenant_id and company_id=p_company_id and product_id=v_product;
        -- Inclui baixas anteriores nesta mesma transacao.
        if v_stock < v_qty then raise exception 'Estoque insuficiente para %',v_name; end if;
        insert into public.jvg_inventory_movements(
          tenant_id,company_id,product_id,location_id,sale_id,quantity_delta,movement_type,reason
        ) values (p_tenant_id,p_company_id,v_product,v_location,v_sale,-v_qty,'sale','Venda confirmada');
      end if;
    else
      select name,unit into v_name,v_unit from public.jvg_services
        where id=v_service and tenant_id=p_tenant_id and company_id=p_company_id and active;
      if not found then raise exception 'Servico indisponivel'; end if;
    end if;
    v_line := round(v_qty*v_price,2);
    v_subtotal := v_subtotal+v_line;
    insert into public.jvg_sale_items(
      tenant_id,company_id,sale_id,product_id,service_id,description_snapshot,
      unit_snapshot,quantity,unit_price,line_total
    ) values(p_tenant_id,p_company_id,v_sale,v_product,v_service,v_name,v_unit,v_qty,v_price,v_line);
  end loop;
  update public.jvg_sales set status='confirmed',subtotal=v_subtotal,total=v_subtotal,
    updated_at=now() where id=v_sale;
  return v_sale;
end;
$$;
revoke all on function public.jvg_confirm_sale(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.jvg_confirm_sale(uuid,uuid,uuid,jsonb,text) to service_role;
