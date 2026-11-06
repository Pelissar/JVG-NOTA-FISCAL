-- JVG Nota Fiscal | Etapa 2 | Estrutura inicial multiempresa
-- Ambiente: Supabase / PostgreSQL 17
-- Aplicar uma unica vez, via migration. Nenhum token ou certificado e armazenado aqui.

create table public.jvg_tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'pilot' check (status in ('pilot','active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.jvg_tenant_memberships (
  tenant_id uuid not null references public.jvg_tenants(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index jvg_tenant_memberships_user_idx on public.jvg_tenant_memberships (user_id, tenant_id) where active;

create table public.jvg_companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.jvg_tenants(id) on delete restrict,
  legal_name text not null,
  trade_name text,
  cnpj text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  state_registration text,
  municipal_registration text,
  tax_regime text not null default 'simples_nacional'
    check (tax_regime in ('mei','simples_nacional','lucro_presumido','lucro_real','outro')),
  address jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, cnpj)
);
create index jvg_companies_tenant_idx on public.jvg_companies (tenant_id);

create table public.jvg_company_memberships (
  tenant_id uuid not null,
  company_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','manager','operator','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id),
  foreign key (tenant_id, company_id) references public.jvg_companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, user_id) references public.jvg_tenant_memberships(tenant_id, user_id) on delete restrict
);
create index jvg_company_memberships_user_idx on public.jvg_company_memberships (user_id, company_id) where active;

create table public.jvg_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  unique (company_id, code),
  foreign key (tenant_id, company_id) references public.jvg_companies(tenant_id, id) on delete restrict
);

create table public.jvg_parties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  display_name text not null,
  legal_name text,
  document_type text not null default 'none' check (document_type in ('cpf','cnpj','foreign','none')),
  document_number text,
  state_registration text,
  municipal_registration text,
  email text,
  phone text,
  address jsonb not null default '{}'::jsonb,
  is_customer boolean not null default true,
  is_supplier boolean not null default false,
  is_carrier boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  unique (company_id, document_type, document_number),
  check (document_number is null or (
    (document_type = 'cpf' and document_number ~ '^[0-9]{11}$') or
    (document_type = 'cnpj' and document_number ~ '^[0-9]{14}$') or
    (document_type = 'foreign' and length(document_number) between 1 and 40)
  )),
  foreign key (tenant_id, company_id) references public.jvg_companies(tenant_id, id) on delete restrict
);
create index jvg_parties_company_name_idx on public.jvg_parties (company_id, display_name);

create table public.jvg_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  sku text not null,
  name text not null,
  description text,
  gtin text,
  ncm text check (ncm is null or ncm ~ '^[0-9]{8}$'),
  cest text check (cest is null or cest ~ '^[0-9]{7}$'),
  origin text check (origin is null or origin ~ '^[0-8]$'),
  unit text not null default 'UN',
  cost_price numeric(18,4) not null default 0 check (cost_price >= 0),
  sale_price numeric(18,4) not null default 0 check (sale_price >= 0),
  minimum_stock numeric(18,4) not null default 0 check (minimum_stock >= 0),
  tracks_stock boolean not null default true,
  tax_profile_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  unique (company_id, sku),
  foreign key (tenant_id, company_id) references public.jvg_companies(tenant_id, id) on delete restrict
);
create index jvg_products_company_name_idx on public.jvg_products (company_id, name);

create table public.jvg_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  code text not null,
  name text not null,
  description text,
  national_service_code text,
  municipal_service_code text,
  cnae text,
  unit text not null default 'SV',
  sale_price numeric(18,4) not null default 0 check (sale_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  unique (company_id, code),
  foreign key (tenant_id, company_id) references public.jvg_companies(tenant_id, id) on delete restrict
);

create table public.jvg_tax_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  name text not null,
  document_type text not null check (document_type in ('nfe','nfce','nfse','cte','mdfe')),
  rules jsonb not null default '{}'::jsonb,
  valid_from date,
  valid_until date,
  review_status text not null default 'draft' check (review_status in ('draft','reviewed','retired')),
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  check (valid_until is null or valid_from is null or valid_until >= valid_from),
  foreign key (tenant_id, company_id) references public.jvg_companies(tenant_id, id) on delete restrict
);
alter table public.jvg_products add constraint jvg_products_tax_profile_fk
  foreign key (tenant_id, company_id, tax_profile_id)
  references public.jvg_tax_profiles(tenant_id, company_id, id) on delete restrict;

create table public.jvg_sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  customer_id uuid,
  status text not null default 'draft' check (status in ('draft','confirmed','invoiced','cancelled')),
  subtotal numeric(18,2) not null default 0 check (subtotal >= 0),
  discount_total numeric(18,2) not null default 0 check (discount_total >= 0),
  total numeric(18,2) not null default 0 check (total >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  foreign key (tenant_id, company_id) references public.jvg_companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id, customer_id) references public.jvg_parties(tenant_id, company_id, id) on delete restrict
);
create index jvg_sales_company_created_idx on public.jvg_sales (company_id, created_at desc);

create table public.jvg_sale_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  sale_id uuid not null,
  product_id uuid,
  service_id uuid,
  description_snapshot text not null,
  unit_snapshot text not null,
  quantity numeric(18,4) not null check (quantity > 0),
  unit_price numeric(18,4) not null check (unit_price >= 0),
  line_total numeric(18,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  check (num_nonnulls(product_id, service_id) = 1),
  foreign key (tenant_id, company_id, sale_id) references public.jvg_sales(tenant_id, company_id, id) on delete restrict,
  foreign key (tenant_id, company_id, product_id) references public.jvg_products(tenant_id, company_id, id) on delete restrict,
  foreign key (tenant_id, company_id, service_id) references public.jvg_services(tenant_id, company_id, id) on delete restrict
);
create index jvg_sale_items_sale_idx on public.jvg_sale_items (sale_id);

create table public.jvg_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  product_id uuid not null,
  location_id uuid not null,
  sale_id uuid,
  quantity_delta numeric(18,4) not null check (quantity_delta <> 0),
  movement_type text not null check (movement_type in ('opening','purchase','sale','return','adjustment','transfer_in','transfer_out')),
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, company_id, product_id) references public.jvg_products(tenant_id, company_id, id) on delete restrict,
  foreign key (tenant_id, company_id, location_id) references public.jvg_locations(tenant_id, company_id, id) on delete restrict,
  foreign key (tenant_id, company_id, sale_id) references public.jvg_sales(tenant_id, company_id, id) on delete restrict
);
create index jvg_inventory_product_date_idx on public.jvg_inventory_movements (company_id, product_id, created_at desc);

create table public.jvg_fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  sale_id uuid,
  document_type text not null check (document_type in ('nfe','nfce','nfse','cte','mdfe')),
  environment text not null default 'homologacao' check (environment in ('homologacao','producao')),
  status text not null default 'draft' check (status in ('draft','waiting_certificate','queued','processing','authorized','rejected','cancelled','denied','contingency')),
  series text,
  document_number bigint check (document_number is null or document_number > 0),
  access_key text,
  focus_reference text,
  idempotency_key text,
  fiscal_payload jsonb not null default '{}'::jsonb,
  provider_response jsonb,
  xml_storage_path text,
  pdf_storage_path text,
  issued_at timestamptz,
  authorized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  unique (company_id, document_type, environment, series, document_number),
  unique (company_id, environment, focus_reference),
  unique (company_id, idempotency_key),
  foreign key (tenant_id, company_id) references public.jvg_companies(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_id, sale_id) references public.jvg_sales(tenant_id, company_id, id) on delete restrict
);
create index jvg_fiscal_documents_company_date_idx on public.jvg_fiscal_documents (company_id, created_at desc);
create index jvg_fiscal_documents_status_idx on public.jvg_fiscal_documents (company_id, status, document_type);

create table public.jvg_fiscal_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  fiscal_document_id uuid not null,
  event_type text not null check (event_type in ('authorization','cancellation','correction_letter','number_invalidation','status_update','error')),
  status text not null,
  protocol text,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, company_id, fiscal_document_id)
    references public.jvg_fiscal_documents(tenant_id, company_id, id) on delete restrict
);
create index jvg_fiscal_events_doc_idx on public.jvg_fiscal_events (fiscal_document_id, created_at desc);

-- Metadados apenas. Tokens Focus e senha/certificado A1 nunca ficam nesta tabela.
create table public.jvg_focus_integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  environment text not null default 'homologacao' check (environment in ('homologacao','producao')),
  status text not null default 'waiting_certificate'
    check (status in ('waiting_certificate','pending_validation','ready','paused')),
  focus_company_reference text,
  last_validation_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, environment),
  foreign key (tenant_id, company_id) references public.jvg_companies(tenant_id, id) on delete restrict
);

create table public.jvg_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id) references public.jvg_tenants(id) on delete restrict,
  foreign key (tenant_id, company_id) references public.jvg_companies(tenant_id, id) on delete restrict
);
create index jvg_audit_events_tenant_date_idx on public.jvg_audit_events (tenant_id, created_at desc);

-- Regras de acesso: so usuarios autenticados e vinculados a empresa podem ler.
-- Vinculos, integracoes, estoque e emissao fiscal: escrita apenas pelo backend confiavel.
alter table public.jvg_tenants enable row level security;
alter table public.jvg_tenant_memberships enable row level security;
alter table public.jvg_companies enable row level security;
alter table public.jvg_company_memberships enable row level security;
alter table public.jvg_locations enable row level security;
alter table public.jvg_parties enable row level security;
alter table public.jvg_products enable row level security;
alter table public.jvg_services enable row level security;
alter table public.jvg_tax_profiles enable row level security;
alter table public.jvg_sales enable row level security;
alter table public.jvg_sale_items enable row level security;
alter table public.jvg_inventory_movements enable row level security;
alter table public.jvg_fiscal_documents enable row level security;
alter table public.jvg_fiscal_events enable row level security;
alter table public.jvg_focus_integrations enable row level security;
alter table public.jvg_audit_events enable row level security;

create policy jvg_tenant_memberships_select_own
  on public.jvg_tenant_memberships for select to authenticated
  using (user_id = (select auth.uid()));

create policy jvg_tenants_select_member
  on public.jvg_tenants for select to authenticated
  using (exists (
    select 1 from public.jvg_tenant_memberships m
    where m.tenant_id = jvg_tenants.id and m.user_id = (select auth.uid()) and m.active
  ));

create policy jvg_company_memberships_select_own
  on public.jvg_company_memberships for select to authenticated
  using (
    user_id = (select auth.uid()) and active and
    exists (select 1 from public.jvg_tenant_memberships m
            where m.tenant_id = jvg_company_memberships.tenant_id
              and m.user_id = (select auth.uid()) and m.active)
  );

create policy jvg_companies_select_member
  on public.jvg_companies for select to authenticated
  using (exists (
    select 1 from public.jvg_company_memberships cm
    where cm.tenant_id = jvg_companies.tenant_id
      and cm.company_id = jvg_companies.id
      and cm.user_id = (select auth.uid()) and cm.active
  ));

do $policy$
declare tbl text;
begin
  foreach tbl in array array[
    'jvg_locations', 'jvg_parties', 'jvg_products', 'jvg_services',
    'jvg_tax_profiles', 'jvg_sales', 'jvg_sale_items',
    'jvg_inventory_movements', 'jvg_fiscal_documents', 'jvg_fiscal_events'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (exists (
         select 1 from public.jvg_company_memberships cm
         where cm.tenant_id = %I.tenant_id and cm.company_id = %I.company_id
           and cm.user_id = (select auth.uid()) and cm.active
       ))', tbl || '_select_member', tbl, tbl, tbl
    );
  end loop;
  -- Somente cadastros operacionais aceitam gravacao direta sob RLS.
  foreach tbl in array array['jvg_locations', 'jvg_parties', 'jvg_products', 'jvg_services'] loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (exists (
         select 1 from public.jvg_company_memberships cm
         where cm.tenant_id = %I.tenant_id and cm.company_id = %I.company_id
           and cm.user_id = (select auth.uid()) and cm.active
           and cm.role in (''owner'', ''admin'', ''manager'', ''operator'')
       ))', tbl || '_insert_staff', tbl, tbl, tbl
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (exists (
         select 1 from public.jvg_company_memberships cm
         where cm.tenant_id = %I.tenant_id and cm.company_id = %I.company_id
           and cm.user_id = (select auth.uid()) and cm.active
           and cm.role in (''owner'', ''admin'', ''manager'', ''operator'')
       )) with check (exists (
         select 1 from public.jvg_company_memberships cm
         where cm.tenant_id = %I.tenant_id and cm.company_id = %I.company_id
           and cm.user_id = (select auth.uid()) and cm.active
           and cm.role in (''owner'', ''admin'', ''manager'', ''operator'')
       ))', tbl || '_update_staff', tbl, tbl, tbl, tbl, tbl
    );
  end loop;
end;
$policy$;

-- Sem policies de escrita/alteracao para documentos fiscais, movimento de estoque,
-- perfis tributarios, vendas, integracoes e auditoria: operacoes transacionais
-- devem passar por servicos de backend com validacao e trilha de auditoria.
-- Nenhuma policy permite DELETE. A baixa de cadastros ocorre via active=false.
