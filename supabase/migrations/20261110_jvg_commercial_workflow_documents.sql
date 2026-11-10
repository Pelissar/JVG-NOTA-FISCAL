-- Fluxo comercial: numeracao por empresa e cancelamento atomico de pedido/orcamento.
-- APLICAR MANUALMENTE NO SUPABASE SQL EDITOR. Nao foi executado pelo Codex.

BEGIN;

ALTER TABLE public.jvg_quotes ADD COLUMN IF NOT EXISTS quote_number bigint;

WITH company_max AS (
  SELECT tenant_id, company_id, coalesce(max(quote_number), 0) AS last_number
  FROM public.jvg_quotes
  GROUP BY tenant_id, company_id
),
missing_quotes AS (
  SELECT id, tenant_id, company_id,
         row_number() OVER (PARTITION BY tenant_id, company_id ORDER BY created_at, id) AS offset_number
  FROM public.jvg_quotes
  WHERE quote_number IS NULL
)
UPDATE public.jvg_quotes AS q
SET quote_number = company_max.last_number + missing_quotes.offset_number
FROM missing_quotes
JOIN company_max USING (tenant_id, company_id)
WHERE q.id = missing_quotes.id;

ALTER TABLE public.jvg_quotes
  ALTER COLUMN quote_number SET NOT NULL;
ALTER TABLE public.jvg_quotes
  DROP CONSTRAINT IF EXISTS jvg_quotes_quote_number_positive;
ALTER TABLE public.jvg_quotes
  ADD CONSTRAINT jvg_quotes_quote_number_positive CHECK (quote_number > 0);
ALTER TABLE public.jvg_quotes
  DROP CONSTRAINT IF EXISTS jvg_quotes_status_check;
ALTER TABLE public.jvg_quotes
  ADD CONSTRAINT jvg_quotes_status_check
  CHECK (status IN ('draft','sent','accepted','rejected','expired','cancelled'));

CREATE UNIQUE INDEX IF NOT EXISTS jvg_quotes_company_number_uidx
  ON public.jvg_quotes (tenant_id, company_id, quote_number);

CREATE TABLE IF NOT EXISTS public.jvg_quote_counters (
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  next_number bigint NOT NULL CHECK (next_number > 0),
  PRIMARY KEY (tenant_id, company_id)
);
ALTER TABLE public.jvg_quote_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jvg_quote_counters FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.jvg_quote_counters TO service_role;

INSERT INTO public.jvg_quote_counters (tenant_id, company_id, next_number)
SELECT tenant_id, company_id, max(quote_number) + 1
FROM public.jvg_quotes
GROUP BY tenant_id, company_id
ON CONFLICT (tenant_id, company_id) DO UPDATE
SET next_number = greatest(public.jvg_quote_counters.next_number, EXCLUDED.next_number);

CREATE OR REPLACE FUNCTION public.jvg_assign_quote_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_number bigint;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Operacao restrita ao servidor' USING errcode = '42501';
  END IF;

  INSERT INTO public.jvg_quote_counters (tenant_id, company_id, next_number)
  VALUES (NEW.tenant_id, NEW.company_id, 2)
  ON CONFLICT (tenant_id, company_id) DO UPDATE
    SET next_number = public.jvg_quote_counters.next_number + 1
  RETURNING next_number - 1 INTO v_number;

  NEW.quote_number := v_number;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.jvg_assign_quote_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jvg_assign_quote_number() TO service_role;

DROP TRIGGER IF EXISTS jvg_quotes_assign_number ON public.jvg_quotes;
CREATE TRIGGER jvg_quotes_assign_number
BEFORE INSERT ON public.jvg_quotes
FOR EACH ROW EXECUTE FUNCTION public.jvg_assign_quote_number();

CREATE OR REPLACE FUNCTION public.jvg_cancel_order(
  p_tenant_id uuid,
  p_company_id uuid,
  p_order_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_quote_id uuid;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Operacao restrita ao servidor' USING errcode = '42501';
  END IF;

  SELECT quote_id INTO v_quote_id
  FROM public.jvg_orders
  WHERE id = p_order_id
    AND tenant_id = p_tenant_id
    AND company_id = p_company_id
    AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido nao encontrado, nao esta aberto ou ja foi alterado';
  END IF;

  UPDATE public.jvg_quotes
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_quote_id
    AND tenant_id = p_tenant_id
    AND company_id = p_company_id
    AND status = 'accepted';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orcamento de origem nao esta mais disponivel para cancelamento';
  END IF;

  UPDATE public.jvg_orders
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_order_id
    AND tenant_id = p_tenant_id
    AND company_id = p_company_id
    AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido alterado durante o cancelamento';
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.jvg_cancel_order(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jvg_cancel_order(uuid, uuid, uuid) TO service_role;

COMMIT;
