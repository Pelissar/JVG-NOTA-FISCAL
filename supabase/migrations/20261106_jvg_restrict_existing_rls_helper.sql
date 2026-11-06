-- JVG Etapa 2: impedir chamada por clientes a funcao administrativa de auto-RLS.
-- O gatilho de banco continua gerenciado pelo proprietario da funcao.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
