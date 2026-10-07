-- Reconciliation is the hand-off from execution to completion.  Material activity
-- must be recorded while production is in progress; later changes use the
-- existing exception/correction paths and require an explicit new reconciliation.
CREATE OR REPLACE FUNCTION public.record_inventory_movement(
  p_material_id UUID,
  p_job_order_id UUID,
  p_movement_type public.inventory_movement_type,
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
  v_reserved NUMERIC;
  v_available NUMERIC;
  v_shortfall NUMERIC;
  v_net_consumption NUMERIC;
  v_production_status public.production_status;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'staff')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_quantity <= 0 OR COALESCE(trim(p_idempotency_key), '') = '' THEN
    RAISE EXCEPTION 'Invalid movement';
  END IF;
  IF p_movement_type = 'reservation' THEN
    RAISE EXCEPTION 'Use reserve_inventory for reservations';
  END IF;
  IF p_movement_type <> 'receipt' AND p_job_order_id IS NULL THEN
    RAISE EXCEPTION 'Job is required for this movement';
  END IF;

  SELECT id INTO v_id
  FROM public.inventory_movements
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  IF p_job_order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.job_orders
    WHERE id = p_job_order_id AND status::TEXT IN ('cancelled', 'completed')
  ) THEN
    RAISE EXCEPTION 'Job cannot receive new material activity';
  END IF;

  SELECT status INTO v_production_status
  FROM public.production_jobs
  WHERE job_order_id = p_job_order_id;
  IF p_job_order_id IS NOT NULL AND v_production_status IS NULL THEN
    RAISE EXCEPTION 'create a production plan before recording material activity';
  END IF;
  IF p_job_order_id IS NOT NULL AND v_production_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Production is closed';
  END IF;
  IF p_movement_type IN ('consumption', 'return', 'waste')
    AND COALESCE(v_production_status::TEXT, '') <> 'in_progress' THEN
    RAISE EXCEPTION 'Record material activity before reconciling production';
  END IF;
  IF p_movement_type = 'correction'
    AND NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')) THEN
    RAISE EXCEPTION 'Owner or Admin approval is required for inventory corrections';
  END IF;

  IF p_movement_type IN ('consumption', 'waste') THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_material_id::TEXT));
    SELECT COALESCE(SUM(
      CASE
        WHEN movement_type = 'reservation' THEN quantity
        WHEN movement_type = 'reservation_release' THEN -quantity
        ELSE 0
      END
    ), 0)
    INTO v_reserved
    FROM public.inventory_movements
    WHERE job_order_id = p_job_order_id AND material_id = p_material_id;
    v_shortfall := GREATEST(0, p_quantity - v_reserved);
    IF v_shortfall > 0 THEN
      SELECT available INTO v_available
      FROM public.inventory_balance(p_material_id);
      IF COALESCE(v_available, 0) < v_shortfall THEN
        RAISE EXCEPTION 'Insufficient available inventory for additional material activity';
      END IF;
      INSERT INTO public.inventory_movements(
        material_id, job_order_id, movement_type, quantity, idempotency_key, created_by
      ) VALUES (
        p_material_id, p_job_order_id, 'reservation', v_shortfall,
        p_idempotency_key || ':auto-reservation', auth.uid()
      );
    END IF;
  END IF;

  IF p_movement_type = 'return' THEN
    SELECT COALESCE(SUM(
      CASE
        WHEN movement_type = 'consumption' THEN quantity
        WHEN movement_type = 'return' THEN -quantity
        ELSE 0
      END
    ), 0)
    INTO v_net_consumption
    FROM public.inventory_movements
    WHERE job_order_id = p_job_order_id AND material_id = p_material_id;
    IF p_quantity > v_net_consumption THEN
      RAISE EXCEPTION 'Return cannot exceed material already recorded as consumed';
    END IF;
  END IF;

  INSERT INTO public.inventory_movements(
    material_id, job_order_id, movement_type, quantity, idempotency_key, created_by
  )
  VALUES (
    p_material_id, p_job_order_id, p_movement_type, p_quantity, p_idempotency_key, auth.uid()
  )
  RETURNING id INTO v_id;

  IF p_movement_type IN ('consumption', 'waste') THEN
    INSERT INTO public.inventory_movements(
      material_id, job_order_id, movement_type, quantity, idempotency_key, created_by
    )
    VALUES (
      p_material_id,
      p_job_order_id,
      'reservation_release',
      p_quantity,
      p_idempotency_key || ':reservation-release',
      auth.uid()
    );
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_inventory_movement(
  UUID, UUID, public.inventory_movement_type, NUMERIC, TEXT
) TO authenticated;
