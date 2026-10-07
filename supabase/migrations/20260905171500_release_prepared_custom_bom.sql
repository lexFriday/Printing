BEGIN;

-- Complete the prepared custom-material path: an existing draft BOM must be
-- frozen when project materials are released, just like a newly-created BOM.
CREATE OR REPLACE FUNCTION public.release_production_from_quote(p_job_order_id UUID, p_idempotency_key TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bom UUID; v_quote UUID; v_count INTEGER;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'owner or admin release required'; END IF;
  SELECT quotation_id INTO v_quote FROM public.job_orders WHERE job_orders.id=p_job_order_id FOR UPDATE;
  IF v_quote IS NULL THEN RAISE EXCEPTION 'job order not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.quotations WHERE id=v_quote AND status='approved') THEN RAISE EXCEPTION 'job order quotation must be approved'; END IF;
  SELECT jb.id INTO v_bom FROM public.job_boms AS jb WHERE jb.job_order_id=p_job_order_id;
  IF v_bom IS NULL THEN INSERT INTO public.job_boms(job_order_id,template_version,released_at,released_by) VALUES(p_job_order_id,1,now(),auth.uid()) RETURNING id INTO v_bom; END IF;
  INSERT INTO public.job_bom_items(job_bom_id,job_order_line_item_id,material_id,planned_quantity,unit)
  SELECT v_bom,jol.id,qme.material_id,qme.estimated_quantity,qme.unit FROM public.quote_material_estimates AS qme JOIN public.job_order_line_items AS jol ON jol.job_order_id=p_job_order_id AND jol.quote_line_item_id=qme.quote_line_item_id WHERE qme.quotation_id=v_quote ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count=0 AND NOT EXISTS (SELECT 1 FROM public.job_bom_items WHERE job_bom_id=v_bom) THEN RAISE EXCEPTION 'Custom item has no project materials configured. Add materials to the Quote or Job Order, then use project materials here.'; END IF;
  UPDATE public.job_boms SET released_at=COALESCE(released_at,now()), released_by=COALESCE(released_by,auth.uid()) WHERE id=v_bom;
  INSERT INTO public.production_jobs(job_order_id,job_type,status) VALUES(p_job_order_id,'general','partially_reserved') ON CONFLICT (job_order_id) DO UPDATE SET status=CASE WHEN production_jobs.status='not_started' THEN 'partially_reserved' ELSE production_jobs.status END,updated_at=now();
  RETURN v_bom;
END; $$;
GRANT EXECUTE ON FUNCTION public.release_production_from_quote(UUID,TEXT) TO authenticated;
COMMIT;
