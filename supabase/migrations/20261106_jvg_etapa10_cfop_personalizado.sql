-- Etapa 10: apelido de CFOP por empresa, sem modificar a tabela fiscal oficial.
-- O catálogo nacional fica versionado no backend e não é replicado por tenant.

create table public.jvg_cfop_overrides (
  tenant_id uuid not null,
  company_id uuid not null,
  code text not null check (code ~ '^[123567][0-9]{3}$'),
  custom_label text not null check (char_length(btrim(custom_label)) between 2 and 140),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, company_id, code),
  foreign key (tenant_id, company_id)
    references public.jvg_companies(tenant_id, id) on delete restrict
);

alter table public.jvg_cfop_overrides enable row level security;

-- Leitura pelos membros desta empresa; escrita validada somente pelo backend.
create policy jvg_cfop_overrides_select_member
  on public.jvg_cfop_overrides for select to authenticated
  using (exists (
    select 1 from public.jvg_company_memberships cm
    where cm.tenant_id = jvg_cfop_overrides.tenant_id
      and cm.company_id = jvg_cfop_overrides.company_id
      and cm.user_id = (select auth.uid())
      and cm.active
  ));

comment on table public.jvg_cfop_overrides is
  'Apelidos de CFOP por empresa; títulos e descrições fiscais oficiais nunca são sobrescritos.';
