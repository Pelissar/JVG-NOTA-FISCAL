-- O valor legado simples_nacional pode ter vindo do padrão de cadastro,
-- portanto não é prova do enquadramento tributário real da empresa.
alter table public.jvg_companies
  add column if not exists tax_regime_confirmed boolean not null default false;
