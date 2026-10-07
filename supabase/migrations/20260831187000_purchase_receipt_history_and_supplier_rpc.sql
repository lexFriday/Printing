-- Purchasing is a guarded operational workflow: supplier selection and
-- receipts must not bypass the request's permissions or audit history.
CREATE OR REPLACE FUNCTION public.receive_purchase_request(
  p_request_id UUID,
  p_quantity NUMERIC,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.purchase_requests%ROWTYPE;
  v_id UUID;
  v_existing public.inventory_movements%ROWTYPE;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'staff')
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR COALESCE(trim(p_idempotency_key), '') = '' THEN
    RAISE EXCEPTION 'quantity and idempotency key are required';
  END IF;
  SELECT * INTO r FROM public.purchase_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR r.status::TEXT = 'cancelled' THEN
    RAISE EXCEPTION 'purchase request unavailable';
  END IF;

  SELECT * INTO v_existing
  FROM public.inventory_movements
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.material_id <> r.material_id
      OR v_existing.job_order_id IS DISTINCT FROM r.job_order_id
      OR v_existing.movement_type <> 'receipt'
      OR v_existing.quantity <> p_quantity THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different receipt';
    END IF;
    RETURN v_existing.id;
  END IF;

  IF p_quantity > r.requested_quantity - r.received_quantity THEN
    RAISE EXCEPTION 'receipt exceeds remaining quantity';
  END IF;
  v_id := public.record_inventory_movement(
    r.material_id, r.job_order_id, 'receipt', p_quantity, p_idempotency_key
  );
  INSERT INTO public.material_receipts(
    purchase_request_id, quantity, received_by, reference_key
  ) VALUES (
    p_request_id, p_quantity, auth.uid(), p_idempotency_key
  ) ON CONFLICT (reference_key) DO NOTHING;

  UPDATE public.purchase_requests
  SET received_quantity = received_quantity + p_quantity,
      status = (CASE WHEN received_quantity + p_quantity >= requested_quantity
                     THEN 'received' ELSE 'partially_received' END)::purchase_request_status,
      updated_at = now()
  WHERE id = p_request_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_purchase_request_supplier(
  p_request_id UUID,
  p_supplier_id UUID DEFAULT NULL,
  p_new_supplier_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier_id UUID;
  v_supplier_name TEXT;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'staff')
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF (p_supplier_id IS NULL) = (NULLIF(trim(COALESCE(p_new_supplier_name, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'Choose an existing supplier or enter one new supplier name';
  END IF;
  PERFORM 1 FROM public.purchase_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase request unavailable';
  END IF;

  IF p_supplier_id IS NOT NULL THEN
    SELECT id INTO v_supplier_id
    FROM public.suppliers
    WHERE id = p_supplier_id AND is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'supplier unavailable';
    END IF;
  ELSE
    v_supplier_name := trim(p_new_supplier_name);
    SELECT id, supplier_name INTO v_supplier_id, v_supplier_name
    FROM public.suppliers
    WHERE lower(trim(supplier_name)) = lower(v_supplier_name)
    LIMIT 1;
    IF v_supplier_id IS NULL THEN
      INSERT INTO public.suppliers(supplier_name, created_by)
      VALUES (v_supplier_name, auth.uid())
      RETURNING id INTO v_supplier_id;
    END IF;
  END IF;

  UPDATE public.purchase_requests
  SET supplier_id = v_supplier_id,
      supplier_name = v_supplier_name,
      updated_at = now()
  WHERE id = p_request_id;
  RETURN v_supplier_id;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON public.suppliers FROM authenticated;
DROP POLICY IF EXISTS "suppliers write" ON public.suppliers;
DROP POLICY IF EXISTS suppliers_write ON public.suppliers;
DROP POLICY IF EXISTS suppliers_update ON public.suppliers;

GRANT EXECUTE ON FUNCTION public.receive_purchase_request(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_purchase_request_supplier(UUID, UUID, TEXT) TO authenticated;
