-- Connect the approved quotation material snapshot to the Job Order BOM.
-- Existing historical Job Orders are left untouched.
CREATE OR REPLACE FUNCTION public.snapshot_job_order_materials()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bom UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.quote_material_estimates WHERE quotation_id=NEW.quotation_id) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.job_boms(job_order_id, bom_template_id, template_version, released_at, released_by)
    VALUES (NEW.id, NULL, 1, NULL, NULL)
    ON CONFLICT (job_order_id) DO NOTHING
    RETURNING id INTO v_bom;
  IF v_bom IS NULL THEN SELECT id INTO v_bom FROM public.job_boms WHERE job_order_id=NEW.id; END IF;
  INSERT INTO public.job_bom_items(job_bom_id, material_id, planned_quantity, unit)
    SELECT v_bom, material_id, SUM(estimated_quantity), unit
    FROM public.quote_material_estimates
    WHERE quotation_id=NEW.quotation_id
    GROUP BY material_id, unit
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_snapshot_job_order_materials ON public.job_orders;
CREATE TRIGGER trg_snapshot_job_order_materials
  AFTER INSERT ON public.job_orders FOR EACH ROW EXECUTE FUNCTION public.snapshot_job_order_materials();

-- Production completion and Job Order readiness are one atomic business event.
CREATE OR REPLACE FUNCTION public.complete_production(p_job_order_id UUID,p_idempotency_key TEXT)
RETURNS public.production_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result public.production_jobs%ROWTYPE;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'owner or admin approval required'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key='' THEN RAISE EXCEPTION 'idempotency key required'; END IF;
  UPDATE public.production_jobs SET status='completed',completed_at=COALESCE(completed_at,now()),updated_at=now()
    WHERE job_order_id=p_job_order_id AND status='for_reconciliation' RETURNING * INTO v_result;
  IF NOT FOUND THEN RAISE EXCEPTION 'production must be reconciled before completion'; END IF;
  UPDATE public.job_orders SET status='ready', ready_at=COALESCE(ready_at,now()), updated_at=now()
    WHERE id=p_job_order_id AND status='in_production';
  IF NOT FOUND THEN RAISE EXCEPTION 'job order is not in production'; END IF;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.complete_production(UUID,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_production(p_job_order_id UUID, p_idempotency_key TEXT)
RETURNS public.production_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result public.production_jobs%ROWTYPE;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key='' THEN RAISE EXCEPTION 'idempotency key required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.job_boms WHERE job_order_id=p_job_order_id) THEN RAISE EXCEPTION 'prepare a BOM before starting production'; END IF;
  UPDATE public.production_jobs SET status='in_progress', started_at=COALESCE(started_at,now()), updated_at=now()
    WHERE job_order_id=p_job_order_id AND status IN ('partially_reserved','ready_to_start','preparing') RETURNING * INTO v_result;
  IF NOT FOUND THEN RAISE EXCEPTION 'production is not ready to start'; END IF;
  UPDATE public.job_orders SET status='in_production', production_started_at=COALESCE(production_started_at,now()), updated_at=now()
    WHERE id=p_job_order_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'job order is not pending'; END IF;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.start_production(UUID,TEXT) TO authenticated;
