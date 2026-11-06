-- Acesso administrativo da plataforma, separado dos papeis em cada empresa.
-- Convites sao vinculados a um e-mail; privilegios so sao ativados apos
-- confirmar a identidade no Supabase Auth. Nunca confie em user_metadata.

create table public.jvg_platform_admin_invites (
  email text primary key check (email = lower(trim(email)) and length(email) between 5 and 254),
  user_id uuid unique references auth.users(id) on delete set null,
  role text not null default 'platform_admin' check (role = 'platform_admin'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

alter table public.jvg_platform_admin_invites enable row level security;
revoke all on public.jvg_platform_admin_invites from public, anon, authenticated;
grant select, insert, update on public.jvg_platform_admin_invites to service_role;

create function public.jvg_claim_platform_admin(p_user_id uuid, p_email text)
returns text
language plpgsql
security invoker
set search_path = ''
as $body$
declare
  v_email text;
  v_role text;
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao somente de servidor' using errcode = '42501';
  end if;

  -- Sem confirmacao de e-mail, nenhuma pessoa recebe privilegio administrativo.
  select lower(u.email) into v_email
    from auth.users u
   where u.id = p_user_id
     and u.email_confirmed_at is not null
     and lower(u.email) = lower(trim(p_email));
  if v_email is null then
    return null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 0));
  update public.jvg_platform_admin_invites i
     set user_id = p_user_id,
         claimed_at = coalesce(i.claimed_at, now())
   where i.email = v_email
     and i.active
     and (i.user_id is null or i.user_id = p_user_id)
  returning i.role into v_role;

  return v_role;
end;
$body$;

revoke all on function public.jvg_claim_platform_admin(uuid,text) from public, anon, authenticated;
grant execute on function public.jvg_claim_platform_admin(uuid,text) to service_role;
