-- CNPJ alfanumerico vigente para novos cadastros desde julho de 2026.
-- Os doze primeiros caracteres podem ter letras A-Z; os dois DVs sao numericos.
-- O calculo modulo 11 (ASCII - 48) e validado pela API antes de salvar.

alter table public.jvg_companies
  drop constraint if exists jvg_companies_cnpj_check;

alter table public.jvg_companies
  add constraint jvg_companies_cnpj_check
  check (cnpj is null or cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$');
