-- Align guarded operational functions with the canonical column names.
-- bom_templates uses is_active; suppliers uses name/active.

CREATE OR REPLACE FUNCTION public.release_production(
  p_job_order_id UUID,
  p_template_id UUID,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bom UUID;
  v_version INTEGER;
  v_job public.job_orders%ROWTYPE;
  v_existing_template UUID;
  v_released_at TIMESTAMPTZ;
  v_has_draft_items BOOLEAN;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')) THEN
    RAISE EXCEPTION 'owner or admin release required';
  END IF;
  IF COALESCE(trim(p_idempotency_key), '') = '' THEN
    RAISE EXCEPTION 'idempotency key required';
  END IF;
  SELECT * INTO v_job FROM public.job_orders WHERE id = p_job_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job order not found'; END IF;
  IF v_job.status::TEXT NOT IN ('pending', 'open') THEN
    RAISE EXCEPTION 'only pending job orders can be released';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.production_jobs WHERE job_order_id = p_job_order_id) THEN
    RAISE EXCEPTION 'create a production plan before releasing materials';
  END IF;
  SELECT id, bom_template_id, released_at INTO v_bom, v_existing_template, v_released_at
    FROM public.job_boms WHERE job_order_id = p_job_order_id FOR UPDATE;
  IF v_released_at IS NOT NULL THEN
    IF v_existing_template IS DISTINCT FROM p_template_id THEN
      RAISE EXCEPTION 'released BOM cannot be replaced';
    END IF;
    RETURN v_bom;
  END IF;
  v_has_draft_items := v_bom IS NOT NULL AND EXISTS (SELECT 1 FROM public.job_bom_items WHERE job_bom_id = v_bom);
  IF v_has_draft_items AND p_template_id IS NOT NULL THEN
    RAISE EXCEPTION 'Job Order already has prepared materials; release that BOM without a template';
  END IF;
  IF NOT v_has_draft_items AND p_template_id IS NULL THEN
    RAISE EXCEPTION 'select a BOM template or prepare Job Order materials first';
  END IF;
  IF p_template_id IS NOT NULL THEN
    SELECT version INTO v_version FROM public.bom_templates WHERE id = p_template_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'active BOM template not found'; END IF;
    INSERT INTO public.job_boms(job_order_id, bom_template_id, template_version, released_at, released_by)
      VALUES (p_job_order_id, p_template_id, v_version, now(), auth.uid())
      ON CONFLICT (job_order_id) DO UPDATE SET bom_template_id = EXCLUDED.bom_template_id, template_version = EXCLUDED.template_version, released_at = EXCLUDED.released_at, released_by = EXCLUDED.released_by
      RETURNING id INTO v_bom;
    INSERT INTO public.job_bom_items(job_bom_id, material_id, planned_quantity, unit)
      SELECT v_bom, c.material_id, c.quantity, m.unit
      FROM public.bom_template_components c JOIN public.materials m ON m.id = c.material_id
      WHERE c.bom_template_id = p_template_id ON CONFLICT DO NOTHING;
  ELSE
    UPDATE public.job_boms SET released_at = now(), released_by = auth.uid() WHERE id = v_bom RETURNING id INTO v_bom;
  END IF;
  UPDATE public.production_jobs SET status = 'partially_reserved', updated_at = now()
    WHERE job_order_id = p_job_order_id AND status IN ('not_started', 'preparing');
  RETURN v_bom;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_purchase_request_supplier(
  p_request_id UUID,
  p_supplier_id UUID DEFAULT NULL,
  p_new_supplier_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_supplier_id UUID; v_supplier_name TEXT;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'staff')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF (p_supplier_id IS NULL) = (NULLIF(trim(COALESCE(p_new_supplier_name, '')), '') IS NULL) THEN RAISE EXCEPTION 'Choose an existing supplier or enter one new supplier name'; END IF;
  PERFORM 1 FROM public.purchase_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'purchase request unavailable'; END IF;
  IF p_supplier_id IS NOT NULL THEN
    SELECT id, name INTO v_supplier_id, v_supplier_name FROM public.suppliers WHERE id = p_supplier_id AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier unavailable'; END IF;
  ELSE
    v_supplier_name := trim(p_new_supplier_name);
    SELECT id, name INTO v_supplier_id, v_supplier_name FROM public.suppliers WHERE lower(trim(name)) = lower(v_supplier_name) LIMIT 1;
    IF v_supplier_id IS NULL THEN INSERT INTO public.suppliers(name) VALUES (v_supplier_name) RETURNING id INTO v_supplier_id; END IF;
  END IF;
  UPDATE public.purchase_requests SET supplier_id = v_supplier_id, supplier_name = v_supplier_name, updated_at = now() WHERE id = p_request_id;
  RETURN v_supplier_id;
END;
$$;
