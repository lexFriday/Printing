-- Physical material activity belongs to an active Production document.  A
-- consumption or waste entry also releases its matching reservation so the
-- derived available balance is not reduced twice.

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
  IF p_job_order_id IS NOT NULL AND v_production_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Production is closed';
  END IF;

  IF p_movement_type IN ('consumption', 'return', 'waste')
    AND v_production_status NOT IN ('in_progress', 'for_reconciliation') THEN
    RAISE EXCEPTION 'Start production before recording material activity';
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
    IF p_quantity > v_reserved THEN
      RAISE EXCEPTION 'Material activity exceeds the reserved quantity';
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
    material_id,
    job_order_id,
    movement_type,
    quantity,
    idempotency_key,
    created_by
  )
  VALUES (
    p_material_id,
    p_job_order_id,
    p_movement_type,
    p_quantity,
    p_idempotency_key,
    auth.uid()
  )
  RETURNING id INTO v_id;

  IF p_movement_type IN ('consumption', 'waste') THEN
    INSERT INTO public.inventory_movements(
      material_id,
      job_order_id,
      movement_type,
      quantity,
      idempotency_key,
      created_by
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
  UUID,
  UUID,
  public.inventory_movement_type,
  NUMERIC,
  TEXT
) TO authenticated;
