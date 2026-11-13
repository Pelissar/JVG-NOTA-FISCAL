-- Histórico fiscal por empresa e vínculo de partes no recebimento de NF-e.
-- A migration é aditiva; não transmite notas nem altera numeração ou ambiente.

alter table public.jvg_inbound_nfe_documents
  add column fiscal_data jsonb not null default '{}'::jsonb,
  add column carrier_party_id uuid,
  add column carrier_document text,
  add column carrier_name text;

alter table public.jvg_inbound_nfe_documents
  add constraint jvg_inbound_nfe_carrier_party_fk
  foreign key (tenant_id, company_id, carrier_party_id)
  references public.jvg_parties(tenant_id, company_id, id) on delete restrict;

create index jvg_inbound_nfe_supplier_history_idx
  on public.jvg_inbound_nfe_documents (company_id, supplier_party_id, issued_at desc);
create index jvg_inbound_nfe_carrier_history_idx
  on public.jvg_inbound_nfe_documents (company_id, carrier_party_id, issued_at desc);

-- Cadastra como fornecedor os emitentes legados sem duplicar CNPJ/CPF já existente.
insert into public.jvg_parties (
  tenant_id, company_id, display_name, legal_name, document_type, document_number,
  is_customer, is_supplier, is_carrier, active
)
select distinct on (d.company_id, d.issuer_document)
  d.tenant_id, d.company_id, d.issuer_name, d.issuer_name,
  case when d.issuer_document ~ '^[0-9]{11}$' then 'cpf' else 'cnpj' end,
  d.issuer_document, false, true, false, true
from public.jvg_inbound_nfe_documents d
where d.supplier_party_id is null
  and (d.issuer_document ~ '^[0-9]{11}$' or d.issuer_document ~ '^[A-Z0-9]{12}[0-9]{2}$')
order by d.company_id, d.issuer_document, d.created_at
on conflict (company_id, document_type, document_number)
do update set is_supplier = true, updated_at = now();

update public.jvg_inbound_nfe_documents d
set supplier_party_id = p.id,
    updated_at = now()
from public.jvg_parties p
where d.supplier_party_id is null
  and p.tenant_id = d.tenant_id
  and p.company_id = d.company_id
  and p.document_number = d.issuer_document
  and p.document_type = case when d.issuer_document ~ '^[0-9]{11}$' then 'cpf' else 'cnpj' end;

alter table public.jvg_fiscal_documents
  add column recipient_party_id uuid,
  add column recipient_document text,
  add column carrier_party_id uuid,
  add column carrier_document text,
  add column carrier_name text;

alter table public.jvg_fiscal_documents
  add constraint jvg_fiscal_documents_recipient_party_fk
  foreign key (tenant_id, company_id, recipient_party_id)
  references public.jvg_parties(tenant_id, company_id, id) on delete restrict,
  add constraint jvg_fiscal_documents_carrier_party_fk
  foreign key (tenant_id, company_id, carrier_party_id)
  references public.jvg_parties(tenant_id, company_id, id) on delete restrict;

-- Recupera os vínculos dos rascunhos existentes a partir dos snapshots já persistidos.
with payload_parties as (
  select d.id, d.tenant_id, d.company_id,
    d.fiscal_payload #>> '{recipient,id}' as recipient_id,
    nullif(d.fiscal_payload #>> '{recipient,documentNumber}', '') as recipient_document,
    d.fiscal_payload #>> '{transport,carrier,id}' as carrier_id,
    nullif(d.fiscal_payload #>> '{transport,carrier,documentNumber}', '') as carrier_document,
    nullif(d.fiscal_payload #>> '{transport,carrier,name}', '') as carrier_name
  from public.jvg_fiscal_documents d
), valid_party_refs as (
  select pp.*,
    case when pp.recipient_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then pp.recipient_id::uuid else null end as recipient_uuid,
    case when pp.carrier_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then pp.carrier_id::uuid else null end as carrier_uuid
  from payload_parties pp
)
update public.jvg_fiscal_documents d
set recipient_party_id = case
      when pp.recipient_uuid is not null
        and exists (select 1 from public.jvg_parties p where p.id = pp.recipient_uuid and p.tenant_id = d.tenant_id and p.company_id = d.company_id)
      then pp.recipient_uuid else null end,
    recipient_document = coalesce(d.recipient_document, pp.recipient_document),
    carrier_party_id = case
      when pp.carrier_uuid is not null
        and exists (select 1 from public.jvg_parties p where p.id = pp.carrier_uuid and p.tenant_id = d.tenant_id and p.company_id = d.company_id)
      then pp.carrier_uuid else null end,
    carrier_document = coalesce(d.carrier_document, pp.carrier_document),
    carrier_name = coalesce(d.carrier_name, pp.carrier_name)
from valid_party_refs pp
where d.id = pp.id;

create index jvg_fiscal_documents_recipient_history_idx
  on public.jvg_fiscal_documents (company_id, recipient_party_id, issued_at desc);
create index jvg_fiscal_documents_carrier_history_idx
  on public.jvg_fiscal_documents (company_id, carrier_party_id, issued_at desc);

