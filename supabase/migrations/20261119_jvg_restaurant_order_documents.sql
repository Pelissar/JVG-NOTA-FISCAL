-- Associate already-authorized production fiscal documents with restaurant orders
-- so customers can consult the available copy for 30 days after authorization.
-- Apply through the versioned migration tooling for the JVG fiscal project.
-- Rollback: drop table public.jvg_restaurant_order_documents;

begin;

create table if not exists public.jvg_restaurant_order_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  restaurant_order_id uuid not null,
  fiscal_document_id uuid not null,
  authorized_at timestamptz not null,
  customer_available_until timestamptz not null,
  linked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  unique (tenant_id, company_id, fiscal_document_id),
  check (customer_available_until > authorized_at),
  check (customer_available_until <= authorized_at + interval '30 days'),
  foreign key (tenant_id, company_id)
    references public.jvg_companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id, restaurant_order_id)
    references public.jvg_restaurant_orders(tenant_id, company_id, id) on delete restrict,
  foreign key (tenant_id, company_id, fiscal_document_id)
    references public.jvg_fiscal_documents(tenant_id, company_id, id) on delete restrict
);

create index if not exists jvg_restaurant_order_documents_order_idx
  on public.jvg_restaurant_order_documents(tenant_id, company_id, restaurant_order_id, created_at desc);
create index if not exists jvg_restaurant_order_documents_expiry_idx
  on public.jvg_restaurant_order_documents(tenant_id, company_id, customer_available_until);

alter table public.jvg_restaurant_order_documents enable row level security;
revoke all on public.jvg_restaurant_order_documents from public, anon, authenticated;
grant select, insert, update, delete on public.jvg_restaurant_order_documents to service_role;

comment on table public.jvg_restaurant_order_documents is
  'Vinculo auditavel de documento fiscal autorizado a pedido; acesso do cliente expira 30 dias apos autorizacao, sem apagar o documento fiscal.';

commit;
