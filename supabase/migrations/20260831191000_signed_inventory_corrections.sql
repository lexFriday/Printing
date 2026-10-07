-- Corrections are compensating ledger rows, never edits to a stock balance.
ALTER TYPE public.inventory_movement_type ADD VALUE IF NOT EXISTS 'correction_reversal';

CREATE OR REPLACE FUNCTION public.inventory_balance(p_material_id UUID)
RETURNS TABLE(on_hand NUMERIC, reserved NUMERIC, available NUMERIC)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH totals AS (
    SELECT
      COALESCE(SUM(CASE
        WHEN movement_type IN ('receipt', 'return', 'correction') THEN quantity
        WHEN movement_type::text IN ('consumption', 'waste', 'correction_reversal') THEN -quantity
        ELSE 0
      END), 0) AS on_hand,
      COALESCE(SUM(CASE
        WHEN movement_type = 'reservation' THEN quantity
        WHEN movement_type = 'reservation_release' THEN -quantity
        ELSE 0
      END), 0) AS reserved
    FROM public.inventory_movements
    WHERE material_id = p_material_id
  )
  SELECT on_hand, reserved, GREATEST(0, on_hand - reserved) FROM totals;
$$;

CREATE OR REPLACE FUNCTION public.record_inventory_correction(
  p_material_id UUID,
  p_quantity_delta NUMERIC,
  p_reason TEXT,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_existing public.inventory_movements%ROWTYPE;
  v_on_hand NUMERIC;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')) THEN
    RAISE EXCEPTION 'Owner or Admin approval is required for inventory corrections';
  END IF;
  IF p_quantity_delta = 0 OR COALESCE(trim(p_reason), '') = ''
     OR COALESCE(trim(p_idempotency_key), '') = '' THEN
    RAISE EXCEPTION 'Quantity, reason, and idempotency key are required';
  END IF;
  SELECT * INTO v_existing FROM public.inventory_movements WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.material_id <> p_material_id
      OR v_existing.quantity <> abs(p_quantity_delta)
      OR v_existing.movement_type <> (CASE WHEN p_quantity_delta > 0 THEN 'correction'::public.inventory_movement_type ELSE 'correction_reversal'::public.inventory_movement_type END) THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different correction';
    END IF;
    RETURN v_existing.id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_material_id::TEXT));
  SELECT on_hand INTO v_on_hand FROM public.inventory_balance(p_material_id);
  IF p_quantity_delta < 0 AND COALESCE(v_on_hand, 0) < abs(p_quantity_delta) THEN
    RAISE EXCEPTION 'Correction cannot reduce stock below zero';
  END IF;
  INSERT INTO public.inventory_movements(
    material_id, movement_type, quantity, notes, idempotency_key, created_by
  ) VALUES (
    p_material_id,
    CASE WHEN p_quantity_delta > 0 THEN 'correction'::public.inventory_movement_type ELSE 'correction_reversal'::public.inventory_movement_type END,
    abs(p_quantity_delta),
    trim(p_reason),
    p_idempotency_key,
    auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_inventory_correction(UUID, NUMERIC, TEXT, TEXT) TO authenticated;
