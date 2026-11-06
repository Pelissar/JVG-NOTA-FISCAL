-- Etapa Netlify: onboarding de usuario autenticado pelo Supabase Auth.
-- O login e validado no servidor. Nao recebe nem armazena tokens em SQL.

create function public.jvg_register_authenticated_pilot(
  p_user_id uuid,
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
  if p_user_id is null or length(trim(coalesce(p_company_name, ''))) not between 3 and 160 then
    raise exception 'Dados de cadastro invalidos';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id and lower(u.email) = lower(trim(p_email))
  ) then
    raise exception 'Usuario nao confirmado no Supabase Auth' using errcode = '42501';
  end if;

  -- Serializa cadastros simultaneos para o mesmo usuario.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  select cm.tenant_id, cm.company_id into v_tenant_id, v_company_id
  from public.jvg_company_memberships cm
  where cm.user_id = p_user_id and cm.active = true and cm.role = 'owner'
  order by cm.created_at
  limit 1;

  if not found then
    insert into public.jvg_tenants (name, slug, status)
    values (trim(p_company_name), 'user-' || pg_catalog.gen_random_uuid()::text, 'pilot')
    returning id into v_tenant_id;

    insert into public.jvg_tenant_memberships (tenant_id, user_id, role)
    values (v_tenant_id, p_user_id, 'owner');

    insert into public.jvg_companies (tenant_id, legal_name, trade_name, tax_regime, status)
    values (v_tenant_id, trim(p_company_name), trim(p_company_name), 'simples_nacional', 'draft')
    returning id into v_company_id;

    insert into public.jvg_company_memberships (tenant_id, company_id, user_id, role)
    values (v_tenant_id, v_company_id, p_user_id, 'owner');

    insert into public.jvg_locations (tenant_id, company_id, code, name)
    values (v_tenant_id, v_company_id, 'PRINCIPAL', 'Estoque principal');

    insert into public.jvg_focus_integrations (tenant_id, company_id, environment, status)
    values (v_tenant_id, v_company_id, 'homologacao', 'waiting_certificate');
  end if;

  return query select v_tenant_id, v_company_id;
end;
$body$;

revoke all on function public.jvg_register_authenticated_pilot(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.jvg_register_authenticated_pilot(uuid,text,text)
  to service_role;
