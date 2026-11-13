-- Resume inicial enxuto e indices para consultas por empresa.
-- A API chama esta funcao apenas depois de autenticar e resolver o vinculo da empresa.
CREATE INDEX IF NOT EXISTS jvg_products_tenant_company_created_idx
  ON public.jvg_products (tenant_id, company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS jvg_parties_tenant_company_registration_idx
  ON public.jvg_parties (tenant_id, company_id, registration_number DESC);

CREATE INDEX IF NOT EXISTS jvg_services_tenant_company_created_idx
  ON public.jvg_services (tenant_id, company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS jvg_inventory_tenant_company_created_idx
  ON public.jvg_inventory_movements (tenant_id, company_id, created_at DESC)
  INCLUDE (product_id, quantity_delta, reason);

CREATE INDEX IF NOT EXISTS jvg_inventory_tenant_company_product_idx
  ON public.jvg_inventory_movements (tenant_id, company_id, product_id)
  INCLUDE (quantity_delta);

CREATE OR REPLACE FUNCTION public.jvg_dashboard_summary(p_tenant_id uuid, p_company_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  WITH company_products AS (
    SELECT p.id, p.active, p.cost_price
    FROM public.jvg_products AS p
    WHERE p.tenant_id = p_tenant_id
      AND p.company_id = p_company_id
  ),
  balances AS (
    SELECT m.product_id, sum(m.quantity_delta)::numeric AS units
    FROM public.jvg_inventory_movements AS m
    WHERE m.tenant_id = p_tenant_id
      AND m.company_id = p_company_id
    GROUP BY m.product_id
  ),
  inventory AS (
    SELECT cp.id, cp.active, cp.cost_price, coalesce(b.units, 0)::numeric AS units
    FROM company_products AS cp
    LEFT JOIN balances AS b ON b.product_id = cp.id
  ),
  stock_summary AS (
    SELECT
      coalesce(sum(units), 0)::numeric AS units_stock,
      count(*) FILTER (WHERE active AND units <= 10)::bigint AS low_stock_count,
      coalesce(sum(units * cost_price), 0)::numeric AS stock_value
    FROM inventory
  ),
  recent AS (
    SELECT m.product_id, m.quantity_delta, m.reason, m.created_at, p.name AS product_name
    FROM public.jvg_inventory_movements AS m
    LEFT JOIN public.jvg_products AS p
      ON p.id = m.product_id
      AND p.tenant_id = m.tenant_id
      AND p.company_id = m.company_id
    WHERE m.tenant_id = p_tenant_id
      AND m.company_id = p_company_id
    ORDER BY m.created_at DESC
    LIMIT 4
  )
  SELECT jsonb_build_object(
    'productsCount', (SELECT count(*) FROM company_products),
    'clientsCount', (
      SELECT count(*)
      FROM public.jvg_parties AS p
      WHERE p.tenant_id = p_tenant_id
        AND p.company_id = p_company_id
    ),
    'unitsStock', (SELECT units_stock FROM stock_summary),
    'lowStockCount', (SELECT low_stock_count FROM stock_summary),
    'stockValue', (SELECT stock_value FROM stock_summary),
    'recentMovements', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'productId', product_id,
        'delta', quantity_delta,
        'reason', reason,
        'at', created_at,
        'name', coalesce(product_name, 'produto')
      ) ORDER BY created_at DESC)
      FROM recent
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.jvg_dashboard_summary(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jvg_dashboard_summary(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jvg_dashboard_summary(uuid, uuid) TO service_role;
