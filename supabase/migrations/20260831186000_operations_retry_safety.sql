-- A client can retry after a network timeout.  Idempotency must be checked
-- before derived balances or request counters are changed.
CREATE OR REPLACE FUNCTION public.reserve_inventory(
  p_material_id UUID,
  p_job_order_id UUID,
  p_quantity NUMERIC,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_available NUMERIC;
  v_is_ready BOOLEAN;
  v_remaining NUMERIC;
  v_existing public.inventory_movements%ROWTYPE;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'staff')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_quantity <= 0 OR COALESCE(trim(p_idempotency_key), '') = '' THEN
    RAISE EXCEPTION 'Invalid reservation';
  END IF;

  SELECT * INTO v_existing
  FROM public.inventory_movements
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.material_id <> p_material_id
      OR v_existing.job_order_id <> p_job_order_id
      OR v_existing.movement_type <> 'reservation'
      OR v_existing.quantity <> p_quantity THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different inventory action';
    END IF;
    RETURN v_existing.id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.job_orders
    WHERE id = p_job_order_id AND status::TEXT IN ('cancelled', 'completed')
  ) THEN
    RAISE EXCEPTION 'Job cannot allocate inventory';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.production_jobs
    WHERE job_order_id = p_job_order_id AND status::TEXT IN ('completed', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'Production is closed';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_material_id::TEXT));
  SELECT readiness.shortage_quantity INTO v_remaining
  FROM public.production_material_readiness(p_job_order_id) readiness
  WHERE readiness.material_id = p_material_id;
  IF v_remaining IS NULL THEN
    RAISE EXCEPTION 'Material is not required by the released Job Order BOM';
  END IF;
  IF p_quantity > v_remaining THEN
    RAISE EXCEPTION 'Reservation exceeds the remaining planned quantity';
  END IF;
  SELECT balance.available INTO v_available
  FROM public.inventory_balance(p_material_id) balance;
  IF COALESCE(v_available, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient available inventory';
  END IF;

  INSERT INTO public.inventory_movements(
    material_id, job_order_id, movement_type, quantity, idempotency_key, created_by
  ) VALUES (
    p_material_id, p_job_order_id, 'reservation', p_quantity, p_idempotency_key, auth.uid()
  ) RETURNING id INTO v_id;

  SELECT COUNT(*) > 0 AND COALESCE(BOOL_AND(readiness.shortage_quantity = 0), FALSE)
  INTO v_is_ready
  FROM public.production_material_readiness(p_job_order_id) readiness;

  UPDATE public.production_jobs
  SET status = CASE WHEN v_is_ready THEN 'ready_to_start'::public.production_status
                    ELSE 'partially_reserved'::public.production_status END,
      updated_at = now()
  WHERE job_order_id = p_job_order_id
    AND status IN ('preparing', 'partially_reserved', 'ready_to_start');
  RETURN v_id;
END;
$$;

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
  UPDATE public.purchase_requests
  SET received_quantity = received_quantity + p_quantity,
      status = (CASE WHEN received_quantity + p_quantity >= requested_quantity
                     THEN 'received' ELSE 'partially_received' END)::purchase_request_status,
      updated_at = now()
  WHERE id = p_request_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_inventory(UUID, UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_purchase_request(UUID, NUMERIC, TEXT) TO authenticated;
