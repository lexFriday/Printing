-- Production may start only when the released Job Order BOM is fully reserved.
-- Readiness is derived from the immutable BOM snapshot and append-only ledger.

CREATE OR REPLACE FUNCTION public.production_material_readiness(p_job_order_id UUID)
RETURNS TABLE(
  material_id UUID,
  planned_quantity NUMERIC,
  reserved_quantity NUMERIC,
  shortage_quantity NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH requirements AS (
    SELECT
      item.material_id,
      SUM(item.planned_quantity)::NUMERIC AS planned_quantity
    FROM public.job_boms bom
    JOIN public.job_bom_items item ON item.job_bom_id = bom.id
    WHERE bom.job_order_id = p_job_order_id
    GROUP BY item.material_id
  ),
  reservations AS (
    SELECT
      movement.material_id,
      COALESCE(SUM(
        CASE
          WHEN movement.movement_type = 'reservation' THEN movement.quantity
          WHEN movement.movement_type = 'reservation_release' THEN -movement.quantity
          ELSE 0
        END
      ), 0)::NUMERIC AS reserved_quantity
    FROM public.inventory_movements movement
    WHERE movement.job_order_id = p_job_order_id
    GROUP BY movement.material_id
  )
  SELECT
    requirement.material_id,
    requirement.planned_quantity,
    GREATEST(0, COALESCE(reservation.reserved_quantity, 0)) AS reserved_quantity,
    GREATEST(
      0,
      requirement.planned_quantity - GREATEST(0, COALESCE(reservation.reserved_quantity, 0))
    ) AS shortage_quantity
  FROM requirements requirement
  LEFT JOIN reservations reservation USING (material_id)
  ORDER BY requirement.material_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.production_material_readiness(UUID) TO authenticated;

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
    'reservation',
    p_quantity,
    p_idempotency_key,
    auth.uid()
  )
  ON CONFLICT (idempotency_key) DO UPDATE
    SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING id INTO v_id;

  SELECT
    COUNT(*) > 0 AND COALESCE(BOOL_AND(readiness.shortage_quantity = 0), FALSE)
  INTO v_is_ready
  FROM public.production_material_readiness(p_job_order_id) readiness;

  UPDATE public.production_jobs
  SET
    status = CASE
      WHEN v_is_ready THEN 'ready_to_start'::public.production_status
      ELSE 'partially_reserved'::public.production_status
    END,
    updated_at = now()
  WHERE job_order_id = p_job_order_id
    AND status IN ('preparing', 'partially_reserved', 'ready_to_start');

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_production(
  p_job_order_id UUID,
  p_idempotency_key TEXT
)
RETURNS public.production_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result public.production_jobs%ROWTYPE;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'staff')
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key = '' THEN
    RAISE EXCEPTION 'idempotency key required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.job_boms WHERE job_order_id = p_job_order_id
  ) THEN
    RAISE EXCEPTION 'prepare a BOM before starting production';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.production_material_readiness(p_job_order_id) readiness
    WHERE readiness.shortage_quantity > 0
  ) THEN
    RAISE EXCEPTION 'reserve all planned materials before starting production';
  END IF;

  UPDATE public.production_jobs
  SET
    status = 'in_progress',
    started_at = COALESCE(started_at, now()),
    updated_at = now()
  WHERE job_order_id = p_job_order_id
    AND status IN ('ready_to_start', 'partially_reserved', 'preparing')
  RETURNING * INTO v_result;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'production is not ready to start';
  END IF;

  UPDATE public.job_orders
  SET
    status = 'in_production',
    production_started_at = COALESCE(production_started_at, now()),
    updated_at = now()
  WHERE id = p_job_order_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job order is not pending';
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_inventory(UUID, UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_production(UUID, TEXT) TO authenticated;
