-- Webhook Focus com aplicação atômica/idempotente e código nacional ISS do serviço.
-- Aplicar manualmente depois da revisao; verificar as colunas e RPC no projeto JVG NOTA FISCAL antes do deploy.

alter table public.jvg_services
  add column if not exists national_taxation_code text;

alter table public.jvg_companies
  add column if not exists nfse_series_homologacao text,
  add column if not exists nfse_next_number_homologacao bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'jvg_services_national_taxation_code_format'
      and conrelid = 'public.jvg_services'::regclass
  ) then
    alter table public.jvg_services
      add constraint jvg_services_national_taxation_code_format
      check (national_taxation_code is null or national_taxation_code ~ '^[0-9]{6}$');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'jvg_companies_nfse_homologation_sequence_format'
      and conrelid = 'public.jvg_companies'::regclass
  ) then
    alter table public.jvg_companies
      add constraint jvg_companies_nfse_homologation_sequence_format
      check (
        (nfse_series_homologacao is null or nfse_series_homologacao ~ '^[0-9]{1,5}$')
        and (nfse_next_number_homologacao is null or nfse_next_number_homologacao > 0)
      );
  end if;
end;
$$;

alter table public.jvg_fiscal_events
  add column if not exists provider_event_key text;

create unique index if not exists jvg_fiscal_events_provider_event_key_uidx
  on public.jvg_fiscal_events (company_id, provider_event_key);

create or replace function public.jvg_apply_focus_webhook(
  p_reference text,
  p_event_key text,
  p_reported_status text,
  p_internal_status text,
  p_event_type text,
  p_protocol text,
  p_access_key text,
  p_series text,
  p_document_number bigint,
  p_issued_at timestamptz,
  p_authorized_at timestamptz,
  p_xml_storage_path text,
  p_pdf_storage_path text,
  p_provider_response jsonb,
  p_event_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.jvg_fiscal_documents%rowtype;
  v_document_count integer;
  v_event_id uuid;
  v_effective_status text;
  v_previous_response jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Operacao restrita ao servidor' using errcode = '42501';
  end if;
  if p_reference is null or length(p_reference) not between 1 and 50
     or p_event_key is null or length(p_event_key) not between 1 and 100
     or p_internal_status is null
     or p_internal_status not in ('authorized','rejected','cancelled','denied','processing')
     or p_event_type is null
     or p_event_type not in ('authorization','cancellation','status_update','error') then
    raise exception 'Notificacao Focus invalida' using errcode = '22023';
  end if;

  select count(*) into v_document_count
    from public.jvg_fiscal_documents d
    where d.focus_reference = p_reference
      and d.environment = 'homologacao'
      and d.document_type in ('nfe','nfse');
  if v_document_count <> 1 then
    raise exception 'Referencia fiscal Focus inexistente ou ambigua' using errcode = 'P0002';
  end if;

  select * into strict v_document
    from public.jvg_fiscal_documents d
    where d.focus_reference = p_reference
      and d.environment = 'homologacao'
      and d.document_type in ('nfe','nfse')
    for update;

  insert into public.jvg_fiscal_events (
    tenant_id, company_id, fiscal_document_id, provider_event_key,
    event_type, status, protocol, event_payload
  ) values (
    v_document.tenant_id, v_document.company_id, v_document.id, p_event_key,
    p_event_type, left(coalesce(p_reported_status, p_internal_status), 40),
    nullif(left(coalesce(p_protocol, ''), 80), ''),
    coalesce(p_event_payload, '{}'::jsonb)
  ) on conflict (company_id, provider_event_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object(
      'ok', true, 'duplicate', true, 'documentId', v_document.id,
      'status', v_document.status, 'documentType', v_document.document_type
    );
  end if;

  v_effective_status := case
    when v_document.status = 'cancelled' then 'cancelled'
    when v_document.status in ('denied','rejected') then v_document.status
    when v_document.status = 'authorized' and p_internal_status <> 'cancelled' then 'authorized'
    else p_internal_status
  end;
  v_previous_response := case
    when jsonb_typeof(v_document.provider_response -> 'response') = 'object'
      then v_document.provider_response -> 'response'
    else '{}'::jsonb
  end;

  update public.jvg_fiscal_documents d set
    status = v_effective_status,
    access_key = coalesce(nullif(p_access_key, ''), d.access_key),
    series = coalesce(nullif(p_series, ''), d.series),
    document_number = coalesce(p_document_number, d.document_number),
    issued_at = coalesce(p_issued_at, d.issued_at),
    authorized_at = case
      when v_effective_status = 'authorized' then coalesce(p_authorized_at, d.authorized_at, now())
      else d.authorized_at
    end,
    xml_storage_path = coalesce(nullif(p_xml_storage_path, ''), d.xml_storage_path),
    pdf_storage_path = coalesce(nullif(p_pdf_storage_path, ''), d.pdf_storage_path),
    provider_response = jsonb_set(
      coalesce(d.provider_response, '{}'::jsonb) || jsonb_build_object(
        'operation', 'focus_webhook', 'phase', v_effective_status,
        'reference', p_reference, 'lastEventKey', p_event_key, 'observedAt', now()
      ),
      '{response}', v_previous_response || coalesce(p_provider_response, '{}'::jsonb), true
    ),
    updated_at = now()
  where d.id = v_document.id;

  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'documentId', v_document.id,
    'status', v_effective_status, 'documentType', v_document.document_type
  );
end;
$$;

revoke all on function public.jvg_apply_focus_webhook(
  text,text,text,text,text,text,text,text,bigint,timestamptz,timestamptz,text,text,jsonb,jsonb
) from public, anon, authenticated;
grant execute on function public.jvg_apply_focus_webhook(
  text,text,text,text,text,text,text,text,bigint,timestamptz,timestamptz,text,text,jsonb,jsonb
) to service_role;
