-- Encerramento definitivo de um lancamento cancelado no ERP.
-- O registro cancelado e seu XML permanecem no historico, mas a mesma chave
-- pode ser importada novamente para iniciar um lancamento novo.

do $migration$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.jvg_inbound_nfe_documents'::regclass
      and contype = 'u'
      and pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (company_id, access_key)'
  loop
    execute format('alter table public.jvg_inbound_nfe_documents drop constraint %I', v_constraint.conname);
  end loop;
end;
$migration$;

create unique index if not exists jvg_inbound_nfe_documents_active_access_key_uidx
  on public.jvg_inbound_nfe_documents (company_id, access_key)
  where status <> 'cancelled';

-- Nao existe mais caminho de reabertura. Uma nova entrada comeca pela
-- importacao do XML, mantendo a linha cancelada para auditoria.
drop function if exists public.jvg_reopen_cancelled_inbound_nfe(uuid, uuid, uuid, uuid);
