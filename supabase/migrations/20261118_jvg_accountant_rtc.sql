-- SigmaFiscal: acesso fiscal do contador e snapshots das calculadoras oficiais RTC.
-- Migration versionada para aplicacao unica pelo fluxo de migrations do projeto.

alter table public.jvg_companies
  add column if not exists crt smallint,
  add column if not exists tp_regime_ibs_cbs text;

alter table public.jvg_companies
  drop constraint if exists jvg_companies_crt_check,
  add constraint jvg_companies_crt_check check (crt is null or crt between 1 and 4),
  drop constraint if exists jvg_companies_tp_regime_ibs_cbs_check,
  add constraint jvg_companies_tp_regime_ibs_cbs_check
    check (tp_regime_ibs_cbs is null or tp_regime_ibs_cbs in ('1','2'));

alter table public.jvg_products
  add column if not exists rtc_cst text,
  add column if not exists rtc_class_trib text,
  add column if not exists rtc_simple_activity text;

alter table public.jvg_products
  drop constraint if exists jvg_products_rtc_cst_check,
  add constraint jvg_products_rtc_cst_check check (rtc_cst is null or rtc_cst ~ '^[0-9]{3}$'),
  drop constraint if exists jvg_products_rtc_class_trib_check,
  add constraint jvg_products_rtc_class_trib_check check (rtc_class_trib is null or rtc_class_trib ~ '^[0-9]{6}$'),
  drop constraint if exists jvg_products_rtc_simple_activity_check,
  add constraint jvg_products_rtc_simple_activity_check check (rtc_simple_activity is null or rtc_simple_activity ~ '^[0-9]{2}$');

comment on column public.jvg_companies.crt is 'CRT confirmado pela empresa/contabilidade; nulo ate ser informado.';
comment on column public.jvg_companies.tp_regime_ibs_cbs is 'Opcao oficial tpRegimeIBSCBS; nula ate ser confirmada.';
comment on column public.jvg_products.rtc_cst is 'CST IBS/CBS de 3 digitos informado para o produto; sem valor padrao.';
comment on column public.jvg_products.rtc_class_trib is 'cClassTrib IBS/CBS de 6 digitos; sem valor padrao.';
comment on column public.jvg_products.rtc_simple_activity is 'Código oficial cAtivSN vinculado ao produto quando aplicável; sem valor padrão.';

create table if not exists public.jvg_company_fiscal_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('company_fiscal_update','product_fiscal_update','accountant_invited','accountant_revoked')),
  entity_type text not null check (entity_type in ('company','product','company_member')),
  entity_id text not null,
  before_values jsonb not null default '{}'::jsonb check (jsonb_typeof(before_values) = 'object'),
  after_values jsonb not null default '{}'::jsonb check (jsonb_typeof(after_values) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, company_id) references public.jvg_companies(tenant_id, id) on delete restrict
);
create index if not exists jvg_company_fiscal_audit_scope_date_idx
  on public.jvg_company_fiscal_audit(tenant_id, company_id, created_at desc);
create index if not exists jvg_company_fiscal_audit_entity_idx
  on public.jvg_company_fiscal_audit(tenant_id, company_id, entity_type, entity_id, created_at desc);

create table if not exists public.jvg_fiscal_rtc_calculations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  fiscal_document_id uuid not null,
  regime text not null check (regime in ('simples_nacional','lucro_presumido','lucro_real')),
  calculator_endpoint text not null check (calculator_endpoint in ('simples-nacional','regime-geral')),
  calculator_version text not null,
  calculator_db_version text,
  request_version text not null,
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot) = 'object'),
  result_snapshot jsonb not null check (jsonb_typeof(result_snapshot) = 'object'),
  simulated_data_warning boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, company_id, fiscal_document_id)
    references public.jvg_fiscal_documents(tenant_id, company_id, id) on delete restrict
);
alter table public.jvg_fiscal_rtc_calculations
  add column if not exists calculator_db_version text;
create index if not exists jvg_fiscal_rtc_document_date_idx
  on public.jvg_fiscal_rtc_calculations(tenant_id, company_id, fiscal_document_id, created_at desc);

alter table public.jvg_company_fiscal_audit enable row level security;
alter table public.jvg_fiscal_rtc_calculations enable row level security;
revoke all on public.jvg_company_fiscal_audit, public.jvg_fiscal_rtc_calculations from public, anon, authenticated;
grant all on public.jvg_company_fiscal_audit, public.jvg_fiscal_rtc_calculations to service_role;

-- Migration de reversao: supabase/rollback/20261118_jvg_accountant_rtc.sql
