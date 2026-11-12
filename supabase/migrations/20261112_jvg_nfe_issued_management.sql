-- Gestão de NF-e emitidas: importação histórica de XML autorizado e inutilização
-- auditável somente no ambiente de homologação.

alter table public.jvg_fiscal_documents
  add column if not exists imported_xml text,
  add constraint jvg_fiscal_documents_imported_xml_scope_check
    check (
      imported_xml is null or
      (document_type = 'nfe' and environment = 'producao' and octet_length(imported_xml) <= 2000000)
    );

create table public.jvg_fiscal_number_inutilizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  environment text not null default 'homologacao' check (environment = 'homologacao'),
  model text not null default '55' check (model = '55'),
  series text not null check (series ~ '^[0-9]{1,3}$'),
  number_start bigint not null check (number_start > 0 and number_start <= 999999999),
  number_end bigint not null check (number_end >= number_start and number_end <= 999999999),
  justification text not null check (char_length(btrim(justification)) between 15 and 255),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 100),
  status text not null default 'processing'
    check (status in ('processing', 'authorized', 'rejected', 'outcome_unknown')),
  protocol text,
  provider_response jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, idempotency_key),
  foreign key (tenant_id, company_id)
    references public.jvg_companies(tenant_id, id) on delete restrict
);

create index jvg_fiscal_number_inutilizations_range_idx
  on public.jvg_fiscal_number_inutilizations
    (company_id, environment, series, number_start, number_end, status);
create index jvg_fiscal_number_inutilizations_date_idx
  on public.jvg_fiscal_number_inutilizations (company_id, created_at desc);
create index jvg_fiscal_documents_issued_search_idx
  on public.jvg_fiscal_documents (company_id, environment, document_type, issued_at desc);
create index jvg_fiscal_documents_payload_gin_idx
  on public.jvg_fiscal_documents using gin (fiscal_payload jsonb_path_ops);

alter table public.jvg_fiscal_number_inutilizations enable row level security;
revoke all privileges on public.jvg_fiscal_number_inutilizations from public, anon, authenticated;
grant all privileges on public.jvg_fiscal_number_inutilizations to service_role;

create policy jvg_fiscal_number_inutilizations_select_member
  on public.jvg_fiscal_number_inutilizations
  for select to authenticated
  using (exists (
    select 1 from public.jvg_company_memberships cm
    where cm.tenant_id = jvg_fiscal_number_inutilizations.tenant_id
      and cm.company_id = jvg_fiscal_number_inutilizations.company_id
      and cm.user_id = (select auth.uid()) and cm.active
  ));
