-- Reversao de 20261118_jvg_accountant_rtc.sql.
-- ATENCAO: remover colunas apaga os valores fiscais que tenham sido salvos nelas.
drop table if exists public.jvg_fiscal_rtc_calculations;
drop table if exists public.jvg_company_fiscal_audit;

alter table public.jvg_products
  drop constraint if exists jvg_products_rtc_cst_check,
  drop constraint if exists jvg_products_rtc_class_trib_check,
  drop constraint if exists jvg_products_rtc_simple_activity_check,
  drop column if exists rtc_cst,
  drop column if exists rtc_class_trib,
  drop column if exists rtc_simple_activity;

alter table public.jvg_companies
  drop constraint if exists jvg_companies_crt_check,
  drop constraint if exists jvg_companies_tp_regime_ibs_cbs_check,
  drop column if exists crt,
  drop column if exists tp_regime_ibs_cbs;
