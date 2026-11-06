-- Etapa 6: completar o cadastro fiscal do emitente sem habilitar emissao.
-- Endereco fiscal estruturado permanece em jvg_companies.address (jsonb).
-- O numero fiscal definitivo e controlado/validado com a Focus e SEFAZ.

alter table public.jvg_companies
  add column if not exists cnae text,
  add column if not exists fiscal_email text,
  add column if not exists fiscal_phone text,
  add column if not exists nfe_series_homologacao smallint not null default 1,
  add column if not exists nfe_next_number_homologacao bigint not null default 1;

alter table public.jvg_companies
  add constraint jvg_companies_cnae_format
    check (cnae is null or cnae ~ '^[0-9]{7}$'),
  add constraint jvg_companies_fiscal_email_length
    check (fiscal_email is null or length(fiscal_email) <= 254),
  add constraint jvg_companies_fiscal_phone_length
    check (fiscal_phone is null or length(fiscal_phone) between 10 and 13),
  add constraint jvg_companies_nfe_series_homologacao_range
    check (nfe_series_homologacao between 1 and 999),
  add constraint jvg_companies_nfe_next_number_homologacao_range
    check (nfe_next_number_homologacao between 1 and 999999999);

comment on column public.jvg_companies.nfe_next_number_homologacao is
  'Numero planejado para homologacao; nao autoriza emissao ou substitui o controle da Focus/SEFAZ.';
