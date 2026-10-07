-- Allow production to record actual overuse without exposing reservation mechanics.
CREATE OR REPLACE FUNCTION public.record_production_material_activity(
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
  v_reserved NUMERIC;
  v_available NUMERIC;
  v_shortfall NUMERIC;
  v_id UUID;
BEGIN
  IF p_movement_type NOT IN ('consumption', 'waste') THEN
    RETURN public.record_inventory_movement(p_material_id, p_job_order_id, p_movement_type, p_quantity, p_idempotency_key);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_material_id::TEXT));
  SELECT COALESCE(SUM(CASE WHEN movement_type = 'reservation' THEN quantity WHEN movement_type = 'reservation_release' THEN -quantity ELSE 0 END), 0)
    INTO v_reserved
    FROM public.inventory_movements
   WHERE job_order_id = p_job_order_id AND material_id = p_material_id;
  v_shortfall := GREATEST(0, p_quantity - v_reserved);
  IF v_shortfall > 0 THEN
    SELECT available INTO v_available FROM public.inventory_balance(p_material_id);
    IF COALESCE(v_available, 0) < v_shortfall THEN
      RAISE EXCEPTION 'Insufficient available inventory for additional material activity';
    END IF;
    INSERT INTO public.inventory_movements(material_id, job_order_id, movement_type, quantity, idempotency_key, created_by)
    VALUES (p_material_id, p_job_order_id, 'reservation', v_shortfall, p_idempotency_key || ':auto-reservation', auth.uid());
  END IF;
  v_id := public.record_inventory_movement(p_material_id, p_job_order_id, p_movement_type, p_quantity, p_idempotency_key);
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_production_material_activity(UUID, UUID, public.inventory_movement_type, NUMERIC, TEXT) TO authenticated;
