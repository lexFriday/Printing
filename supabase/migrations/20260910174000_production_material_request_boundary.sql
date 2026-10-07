BEGIN;

-- A Production request records procurement demand only. Supplier selection,
-- ordering, cancellation, and receiving remain in the existing Purchasing RPCs.
CREATE OR REPLACE FUNCTION public.request_missing_production_materials(
  p_job_order_id UUID,
  p_material_ids UUID[],
  p_idempotency_key TEXT
)
RETURNS TABLE(
  purchase_request_id UUID,
  material_id UUID,
  requested_quantity NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  requested_material RECORD;
  v_is_manager BOOLEAN;
  v_is_production BOOLEAN;
  v_planned NUMERIC;
  v_reserved NUMERIC;
  v_available NUMERIC;
  v_shortage NUMERIC;
  v_pack NUMERIC;
  v_requested NUMERIC;
  v_request_id UUID;
BEGIN
  IF NOT public.is_active_user(auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'An active account is required.';
  END IF;

  v_is_manager := public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin');
  v_is_production := public.has_role(auth.uid(), 'production');
  IF NOT (v_is_manager OR v_is_production) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Production or Purchasing access is required.';
  END IF;
  IF COALESCE(array_length(p_material_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Choose at least one missing material.';
  END IF;
  IF NULLIF(trim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'Idempotency key is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.production_jobs production
    JOIN public.job_boms bom ON bom.job_order_id = production.job_order_id
    WHERE production.job_order_id = p_job_order_id
      AND bom.released_at IS NOT NULL
      AND production.status IN ('preparing', 'partially_reserved', 'ready_to_start', 'in_progress')
  ) THEN
    RAISE EXCEPTION 'Release materials before requesting a purchase.';
  END IF;

  -- The key serializes an entire retry while the active Job Order/material
  -- uniqueness rule provides durable deduplication without duplicate batch state.
  PERFORM pg_advisory_xact_lock(hashtext(p_job_order_id::TEXT || ':' || p_idempotency_key));

  FOR requested_material IN
    SELECT DISTINCT requested_id AS material_id
    FROM unnest(p_material_ids) AS requested_id
    WHERE requested_id IS NOT NULL
    ORDER BY requested_id
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.job_bom_items item
      JOIN public.job_boms bom ON bom.id = item.job_bom_id
      WHERE bom.job_order_id = p_job_order_id
        AND bom.released_at IS NOT NULL
        AND item.material_id = requested_material.material_id
    ) THEN
      RAISE EXCEPTION 'A requested material is not part of the released Job Order BOM.';
    END IF;

    IF v_is_production AND NOT EXISTS (
      SELECT 1
      FROM public.job_bom_items item
      JOIN public.job_boms bom ON bom.id = item.job_bom_id
      WHERE bom.job_order_id = p_job_order_id
        AND bom.released_at IS NOT NULL
        AND item.material_id = requested_material.material_id
        AND public.can_access_production_item(auth.uid(), item.job_order_line_item_id)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'You can request materials only for assigned production items.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_job_order_id::TEXT || ':' || requested_material.material_id::TEXT));

    SELECT COALESCE(SUM(item.planned_quantity), 0)
    INTO v_planned
    FROM public.job_bom_items item
    JOIN public.job_boms bom ON bom.id = item.job_bom_id
    WHERE bom.job_order_id = p_job_order_id
      AND bom.released_at IS NOT NULL
      AND item.material_id = requested_material.material_id;

    SELECT COALESCE(SUM(
      CASE movement.movement_type
        WHEN 'reservation' THEN movement.quantity
        WHEN 'reservation_release' THEN -movement.quantity
        ELSE 0
      END
    ), 0)
    INTO v_reserved
    FROM public.inventory_movements movement
    WHERE movement.job_order_id = p_job_order_id
      AND movement.material_id = requested_material.material_id;

    SELECT COALESCE(balance.available, 0)
    INTO v_available
    FROM public.inventory_balance(requested_material.material_id) balance;

    v_shortage := GREATEST(0, v_planned - v_reserved - COALESCE(v_available, 0));
    IF v_shortage <= 0 THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(material.pack_size, 1)
    INTO v_pack
    FROM public.materials material
    WHERE material.id = requested_material.material_id
      AND material.is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A requested material is inactive or unavailable.';
    END IF;

    v_requested := CEIL(v_shortage / v_pack) * v_pack;
    INSERT INTO public.purchase_requests(
      material_id,
      job_order_id,
      requested_quantity,
      received_quantity,
      status,
      requested_by,
      created_by
    )
    VALUES (
      requested_material.material_id,
      p_job_order_id,
      v_requested,
      0,
      'requested',
      auth.uid(),
      auth.uid()
    )
    ON CONFLICT (job_order_id, material_id)
      WHERE job_order_id IS NOT NULL
        AND status IN ('requested', 'ordered', 'partially_received')
    DO UPDATE SET
      requested_quantity = GREATEST(public.purchase_requests.requested_quantity, EXCLUDED.requested_quantity),
      updated_at = now()
    RETURNING id, public.purchase_requests.requested_quantity
    INTO v_request_id, v_requested;

    RETURN QUERY
    SELECT v_request_id, requested_material.material_id, v_requested;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.request_missing_production_materials(UUID, UUID[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_missing_production_materials(UUID, UUID[], TEXT) TO authenticated;

-- Keep the movement ledger at Job Order/material level, but authorize and cap
-- each Production reservation against the selected item's derived readiness.
CREATE OR REPLACE FUNCTION public.reserve_production_item_inventory(
  p_job_order_id UUID,
  p_job_order_line_item_id UUID,
  p_material_id UUID,
  p_quantity NUMERIC,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, pg_temp
AS $$
DECLARE
  v_remaining NUMERIC;
BEGIN
  IF NOT public.can_access_production_item(auth.uid(), p_job_order_line_item_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'You can reserve materials only for an assigned production item.';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Enter a positive reservation quantity.';
  END IF;
  IF NULLIF(trim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'Idempotency key is required.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.job_bom_items item
    JOIN public.job_boms bom ON bom.id = item.job_bom_id
    WHERE bom.job_order_id = p_job_order_id
      AND bom.released_at IS NOT NULL
      AND item.job_order_line_item_id = p_job_order_line_item_id
      AND item.material_id = p_material_id
  ) THEN
    RAISE EXCEPTION 'The material is not part of this production item.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_job_order_id::TEXT || ':' || p_material_id::TEXT));
  SELECT COALESCE((required_material ->> 'shortage')::NUMERIC, 0)
  INTO v_remaining
  FROM app_private.production_item_readiness(p_job_order_id) readiness
  CROSS JOIN LATERAL jsonb_array_elements(readiness.required_materials) required_material
  WHERE readiness.job_order_line_item_id = p_job_order_line_item_id
    AND (required_material ->> 'material_id')::UUID = p_material_id;

  IF NOT FOUND OR v_remaining <= 0 THEN
    RAISE EXCEPTION 'This production item no longer needs a reservation for that material.';
  END IF;
  IF p_quantity > v_remaining THEN
    RAISE EXCEPTION 'Reservation exceeds the remaining requirement for this production item.';
  END IF;

  RETURN app_private.reserve_inventory(
    p_material_id,
    p_job_order_id,
    p_quantity,
    p_idempotency_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_production_item_inventory(UUID, UUID, UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_production_item_inventory(UUID, UUID, UUID, NUMERIC, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
