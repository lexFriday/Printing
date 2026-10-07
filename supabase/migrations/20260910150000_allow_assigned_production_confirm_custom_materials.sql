BEGIN;

-- The Production workspace asks an assigned operator to define materials for a
-- custom item before release. Keep authorization scoped to that exact item.
CREATE OR REPLACE FUNCTION public.add_custom_job_order_material(
  p_job_order_id UUID,
  p_job_order_line_item_id UUID,
  p_material_id UUID,
  p_quantity NUMERIC,
  p_unit TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bom UUID;
  v_released_at TIMESTAMPTZ;
  v_unit TEXT;
BEGIN
  IF NOT public.can_access_production_item(auth.uid(), p_job_order_line_item_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Owner, Admin, Staff, or an assigned Production user is required';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Material quantity is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.job_order_line_items line
    WHERE line.id = p_job_order_line_item_id AND line.job_order_id = p_job_order_id
  ) THEN
    RAISE EXCEPTION 'Job Order item not found';
  END IF;

  SELECT material.unit INTO v_unit
  FROM public.materials material
  WHERE material.id = p_material_id AND material.is_active = TRUE;
  IF v_unit IS NULL THEN RAISE EXCEPTION 'Active material not found'; END IF;

  SELECT bom.id, bom.released_at INTO v_bom, v_released_at
  FROM public.job_boms bom
  WHERE bom.job_order_id = p_job_order_id
  FOR UPDATE;

  IF v_bom IS NULL THEN
    INSERT INTO public.job_boms(job_order_id, template_version)
    VALUES (p_job_order_id, 1)
    RETURNING id INTO v_bom;
  END IF;

  IF v_released_at IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.production_jobs production
      WHERE production.job_order_id = p_job_order_id
        AND production.status IN ('preparing', 'partially_reserved', 'ready_to_start', 'in_progress')
    ) THEN
      RAISE EXCEPTION 'Materials cannot be added at this production stage';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.job_bom_items item
      WHERE item.job_bom_id = v_bom
        AND item.job_order_line_item_id = p_job_order_line_item_id
        AND item.material_id = p_material_id
    ) THEN
      RAISE EXCEPTION 'This material is already assigned to the selected item';
    END IF;

    INSERT INTO public.job_bom_items(
      job_bom_id, job_order_line_item_id, material_id, planned_quantity, unit,
      is_supplemental, added_after_release_by, added_after_release_at, supplement_reason
    ) VALUES (
      v_bom, p_job_order_line_item_id, p_material_id, p_quantity, v_unit,
      TRUE, auth.uid(), now(), 'Missing material discovered after BOM release'
    );
  ELSE
    UPDATE public.job_bom_items
    SET planned_quantity = p_quantity, unit = v_unit
    WHERE job_bom_id = v_bom
      AND job_order_line_item_id = p_job_order_line_item_id
      AND material_id = p_material_id
      AND is_supplemental = FALSE;
    IF NOT FOUND THEN
      INSERT INTO public.job_bom_items(
        job_bom_id, job_order_line_item_id, material_id, planned_quantity, unit
      ) VALUES (
        v_bom, p_job_order_line_item_id, p_material_id, p_quantity, v_unit
      );
    END IF;
  END IF;

  INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, new_values)
  VALUES (
    auth.uid(),
    CASE WHEN v_released_at IS NULL
      THEN 'production.material_added'
      ELSE 'production.missing_material_added'
    END,
    'job_order', p_job_order_id,
    jsonb_build_object(
      'job_order_line_item_id', p_job_order_line_item_id,
      'material_id', p_material_id,
      'quantity', p_quantity,
      'unit', v_unit,
      'is_supplemental', v_released_at IS NOT NULL
    )
  );
  RETURN v_bom;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_custom_item_materials(
  p_job_order_id UUID,
  p_job_order_line_item_id UUID,
  p_materials JSONB,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_material JSONB;
  v_bom UUID;
BEGIN
  IF NOT public.can_access_production_item(auth.uid(), p_job_order_line_item_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Owner, Admin, Staff, or an assigned Production user is required';
  END IF;
  IF COALESCE(trim(p_idempotency_key), '') = '' THEN
    RAISE EXCEPTION 'Idempotency key is required';
  END IF;
  IF jsonb_typeof(p_materials) <> 'array' OR jsonb_array_length(p_materials) < 1 THEN
    RAISE EXCEPTION 'Add at least one material';
  END IF;
  IF jsonb_array_length(p_materials) > 20 THEN
    RAISE EXCEPTION 'Add up to 20 materials at a time';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_materials) material
    WHERE COALESCE(material->>'materialId', '') = ''
      OR COALESCE((material->>'quantity')::NUMERIC, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'Every material needs a valid quantity';
  END IF;
  IF (
    SELECT count(DISTINCT material->>'materialId')
    FROM jsonb_array_elements(p_materials) material
  ) <> jsonb_array_length(p_materials) THEN
    RAISE EXCEPTION 'Each material can only be added once';
  END IF;

  FOR v_material IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    PERFORM public.add_custom_job_order_material(
      p_job_order_id,
      p_job_order_line_item_id,
      (v_material->>'materialId')::UUID,
      (v_material->>'quantity')::NUMERIC,
      COALESCE(v_material->>'unit', '')
    );
  END LOOP;

  v_bom := public.release_production_from_quote(p_job_order_id, p_idempotency_key);
  INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, new_values)
  VALUES (
    auth.uid(), 'production.custom_materials_confirmed', 'job_order', p_job_order_id,
    jsonb_build_object('job_order_line_item_id', p_job_order_line_item_id, 'materials', p_materials)
  );
  RETURN v_bom;
END;
$$;

REVOKE ALL ON FUNCTION public.add_custom_job_order_material(UUID, UUID, UUID, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_custom_item_materials(UUID, UUID, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_custom_job_order_material(UUID, UUID, UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_custom_item_materials(UUID, UUID, JSONB, TEXT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
