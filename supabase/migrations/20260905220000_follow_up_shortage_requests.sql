BEGIN;

-- A completed purchase request is immutable history, not an active resolution.
-- Permit a new linked request when production is still short after an earlier
-- request was fully received.
DROP INDEX IF EXISTS public.purchase_requests_job_material_unique;
CREATE UNIQUE INDEX purchase_requests_job_material_unique
  ON public.purchase_requests(job_order_id, material_id)
  WHERE job_order_id IS NOT NULL
    AND status IN ('requested', 'ordered', 'partially_received');

CREATE OR REPLACE FUNCTION public.create_shortage_request(
  p_job_order_id UUID,
  p_material_id UUID,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_planned NUMERIC; v_reserved NUMERIC; v_available NUMERIC; v_shortage NUMERIC; v_pack NUMERIC; v_requested NUMERIC; v_id UUID;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'staff')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF COALESCE(trim(p_idempotency_key), '') = '' THEN RAISE EXCEPTION 'idempotency key required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.production_jobs production JOIN public.job_boms bom ON bom.job_order_id = production.job_order_id WHERE production.job_order_id = p_job_order_id AND bom.released_at IS NOT NULL AND production.status IN ('preparing', 'partially_reserved', 'ready_to_start', 'in_progress')) THEN
    RAISE EXCEPTION 'release production before creating a shortage request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_material_id::TEXT));
  SELECT COALESCE(SUM(item.planned_quantity), 0) INTO v_planned FROM public.job_bom_items item JOIN public.job_boms bom ON bom.id = item.job_bom_id WHERE bom.job_order_id = p_job_order_id AND item.material_id = p_material_id;
  IF v_planned <= 0 THEN RAISE EXCEPTION 'material is not required by the released Job Order BOM'; END IF;
  SELECT COALESCE(SUM(CASE movement_type WHEN 'reservation' THEN quantity WHEN 'reservation_release' THEN -quantity ELSE 0 END), 0) INTO v_reserved FROM public.inventory_movements WHERE job_order_id = p_job_order_id AND material_id = p_material_id;
  SELECT available INTO v_available FROM public.inventory_balance(p_material_id);
  v_shortage := GREATEST(0, v_planned - v_reserved - v_available);
  IF v_shortage <= 0 THEN RAISE EXCEPTION 'no shortage exists'; END IF;
  SELECT COALESCE(pack_size, 1) INTO v_pack FROM public.materials WHERE id = p_material_id;
  v_requested := CEIL(v_shortage / v_pack) * v_pack;
  SELECT request.id INTO v_id
  FROM public.purchase_requests AS request
  WHERE request.job_order_id = p_job_order_id
    AND request.material_id = p_material_id
    AND request.status IN ('requested', 'ordered', 'partially_received')
  LIMIT 1 FOR UPDATE;
  IF v_id IS NULL THEN
    INSERT INTO public.purchase_requests(material_id, job_order_id, requested_quantity, received_quantity, status, requested_by)
    VALUES (p_material_id, p_job_order_id, v_requested, 0, 'requested', auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.purchase_requests
    SET requested_quantity = GREATEST(requested_quantity, v_requested), updated_at = now()
    WHERE id = v_id;
  END IF;
  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_shortage_request(UUID, UUID, TEXT) TO authenticated;

COMMIT;
