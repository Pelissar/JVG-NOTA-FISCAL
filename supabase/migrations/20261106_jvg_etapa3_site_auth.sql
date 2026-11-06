-- Vinculo autenticado entre Site (identidade de usuario ChatGPT) e empresa no Supabase.
-- Somente o servidor privado do Site pode operar estes registros.

alter table public.jvg_products add column if not exists category text;
alter table public.jvg_services add column if not exists nbs text;

create table public.jvg_site_accounts (
  site_project_id text not null,
  site_user_id text not null,
  email text not null,
  tenant_id uuid not null references public.jvg_tenants(id) on delete restrict,
  company_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_project_id, site_user_id),
  foreign key (tenant_id, company_id)
    references public.jvg_companies(tenant_id, id) on delete restrict
);
create index jvg_site_accounts_company_idx on public.jvg_site_accounts (company_id);
alter table public.jvg_site_accounts enable row level security;
revoke all on table public.jvg_site_accounts from anon, authenticated;

-- Bootstrap atomico, invocavel exclusivamente com a chave de servidor.
-- Nenhuma credencial Focus ou certificado fiscal e recebida nesta funcao.
create function public.jvg_register_site_pilot(
  p_site_project_id text,
  p_site_user_id text,
  p_email text,
  p_company_name text
)
returns table (tenant_id uuid, company_id uuid)
language plpgsql
security invoker
set search_path = ''
as $body$
declare
  v_tenant_id uuid;
  v_company_id uuid;
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao somente de servidor' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_site_project_id, ''))) < 8 or
     length(trim(coalesce(p_site_user_id, ''))) < 8 or
     length(trim(coalesce(p_company_name, ''))) not between 3 and 160 or
     length(trim(coalesce(p_email, ''))) < 3 then
    raise exception 'Dados de cadastro invalidos';
  end if;

  select a.tenant_id, a.company_id into v_tenant_id, v_company_id
  from public.jvg_site_accounts a
  where a.site_project_id = p_site_project_id and a.site_user_id = p_site_user_id;

  if not found then
    insert into public.jvg_tenants (name, slug, status)
    values (trim(p_company_name), 'site-' || gen_random_uuid()::text, 'pilot')
    returning id into v_tenant_id;

    insert into public.jvg_companies (tenant_id, legal_name, trade_name, tax_regime, status)
    values (v_tenant_id, trim(p_company_name), trim(p_company_name), 'simples_nacional', 'draft')
    returning id into v_company_id;

    insert into public.jvg_site_accounts (site_project_id, site_user_id, email, tenant_id, company_id)
    values (p_site_project_id, p_site_user_id, lower(trim(p_email)), v_tenant_id, v_company_id);

    insert into public.jvg_locations (tenant_id, company_id, code, name)
    values (v_tenant_id, v_company_id, 'PRINCIPAL', 'Estoque principal');

    insert into public.jvg_focus_integrations (tenant_id, company_id, environment, status)
    values (v_tenant_id, v_company_id, 'homologacao', 'waiting_certificate');
  end if;

  return query select v_tenant_id, v_company_id;
end;
$body$;

revoke all on function public.jvg_register_site_pilot(text,text,text,text) from public, anon, authenticated;
grant execute on function public.jvg_register_site_pilot(text,text,text,text) to service_role;
