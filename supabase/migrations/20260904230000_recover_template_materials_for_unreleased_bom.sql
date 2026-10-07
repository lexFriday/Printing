CREATE OR REPLACE FUNCTION public.release_production_from_quote(p_job_order_id uuid, p_idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bom uuid;
  v_quote uuid;
  v_count integer;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')) THEN
    RAISE EXCEPTION 'owner or admin release required';
  END IF;
  SELECT quotation_id INTO v_quote FROM public.job_orders WHERE id = p_job_order_id FOR UPDATE;
  IF v_quote IS NULL THEN RAISE EXCEPTION 'job order not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.quotations WHERE id = v_quote AND status = 'approved') THEN
    RAISE EXCEPTION 'job order quotation must be approved';
  END IF;
  SELECT id INTO v_bom FROM public.job_boms WHERE job_order_id = p_job_order_id;
  IF v_bom IS NULL THEN
    INSERT INTO public.job_boms(job_order_id, template_version, released_at, released_by)
    VALUES (p_job_order_id, 1, now(), auth.uid()) RETURNING id INTO v_bom;
  ELSE
    UPDATE public.job_boms
    SET released_at = COALESCE(released_at, now()), released_by = COALESCE(released_by, auth.uid())
    WHERE id = v_bom;
  END IF;
  INSERT INTO public.job_bom_items(job_bom_id, material_id, planned_quantity, unit)
  SELECT v_bom, material_id, estimated_quantity, unit
  FROM public.quote_material_estimates
  WHERE quotation_id = v_quote
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Recover legacy approved quotes whose line has a matching Item Template but
  -- was created before quote material estimates were captured. This only runs
  -- for an unreleased/empty BOM and preserves released JO snapshots.
  IF v_count = 0 AND NOT EXISTS (SELECT 1 FROM public.job_bom_items WHERE job_bom_id = v_bom) THEN
    INSERT INTO public.job_bom_items(job_bom_id, material_id, planned_quantity, unit)
    SELECT v_bom,
           component.material_id,
           component.quantity * CASE WHEN component.basis::text = 'per_item' THEN line.quantity ELSE COALESCE(line.computed_sqft, 1) END,
           material.unit
    FROM public.job_order_line_items job_line
    JOIN public.quote_line_items line ON line.id = job_line.quote_line_item_id
    JOIN public.item_templates template ON lower(template.name) = lower(line.description) AND template.is_active = true
    JOIN public.item_template_materials component ON component.item_template_id = template.id AND component.active = true
    JOIN public.materials material ON material.id = component.material_id
    WHERE job_line.job_order_id = p_job_order_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;
  IF v_count = 0 AND NOT EXISTS (SELECT 1 FROM public.job_bom_items WHERE job_bom_id = v_bom) THEN
    RAISE EXCEPTION 'No materials found on the approved project item';
  END IF;
  INSERT INTO public.production_jobs(job_order_id, job_type, status)
  VALUES (p_job_order_id, 'general', 'partially_reserved')
  ON CONFLICT (job_order_id) DO UPDATE
  SET status = CASE WHEN production_jobs.status = 'not_started' THEN 'partially_reserved' ELSE production_jobs.status END,
      updated_at = now();
  RETURN v_bom;
END;
$function$;
