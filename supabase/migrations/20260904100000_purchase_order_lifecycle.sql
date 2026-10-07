-- Turn the existing shortage request into a traceable purchase lifecycle.
-- A separate purchase-order table is intentionally deferred for the prototype.
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS expected_at TIMESTAMPTZ;

ALTER TABLE public.purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_status_check;

ALTER TABLE public.purchase_requests
  ADD CONSTRAINT purchase_requests_status_check
  CHECK (status IN ('requested','ordered','partially_received','received','cancelled'));

CREATE OR REPLACE FUNCTION public.mark_purchase_request_ordered(
  p_request_id UUID,
  p_ordered_quantity NUMERIC DEFAULT NULL,
  p_supplier_reference TEXT DEFAULT NULL,
  p_expected_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.purchase_requests%ROWTYPE;
  v_quantity NUMERIC;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'staff')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT * INTO v_request
  FROM public.purchase_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.status = 'cancelled' THEN
    RAISE EXCEPTION 'purchase request unavailable';
  END IF;
  IF v_request.supplier_id IS NULL THEN
    RAISE EXCEPTION 'select a supplier before marking the request ordered';
  END IF;
  IF v_request.status IN ('received', 'partially_received') THEN
    RAISE EXCEPTION 'received requests cannot be marked ordered';
  END IF;

  v_quantity := COALESCE(p_ordered_quantity, v_request.requested_quantity - v_request.received_quantity);
  IF v_quantity <= 0 THEN
    RAISE EXCEPTION 'ordered quantity must be greater than zero';
  END IF;
  IF v_quantity > v_request.requested_quantity - v_request.received_quantity THEN
    RAISE EXCEPTION 'ordered quantity exceeds remaining quantity';
  END IF;

  UPDATE public.purchase_requests
  SET status = 'ordered',
      ordered_quantity = v_quantity,
      ordered_at = COALESCE(ordered_at, now()),
      supplier_reference = NULLIF(trim(p_supplier_reference), ''),
      expected_at = p_expected_at,
      updated_at = now()
  WHERE id = p_request_id;

  RETURN p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_purchase_request_ordered(UUID, NUMERIC, TEXT, TIMESTAMPTZ) TO authenticated;
