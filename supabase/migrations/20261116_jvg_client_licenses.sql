-- Licenças comerciais e conferência de documentos do cliente.
-- O token da Focus fica só no servidor. O navegador nunca lê esta coluna.

do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'jvg_subscription_plans'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%billing_interval%';
  if constraint_name is not null then
    execute format('alter table public.jvg_subscription_plans drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.jvg_subscription_plans
  add constraint jvg_subscription_plans_billing_interval_check
  check (billing_interval in ('month', 'quarter', 'semester', 'year'));

insert into public.jvg_subscription_plans
  (code, name, billing_interval, amount_minor, currency, max_companies, features)
values
  ('mensal', 'Mensal', 'month', null, 'BRL', 1, '{"days":30,"fiscal_environment":"homologacao"}'::jsonb),
  ('trimestral', 'Trimestral', 'quarter', null, 'BRL', 1, '{"days":90,"fiscal_environment":"homologacao"}'::jsonb),
  ('semestral', 'Semestral', 'semester', null, 'BRL', 1, '{"days":180,"fiscal_environment":"homologacao"}'::jsonb),
  ('anual', 'Anual', 'year', null, 'BRL', 1, '{"days":365,"fiscal_environment":"homologacao"}'::jsonb)
on conflict (code) do update
  set name = excluded.name,
      billing_interval = excluded.billing_interval,
      features = excluded.features,
      updated_at = now();

create table if not exists public.jvg_company_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.jvg_tenants(id) on delete restrict,
  company_id uuid not null references public.jvg_companies(id) on delete restrict,
  document_code text not null check (document_code in (
    'cartao_cnpj', 'contrato_social', 'inscricao_estadual', 'comprovante_endereco', 'certificado_focus'
  )),
  status text not null default 'pending' check (status in ('pending', 'received', 'approved', 'rejected')),
  note text check (note is null or char_length(note) <= 400),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, document_code)
);

create table if not exists public.jvg_company_focus_credentials (
  company_id uuid primary key references public.jvg_companies(id) on delete restrict,
  tenant_id uuid not null references public.jvg_tenants(id) on delete restrict,
  homolog_token text not null check (char_length(homolog_token) between 8 and 300),
  updated_at timestamptz not null default now()
);

alter table public.jvg_company_documents enable row level security;
alter table public.jvg_company_focus_credentials enable row level security;
revoke all on public.jvg_company_documents from public, anon, authenticated;
revoke all on public.jvg_company_focus_credentials from public, anon, authenticated;
grant all on public.jvg_company_documents, public.jvg_company_focus_credentials to service_role;
