-- Orçamentos comerciais: rascunhos persistidos por empresa, sem movimentar estoque.
-- APLICAR SOMENTE EM HOMOLOGAÇÃO APÓS REVISÃO. Não aplicado à produção.
create table if not exists public.jvg_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  customer_id uuid,
  status text not null default 'draft' check (status in ('draft','sent','accepted','rejected','expired')),
  notes text not null default '',
  valid_until date,
  total numeric(18,2) not null default 0 check (total >= 0),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jvg_quotes_notes_length check (char_length(notes) <= 2000),
  constraint jvg_quotes_items_count check (jsonb_array_length(items) between 1 and 100)
);
create index if not exists jvg_quotes_company_recent_idx
  on public.jvg_quotes (tenant_id, company_id, created_at desc, id desc);
alter table public.jvg_quotes enable row level security;
revoke all on public.jvg_quotes from public, anon, authenticated;
grant select, insert, update on public.jvg_quotes to service_role;

-- Escrita e alteração de status ficam restritas ao backend, que valida membership.
-- Cada item é armazenado com snapshot de descrição, unidade, quantidade e preço.
-- Não gera venda, cobrança ou reserva de estoque automaticamente.

