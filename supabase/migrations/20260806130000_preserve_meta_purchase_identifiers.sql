-- Preserve Meta browser identifiers when checkout metadata becomes order metadata.
-- This supports both immediate orders and delayed payment gateway callbacks.

BEGIN;

CREATE OR REPLACE FUNCTION public.preserve_order_marketing_identifiers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cart_id TEXT;
  v_marketing JSONB;
BEGIN
  v_cart_id := COALESCE(
    NEW.metadata->>'cart_id',
    CASE
      WHEN TG_OP = 'UPDATE' THEN OLD.metadata->>'cart_id'
      ELSE NULL
    END
  );

  IF v_cart_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT metadata->'marketing'
  INTO v_marketing
  FROM public.carts
  WHERE id = v_cart_id;

  IF jsonb_typeof(v_marketing) = 'object' THEN
    NEW.metadata := jsonb_set(
      COALESCE(NEW.metadata, '{}'::jsonb),
      '{marketing}',
      v_marketing,
      true
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_order_marketing_identifiers
ON public.orders;

CREATE TRIGGER preserve_order_marketing_identifiers
BEFORE INSERT OR UPDATE OF metadata
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.preserve_order_marketing_identifiers();

COMMIT;
