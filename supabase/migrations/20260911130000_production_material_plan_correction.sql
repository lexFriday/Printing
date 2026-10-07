BEGIN;

CREATE OR REPLACE FUNCTION public.correct_production_material_plan(
  p_job_order_id UUID,
  p_job_order_line_item_id UUID,
  p_material_id UUID,
  p_planned_quantity NUMERIC,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
DECLARE
  v_item public.job_bom_items%ROWTYPE;
  v_reserved NUMERIC;
  v_delta NUMERIC;
BEGIN
  IF NOT public.can_access_production_item(auth.uid(), p_job_order_line_item_id) THEN RAISE EXCEPTION 'You can correct only an assigned production item.'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'A correction reason is required.'; END IF;
  IF p_planned_quantity IS NULL OR p_planned_quantity <= 0 THEN RAISE EXCEPTION 'Planned quantity must be greater than zero.'; END IF;
  IF EXISTS (SELECT 1 FROM public.production_jobs WHERE job_order_id = p_job_order_id AND status = 'completed') THEN RAISE EXCEPTION 'Completed production cannot be corrected.'; END IF;
  SELECT item.* INTO v_item FROM public.job_bom_items item JOIN public.job_boms bom ON bom.id = item.job_bom_id WHERE bom.job_order_id = p_job_order_id AND item.job_order_line_item_id = p_job_order_line_item_id AND item.material_id = p_material_id FOR UPDATE;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'Production material not found.'; END IF;
  SELECT COALESCE(SUM(CASE WHEN movement_type='reservation' THEN quantity WHEN movement_type='reservation_release' THEN -quantity ELSE 0 END),0) INTO v_reserved FROM public.inventory_movements WHERE job_order_id=p_job_order_id AND material_id=p_material_id;
  v_delta := v_reserved - p_planned_quantity;
  UPDATE public.job_bom_items SET planned_quantity=p_planned_quantity WHERE id=v_item.id;
  IF v_delta > 0 THEN
    INSERT INTO public.inventory_movements(material_id, job_order_id, movement_type, quantity, idempotency_key, created_by) VALUES (p_material_id,p_job_order_id,'reservation_release',v_delta, 'correction-' || gen_random_uuid()::text, auth.uid());
  END IF;
  INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, old_values, new_values) VALUES (auth.uid(),'production.material_plan_corrected','job_order',p_job_order_id,jsonb_build_object('job_order_line_item_id',p_job_order_line_item_id,'material_id',p_material_id,'planned_quantity',v_item.planned_quantity,'reserved_quantity',v_reserved),jsonb_build_object('planned_quantity',p_planned_quantity,'released_reservation',GREATEST(v_delta,0),'reason',trim(p_reason)));
END; $$;

REVOKE ALL ON FUNCTION public.correct_production_material_plan(UUID,UUID,UUID,NUMERIC,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_production_material_plan(UUID,UUID,UUID,NUMERIC,TEXT) TO authenticated;
COMMIT;
