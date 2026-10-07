CREATE OR REPLACE FUNCTION public.release_production_from_quote(p_job_order_id UUID, p_idempotency_key TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bom UUID; v_quote UUID; v_count INTEGER;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'owner or admin release required'; END IF;
  SELECT quotation_id INTO v_quote FROM public.job_orders WHERE id = p_job_order_id FOR UPDATE;
  IF v_quote IS NULL THEN RAISE EXCEPTION 'job order not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.quotations WHERE id=v_quote AND status='approved') THEN RAISE EXCEPTION 'job order quotation must be approved'; END IF;
  SELECT id INTO v_bom FROM public.job_boms WHERE job_order_id=p_job_order_id;
  IF v_bom IS NULL THEN INSERT INTO public.job_boms(job_order_id,template_version,released_at,released_by) VALUES(p_job_order_id,1,now(),auth.uid()) RETURNING id INTO v_bom; END IF;
  INSERT INTO public.job_bom_items(job_bom_id,material_id,planned_quantity,unit)
  SELECT v_bom, material_id, estimated_quantity, unit FROM public.quote_material_estimates WHERE quotation_id=v_quote ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 AND NOT EXISTS (SELECT 1 FROM public.job_bom_items WHERE job_bom_id=v_bom) THEN RAISE EXCEPTION 'No materials found on the approved project item'; END IF;
  INSERT INTO public.production_jobs(job_order_id,job_type,status) VALUES(p_job_order_id,'general','partially_reserved') ON CONFLICT (job_order_id) DO UPDATE SET status=CASE WHEN production_jobs.status='not_started' THEN 'partially_reserved' ELSE production_jobs.status END,updated_at=now();
  RETURN v_bom;
END; $$;
GRANT EXECUTE ON FUNCTION public.release_production_from_quote(UUID,TEXT) TO authenticated;
