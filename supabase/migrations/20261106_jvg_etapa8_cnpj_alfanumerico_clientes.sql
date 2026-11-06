-- Aceita CNPJ com letras no cadastro de destinatarios, mantendo CPF numerico.
-- A verificacao dos digitos de controle e feita no backend por validCnpj().
alter table public.jvg_parties
  drop constraint if exists jvg_parties_check;

alter table public.jvg_parties
  add constraint jvg_parties_check
  check (document_number is null or (
    (document_type = 'cpf' and document_number ~ '^[0-9]{11}$') or
    (document_type = 'cnpj' and document_number ~ '^[A-Z0-9]{12}[0-9]{2}$') or
    (document_type = 'foreign' and length(document_number) between 1 and 40)
  ));
