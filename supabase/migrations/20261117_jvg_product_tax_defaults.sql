-- Store optional outbound tax-code suggestions per tenant/company product.
-- Values remain editable on each NF-e item and are never calculated here.
alter table public.jvg_products
  add column if not exists default_csosn text,
  add column if not exists default_pis_cst text,
  add column if not exists default_cofins_cst text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.jvg_products'::regclass
      and conname = 'jvg_products_default_csosn_format'
  ) then
    alter table public.jvg_products
      add constraint jvg_products_default_csosn_format
      check (default_csosn is null or default_csosn ~ '^[0-9]{3}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.jvg_products'::regclass
      and conname = 'jvg_products_default_pis_cst_format'
  ) then
    alter table public.jvg_products
      add constraint jvg_products_default_pis_cst_format
      check (default_pis_cst is null or default_pis_cst ~ '^[0-9]{2}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.jvg_products'::regclass
      and conname = 'jvg_products_default_cofins_cst_format'
  ) then
    alter table public.jvg_products
      add constraint jvg_products_default_cofins_cst_format
      check (default_cofins_cst is null or default_cofins_cst ~ '^[0-9]{2}$');
  end if;
end;
$$;

comment on column public.jvg_products.default_csosn is
  'Optional outbound CSOSN suggestion; confirm for each product and operation.';
comment on column public.jvg_products.default_pis_cst is
  'Optional outbound PIS CST suggestion; confirm for each product and operation.';
comment on column public.jvg_products.default_cofins_cst is
  'Optional outbound Cofins CST suggestion; confirm for each product and operation.';
