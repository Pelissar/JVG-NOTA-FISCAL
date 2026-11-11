-- Protege a entrada de NF-e contra confirmações sem movimento e permite reabrir somente recebimentos sem estoque.
create or replace function public.jvg_confirm_inbound_nfe(
  p_tenant_id uuid,
  p_company_id uuid,
  p_document_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $body$
declare
  v_doc public.jvg_inbound_nfe_documents%rowtype;
  v_item jsonb;
  v_item_number integer;
  v_product_id uuid;
  v_quantity numeric;
  v_location_id uuid;
  v_count integer := 0;
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao somente de servidor' using errcode = '42501';
  end if;

  select * into v_doc
  from public.jvg_inbound_nfe_documents
  where tenant_id = p_tenant_id and company_id = p_company_id and id = p_document_id
  for update;
  if not found then raise exception 'Documento nao encontrado nesta empresa'; end if;
  if v_doc.status = 'received' then
    return jsonb_build_object('received', true, 'alreadyReceived', true);
  end if;
  if v_doc.status <> 'draft' then raise exception 'Documento nao esta pendente'; end if;
  if v_doc.supplier_party_id is null then raise exception 'Selecione o fornecedor antes de receber a NF-e'; end if;

  select id into v_location_id from public.jvg_locations
  where tenant_id = p_tenant_id and company_id = p_company_id
    and code = 'PRINCIPAL' and active = true;
  if not found then raise exception 'Deposito principal nao localizado'; end if;

  for v_item in select value from jsonb_array_elements(v_doc.items)
  loop
    if coalesce((v_item->>'trackStock')::boolean, false) then
      if coalesce(v_item->>'productId','') = '' then raise exception 'Associe um produto a cada item que movimentara estoque'; end if;
      v_product_id := (v_item->>'productId')::uuid;
      v_item_number := (v_item->>'lineNumber')::integer;
      v_quantity := (v_item->>'quantity')::numeric;
      if v_item_number < 1 or v_quantity <= 0 then raise exception 'Item ou quantidade invalida'; end if;
      perform 1 from public.jvg_products
      where tenant_id = p_tenant_id and company_id = p_company_id
        and id = v_product_id and active = true and tracks_stock = true
      for update;
      if not found then raise exception 'Produto indisponivel para controle de estoque'; end if;

      insert into public.jvg_inventory_movements (
        tenant_id, company_id, product_id, location_id,
        quantity_delta, movement_type, reason, inbound_nfe_id, inbound_nfe_item_number
      ) values (
        p_tenant_id, p_company_id, v_product_id, v_location_id,
        v_quantity, 'purchase',
        'Entrada NF-e ' || v_doc.invoice_number || ' · ' || v_doc.access_key,
        v_doc.id, v_item_number
      );
      v_count := v_count + 1;
    end if;
  end loop;

  if v_count = 0 then
    raise exception 'Marque ao menos um item para lancar no estoque';
  end if;

  update public.jvg_inbound_nfe_documents
  set status = 'received', received_by = p_actor_user_id,
      received_at = now(), updated_at = now()
  where tenant_id = p_tenant_id and company_id = p_company_id and id = v_doc.id;

  insert into public.jvg_audit_events (
    tenant_id, company_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_tenant_id, p_company_id, p_actor_user_id, 'inbound_nfe_received',
    'inbound_nfe', v_doc.id,
    jsonb_build_object('accessKey',v_doc.access_key,'invoiceNumber',v_doc.invoice_number,'stockLines',v_count)
  );

  return jsonb_build_object('received', true, 'stockLines', v_count);
end;
$body$;
revoke all on function public.jvg_confirm_inbound_nfe(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.jvg_confirm_inbound_nfe(uuid,uuid,uuid,uuid) to service_role;

create or replace function public.jvg_reopen_empty_inbound_nfe(
  p_tenant_id uuid, p_company_id uuid, p_document_id uuid, p_actor_user_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $body$
declare
  v_doc public.jvg_inbound_nfe_documents%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao somente de servidor' using errcode = '42501';
  end if;
  select * into v_doc
  from public.jvg_inbound_nfe_documents
  where tenant_id = p_tenant_id and company_id = p_company_id and id = p_document_id
  for update;
  if not found then raise exception 'Documento nao encontrado nesta empresa'; end if;
  if v_doc.status <> 'received' then raise exception 'Documento nao esta recebido'; end if;
  if exists (
    select 1 from public.jvg_inventory_movements
    where tenant_id = p_tenant_id and company_id = p_company_id and inbound_nfe_id = p_document_id
  ) then raise exception 'A NF-e ja possui movimentos de estoque e nao pode ser reaberta por esta rotina'; end if;

  update public.jvg_inbound_nfe_documents
  set status = 'draft', received_by = null, received_at = null, updated_at = now()
  where tenant_id = p_tenant_id and company_id = p_company_id and id = p_document_id;

  insert into public.jvg_audit_events (tenant_id, company_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_tenant_id, p_company_id, p_actor_user_id, 'inbound_nfe_reopened',
    'inbound_nfe', p_document_id,
    jsonb_build_object('accessKey',v_doc.access_key,'invoiceNumber',v_doc.invoice_number,'reason','received_without_stock'));

  return jsonb_build_object('reopened', true, 'stockMovements', 0);
end;
$body$;
revoke all on function public.jvg_reopen_empty_inbound_nfe(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.jvg_reopen_empty_inbound_nfe(uuid,uuid,uuid,uuid) to service_role;
