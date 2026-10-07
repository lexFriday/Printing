-- A Production plan is the operational handoff from a Job Order.  The client
-- treats the existing nullable composite RPC result as no plan when its
-- job_order_id is null. This migration enforces the release contract itself.

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
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')) THEN
    RAISE EXCEPTION 'owner or admin release required';
  END IF;
  IF COALESCE(trim(p_idempotency_key), '') = '' THEN
    RAISE EXCEPTION 'idempotency key required';
  END IF;

  SELECT * INTO v_job
  FROM public.job_orders
  WHERE id = p_job_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job order not found';
  END IF;
  IF v_job.status::TEXT <> 'open' THEN
    RAISE EXCEPTION 'only open job orders can be released';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.quotations quotation
    WHERE quotation.id = v_job.quotation_id AND quotation.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'job order quotation must be approved';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.production_jobs WHERE job_order_id = p_job_order_id
  ) THEN
    RAISE EXCEPTION 'create a production plan before releasing materials';
  END IF;

  SELECT version INTO v_version
  FROM public.bom_templates
  WHERE id = p_template_id AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active BOM template not found';
  END IF;
  SELECT bom_template_id INTO v_existing_template
  FROM public.job_boms
  WHERE job_order_id = p_job_order_id;
  IF v_existing_template IS NOT NULL AND v_existing_template <> p_template_id THEN
    RAISE EXCEPTION 'released BOM cannot be replaced';
  END IF;

  INSERT INTO public.job_boms(
    job_order_id,
    bom_template_id,
    template_version,
    released_at,
    released_by
  )
  VALUES (p_job_order_id, p_template_id, v_version, now(), auth.uid())
  ON CONFLICT (job_order_id) DO UPDATE SET id = job_boms.id
  RETURNING id INTO v_bom;

  INSERT INTO public.job_bom_items(job_bom_id, material_id, planned_quantity, unit)
  SELECT v_bom, component.material_id, component.quantity, material.unit
  FROM public.bom_template_components component
  JOIN public.materials material ON material.id = component.material_id
  WHERE component.bom_template_id = p_template_id
  ON CONFLICT DO NOTHING;

  UPDATE public.production_jobs
  SET status = 'partially_reserved', updated_at = now()
  WHERE job_order_id = p_job_order_id
    AND status IN ('not_started', 'preparing');

  RETURN v_bom;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_production(UUID, UUID, TEXT) TO authenticated;
