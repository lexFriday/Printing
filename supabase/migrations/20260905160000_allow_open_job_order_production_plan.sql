BEGIN;

-- New Job Orders use `open`; older records may use `pending`. Both are valid
-- pre-production states and must be accepted when creating/releasing a plan.
CREATE OR REPLACE FUNCTION public.create_production_plan(
  p_job_order_id UUID,
  p_job_type TEXT,
  p_responsible_user_id UUID DEFAULT NULL
)
RETURNS public.production_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.job_orders%ROWTYPE; v_result public.production_jobs%ROWTYPE;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')) THEN RAISE EXCEPTION 'owner or admin plan creation required'; END IF;
  SELECT * INTO v_job FROM public.job_orders WHERE job_orders.id = p_job_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job order not found'; END IF;
  IF v_job.status::TEXT NOT IN ('pending','open') THEN RAISE EXCEPTION 'only open or pending job orders can enter production'; END IF;
  INSERT INTO public.production_jobs(job_order_id, job_type, responsible_user_id, status)
  VALUES (p_job_order_id, COALESCE(NULLIF(trim(p_job_type), ''), 'general'), p_responsible_user_id, 'preparing')
  ON CONFLICT (job_order_id) DO UPDATE SET job_type = EXCLUDED.job_type, responsible_user_id = COALESCE(EXCLUDED.responsible_user_id, production_jobs.responsible_user_id), updated_at = now()
  RETURNING * INTO v_result;
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.release_production(
  p_job_order_id UUID, p_template_id UUID, p_idempotency_key TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bom UUID; v_version INTEGER; v_job public.job_orders%ROWTYPE; v_released_at TIMESTAMPTZ; v_existing_template UUID; v_has_draft_items BOOLEAN;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')) THEN RAISE EXCEPTION 'owner or admin release required'; END IF;
  IF COALESCE(trim(p_idempotency_key), '') = '' THEN RAISE EXCEPTION 'idempotency key required'; END IF;
  SELECT * INTO v_job FROM public.job_orders WHERE job_orders.id = p_job_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job order not found'; END IF;
  IF v_job.status::TEXT NOT IN ('pending','open') THEN RAISE EXCEPTION 'only open or pending job orders can be released'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.production_jobs WHERE job_order_id = p_job_order_id) THEN RAISE EXCEPTION 'create a production plan before releasing materials'; END IF;
  SELECT jb.id, jb.bom_template_id, jb.released_at INTO v_bom, v_existing_template, v_released_at FROM public.job_boms AS jb WHERE jb.job_order_id = p_job_order_id FOR UPDATE;
  IF v_released_at IS NOT NULL THEN IF v_existing_template IS DISTINCT FROM p_template_id THEN RAISE EXCEPTION 'released BOM cannot be replaced'; END IF; RETURN v_bom; END IF;
  v_has_draft_items := v_bom IS NOT NULL AND EXISTS (SELECT 1 FROM public.job_bom_items WHERE job_bom_id = v_bom);
  IF v_has_draft_items AND p_template_id IS NOT NULL THEN RAISE EXCEPTION 'Job Order already has prepared materials; release that BOM without a template'; END IF;
  IF NOT v_has_draft_items AND p_template_id IS NULL THEN RAISE EXCEPTION 'select a BOM template or prepare Job Order materials first'; END IF;
  IF p_template_id IS NOT NULL THEN
    SELECT version INTO v_version FROM public.bom_templates WHERE id = p_template_id AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'active BOM template not found'; END IF;
    INSERT INTO public.job_boms(job_order_id, bom_template_id, template_version, released_at, released_by) VALUES (p_job_order_id, p_template_id, v_version, now(), auth.uid()) ON CONFLICT (job_order_id) DO UPDATE SET bom_template_id = EXCLUDED.bom_template_id, template_version = EXCLUDED.template_version, released_at = EXCLUDED.released_at, released_by = EXCLUDED.released_by RETURNING id INTO v_bom;
    INSERT INTO public.job_bom_items(job_bom_id, material_id, planned_quantity, unit) SELECT v_bom, component.material_id, component.quantity, material.unit FROM public.bom_template_components AS component JOIN public.materials AS material ON material.id = component.material_id WHERE component.bom_template_id = p_template_id;
  ELSE UPDATE public.job_boms SET released_at = now(), released_by = auth.uid() WHERE id = v_bom RETURNING id INTO v_bom; END IF;
  UPDATE public.production_jobs SET status = 'partially_reserved', updated_at = now() WHERE job_order_id = p_job_order_id AND status IN ('not_started','preparing');
  RETURN v_bom;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_production_plan(UUID,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_production(UUID,UUID,TEXT) TO authenticated;
COMMIT;
