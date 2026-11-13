-- Atualiza o armazenamento para o CNPJ alfanumérico definido na NT 2026.004.
-- Não altera cadastros existentes nem confirma o regime tributário da empresa.
alter table public.jvg_companies
  drop constraint if exists jvg_companies_cnpj_check;
alter table public.jvg_companies
  add constraint jvg_companies_cnpj_format_check
  check (cnpj is null or cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$');

alter table public.jvg_parties
  drop constraint if exists jvg_parties_check;
alter table public.jvg_parties
  add constraint jvg_parties_document_number_check
  check (document_number is null or (
    (document_type = 'cpf' and document_number ~ '^[0-9]{11}$') or
    (document_type = 'cnpj' and document_number ~ '^[A-Z0-9]{12}[0-9]{2}$') or
    (document_type = 'foreign' and length(document_number) between 1 and 40)
  ));
