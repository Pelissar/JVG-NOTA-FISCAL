-- Etapa 11: CFOP sugerido no cadastro de produto.
-- O CFOP final depende da operação e do destino; não há seleção automática de tributação.
alter table public.jvg_products
  add column if not exists default_cfop text
  check (default_cfop is null or default_cfop ~ '^[123567][0-9]{3}$');

comment on column public.jvg_products.default_cfop is
  'Código CFOP sugerido por produto; deve ser confirmado para cada operação fiscal.';
