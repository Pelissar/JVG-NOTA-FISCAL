-- Cancelar uma entrada no ERP sem apagar o XML fiscal ou perder a trilha do estoque.
-- Para entradas já recebidas, grava movimentos inversos e só permite estorno
-- quando o saldo atual de cada produto/local comporta a devolução.
do $migration$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.jvg_inbound_nfe_documents'::regclass
      and contype = 'c'
      and pg_catalog.pg_get_constraintdef(oid) ilike '%draft%'
      and pg_catalog.pg_get_constraintdef(oid) ilike '%received%'
  loop
    execute format('alter table public.jvg_inbound_nfe_documents drop constraint %I', v_constraint.conname);
  end loop;
end;
$migration$;

alter table public.jvg_inbound_nfe_documents
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_from_status text;

do $migration$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.jvg_inbound_nfe_documents'::regclass
      and conname = 'jvg_inbound_nfe_documents_status_allowed_check'
  ) then
    alter table public.jvg_inbound_nfe_documents
      add constraint jvg_inbound_nfe_documents_status_allowed_check
      check (status in ('draft', 'received', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.jvg_inbound_nfe_documents'::regclass
      and conname = 'jvg_inbound_nfe_documents_cancelled_metadata_check'
  ) then
    alter table public.jvg_inbound_nfe_documents
      add constraint jvg_inbound_nfe_documents_cancelled_metadata_check
      check (
        status <> 'cancelled'
        or (
          cancelled_at is not null
          and cancelled_from_status in ('draft', 'received')
          and char_length(btrim(coalesce(cancellation_reason, ''))) between 5 and 500
        )
      );
  end if;
end;
$migration$;

alter table public.jvg_inventory_movements
  add column if not exists reversal_of_movement_id uuid;

do $migration$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.jvg_inventory_movements'::regclass
      and conname = 'jvg_inventory_movements_reversal_fk'
  ) then
    alter table public.jvg_inventory_movements
      add constraint jvg_inventory_movements_reversal_fk
      foreign key (reversal_of_movement_id)
      references public.jvg_inventory_movements(id) on delete restrict;
  end if;
end;
$migration$;

create unique index if not exists jvg_inventory_movements_reversal_once_uidx
  on public.jvg_inventory_movements (reversal_of_movement_id)
  where reversal_of_movement_id is not null;

create or replace function public.jvg_cancel_inbound_nfe(
  p_tenant_id uuid,
  p_company_id uuid,
  p_document_id uuid,
  p_actor_user_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $body$
declare
  v_doc public.jvg_inbound_nfe_documents%rowtype;
  v_move public.jvg_inventory_movements%rowtype;
  v_balance numeric;
  v_reversed integer := 0;
  v_reason text;
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao somente de servidor' using errcode = '42501';
  end if;
  if p_actor_user_id is null then
    raise exception 'Usuario responsavel nao informado';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'Informe um motivo de cancelamento entre 5 e 500 caracteres';
  end if;

  select * into v_doc
  from public.jvg_inbound_nfe_documents
  where tenant_id = p_tenant_id and company_id = p_company_id and id = p_document_id
  for update;
  if not found then raise exception 'Documento nao encontrado nesta empresa'; end if;
  if v_doc.status = 'cancelled' then
    return jsonb_build_object('cancelled', true, 'alreadyCancelled', true, 'reversedLines', 0);
  end if;
  if v_doc.status not in ('draft', 'received') then
    raise exception 'Somente rascunhos ou entradas recebidas podem ser cancelados';
  end if;
  if v_doc.status = 'draft' and exists (
    select 1 from public.jvg_inventory_movements
    where tenant_id = p_tenant_id and company_id = p_company_id and inbound_nfe_id = p_document_id
  ) then
    raise exception 'Rascunho inconsistente: existem movimentos de estoque vinculados';
  end if;

  for v_move in
    select *
    from public.jvg_inventory_movements
    where tenant_id = p_tenant_id
      and company_id = p_company_id
      and inbound_nfe_id = p_document_id
    order by product_id, location_id, id
    for update
  loop
    if v_move.movement_type <> 'purchase' or v_move.quantity_delta <= 0 then
      raise exception 'A entrada possui movimento incompatível e precisa de revisão manual';
    end if;
    if exists (
      select 1 from public.jvg_inventory_movements
      where reversal_of_movement_id = v_move.id
    ) then
      raise exception 'Este movimento já possui estorno registrado';
    end if;

    perform 1
    from public.jvg_products
    where tenant_id = p_tenant_id and company_id = p_company_id and id = v_move.product_id
    for update;
    if not found then raise exception 'Produto do movimento não pertence a esta empresa'; end if;

    select coalesce(sum(quantity_delta), 0)
      into v_balance
    from public.jvg_inventory_movements
    where tenant_id = p_tenant_id
      and company_id = p_company_id
      and product_id = v_move.product_id
      and location_id = v_move.location_id;
    if v_balance < v_move.quantity_delta then
      raise exception 'Não é possível estornar: o saldo atual não comporta a devolução deste item. Confira saídas e ajustes antes de cancelar.';
    end if;

    insert into public.jvg_inventory_movements (
      tenant_id, company_id, product_id, location_id,
      quantity_delta, movement_type, reason, created_by, reversal_of_movement_id
    ) values (
      p_tenant_id, p_company_id, v_move.product_id, v_move.location_id,
      -v_move.quantity_delta, 'adjustment',
      'Estorno de entrada NF-e ' || v_doc.invoice_number || ' · ' || v_doc.access_key || ' · ' || left(v_reason, 300),
      p_actor_user_id, v_move.id
    );
    v_reversed := v_reversed + 1;
  end loop;

  update public.jvg_inbound_nfe_documents
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = p_actor_user_id,
      cancellation_reason = v_reason,
      cancelled_from_status = v_doc.status,
      updated_at = now()
  where tenant_id = p_tenant_id and company_id = p_company_id and id = v_doc.id;

  insert into public.jvg_audit_events (
    tenant_id, company_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_tenant_id, p_company_id, p_actor_user_id, 'inbound_nfe_receipt_cancelled',
    'inbound_nfe', v_doc.id,
    jsonb_build_object(
      'accessKey', v_doc.access_key,
      'invoiceNumber', v_doc.invoice_number,
      'sourceStatus', v_doc.status,
      'reversedLines', v_reversed,
      'reason', v_reason,
      'sourceNfePreserved', true
    )
  );

  return jsonb_build_object(
    'cancelled', true,
    'sourceStatus', v_doc.status,
    'reversedLines', v_reversed,
    'sourceNfePreserved', true
  );
end;
$body$;

create or replace function public.jvg_reopen_cancelled_inbound_nfe(
  p_tenant_id uuid,
  p_company_id uuid,
  p_document_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $body$
declare
  v_doc public.jvg_inbound_nfe_documents%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao somente de servidor' using errcode = '42501';
  end if;
  if p_actor_user_id is null then
    raise exception 'Usuario responsavel nao informado';
  end if;

  select * into v_doc
  from public.jvg_inbound_nfe_documents
  where tenant_id = p_tenant_id and company_id = p_company_id and id = p_document_id
  for update;
  if not found then raise exception 'Documento nao encontrado nesta empresa'; end if;
  if v_doc.status <> 'cancelled' or v_doc.cancelled_from_status <> 'draft' then
    raise exception 'Somente lançamento cancelado antes da entrada no estoque pode ser reaberto';
  end if;
  if exists (
    select 1 from public.jvg_inventory_movements
    where tenant_id = p_tenant_id and company_id = p_company_id and inbound_nfe_id = p_document_id
  ) then
    raise exception 'O lançamento possui movimentos de estoque e não pode ser reaberto como rascunho';
  end if;

  update public.jvg_inbound_nfe_documents
  set status = 'draft',
      cancelled_at = null,
      cancelled_by = null,
      cancellation_reason = null,
      cancelled_from_status = null,
      updated_at = now()
  where tenant_id = p_tenant_id and company_id = p_company_id and id = v_doc.id;

  insert into public.jvg_audit_events (
    tenant_id, company_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_tenant_id, p_company_id, p_actor_user_id, 'inbound_nfe_cancellation_reopened',
    'inbound_nfe', v_doc.id,
    jsonb_build_object('accessKey',v_doc.access_key,'invoiceNumber',v_doc.invoice_number)
  );

  return jsonb_build_object('reopened', true, 'stockMovements', 0);
end;
$body$;

revoke all on function public.jvg_cancel_inbound_nfe(uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.jvg_cancel_inbound_nfe(uuid,uuid,uuid,uuid,text) to service_role;
revoke all on function public.jvg_reopen_cancelled_inbound_nfe(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.jvg_reopen_cancelled_inbound_nfe(uuid,uuid,uuid,uuid) to service_role;
