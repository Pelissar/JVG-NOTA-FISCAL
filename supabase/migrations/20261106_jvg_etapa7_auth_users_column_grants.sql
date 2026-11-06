-- As RPCs jvg_claim_platform_admin e jvg_register_authenticated_pilot
-- rodam com SECURITY INVOKER, acessadas exclusivamente pelo backend.
-- O papel service_role precisa consultar apenas estes campos do Auth para
-- validar identidade/e-mail. Nunca conceder acesso ao anon/authenticated.
grant select (id, email, email_confirmed_at) on auth.users to service_role;
