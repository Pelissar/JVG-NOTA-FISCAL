-- Entrada de NF-e recebida: arquivo original, revisão por empresa e confirmação atômica de estoque.
create table public.jvg_inbound_nfe_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  supplier_party_id uuid,
  access_key text not null check (access_key ~ '^[A-Z0-9]{44}$'),
  invoice_number text not null,
  series text,
  issued_at timestamptz,
  issuer_document text not null,
  issuer_name text not null,
  destination_document text not null,
  authorization_status text not null check (authorization_status in ('100','150')),
  authorization_reason text,
  total_amount numeric(18,2) not null check (total_amount >= 0),
  status text not null default 'draft' check (status in ('draft','received')),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 500),
  xml_content text not null check (length(xml_content) <= 2000000),
  imported_by uuid references auth.users(id) on delete set null,
  received_by uuid references auth.users(id) on delete set null,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  unique (company_id, access_key),
  foreign key (tenant_id, company_id) references public.jvg_companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id, supplier_party_id)
    references public.jvg_parties(tenant_id, company_id, id) on delete restrict
);
create index jvg_inbound_nfe_company_date_idx
  on public.jvg_inbound_nfe_documents (company_id, created_at desc);

alter table public.jvg_inventory_movements
  add column inbound_nfe_id uuid,
  add column inbound_nfe_item_number integer;
alter table public.jvg_inventory_movements
  add constraint jvg_inventory_movements_inbound_nfe_fk
  foreign key (tenant_id, company_id, inbound_nfe_id)
  references public.jvg_inbound_nfe_documents(tenant_id, company_id, id) on delete restrict;
create unique index jvg_inventory_movements_inbound_nfe_line_uidx
  on public.jvg_inventory_movements (company_id, inbound_nfe_id, inbound_nfe_item_number)
  where inbound_nfe_id is not null;

alter table public.jvg_inbound_nfe_documents enable row level security;
create policy jvg_inbound_nfe_documents_select_member
  on public.jvg_inbound_nfe_documents for select to authenticated
  using (exists (
    select 1 from public.jvg_company_memberships cm
    where cm.tenant_id = jvg_inbound_nfe_documents.tenant_id
      and cm.company_id = jvg_inbound_nfe_documents.company_id
      and cm.user_id = (select auth.uid()) and cm.active
  ));
revoke all on public.jvg_inbound_nfe_documents from public, anon, authenticated;
grant select, insert, update on public.jvg_inbound_nfe_documents to service_role;
create function public.jvg_confirm_inbound_nfe(
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
