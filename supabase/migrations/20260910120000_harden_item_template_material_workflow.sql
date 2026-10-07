BEGIN;

ALTER TABLE public.item_template_materials
  ADD COLUMN IF NOT EXISTS save_idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS item_template_materials_save_key_idx
  ON public.item_template_materials(item_template_id, save_idempotency_key)
  WHERE save_idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.save_item_template_material_version(
  p_item_template_id UUID,
  p_components JSONB,
  p_idempotency_key TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next INTEGER;
  v_existing INTEGER;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only an owner or admin can manage template materials';
  END IF;
  IF p_item_template_id IS NULL OR COALESCE(trim(p_idempotency_key), '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Template and idempotency key are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.item_templates WHERE id = p_item_template_id AND is_active) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An active item template is required';
  END IF;
  IF jsonb_typeof(p_components) <> 'array' OR jsonb_array_length(p_components) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A template needs at least one material';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_components) AS component(material_id UUID, quantity NUMERIC, basis TEXT)
    WHERE material_id IS NULL OR quantity IS NULL OR quantity::TEXT = 'NaN' OR quantity <= 0
      OR basis IS NULL OR basis NOT IN ('per_item', 'per_sqft', 'fixed_per_line')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Every component needs a material, positive quantity, and valid basis';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_components) AS component(material_id UUID, quantity NUMERIC, basis TEXT)
    GROUP BY material_id, basis
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'A material can appear only once per basis';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_components) AS component(material_id UUID, quantity NUMERIC, basis TEXT)
    LEFT JOIN public.materials material ON material.id = component.material_id
    WHERE material.id IS NULL OR material.is_active IS NOT TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Recipe components must use active materials';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_item_template_id::text));

  SELECT version INTO v_existing
  FROM public.item_template_materials
  WHERE item_template_id = p_item_template_id
    AND save_idempotency_key = p_idempotency_key
  LIMIT 1;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next
  FROM public.item_template_materials
  WHERE item_template_id = p_item_template_id;

  UPDATE public.item_template_materials
  SET active = false
  WHERE item_template_id = p_item_template_id AND active;

  INSERT INTO public.item_template_materials(
    item_template_id, material_id, quantity, basis, version, active, save_idempotency_key
  )
  SELECT p_item_template_id, component.material_id, component.quantity,
         component.basis::public.material_component_basis, v_next, true, p_idempotency_key
  FROM jsonb_to_recordset(p_components) AS component(material_id UUID, quantity NUMERIC, basis TEXT);

  RETURN v_next;
END;
$$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.item_template_materials FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_item_template_material_version(UUID, JSONB, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.snapshot_quote_materials(p_quotation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized';
  END IF;

  SELECT status::TEXT INTO v_status
  FROM public.quotations
  WHERE id = p_quotation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Quote not found';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Submitted quote materials are locked';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.quote_line_items line
    JOIN public.item_template_materials component ON component.item_template_id = line.item_template_id AND component.active
    WHERE line.quotation_id = p_quotation_id
    GROUP BY line.item_template_id
    HAVING count(DISTINCT component.version) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A selected template has conflicting active recipe versions';
  END IF;

  UPDATE public.quote_line_items line
  SET item_template_version = recipe.version
  FROM (
    SELECT item_template_id, MAX(version) AS version
    FROM public.item_template_materials
    WHERE active
    GROUP BY item_template_id
  ) recipe
  WHERE line.quotation_id = p_quotation_id
    AND line.item_template_id = recipe.item_template_id;

  DELETE FROM public.quote_material_estimates
  WHERE quotation_id = p_quotation_id;

  INSERT INTO public.quote_material_estimates(
    quotation_id, quote_line_item_id, item_template_id, item_template_version,
    material_id, material_name, unit, basis, component_quantity, estimated_quantity
  )
  SELECT quote.id, line.id, line.item_template_id, component.version,
         material.id, material.name, material.unit, component.basis, component.quantity,
         CASE component.basis
           WHEN 'per_item' THEN component.quantity * line.quantity
           WHEN 'per_sqft' THEN component.quantity * COALESCE(line.computed_sqft, 0) * line.quantity
           ELSE component.quantity
         END
  FROM public.quote_line_items line
  JOIN public.quotations quote ON quote.id = line.quotation_id
  JOIN public.item_template_materials component
    ON component.item_template_id = line.item_template_id AND component.active
  JOIN public.materials material ON material.id = component.material_id
  WHERE quote.id = p_quotation_id
    AND (component.basis <> 'per_sqft' OR COALESCE(line.computed_sqft, 0) > 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_quote_materials(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.replace_quote_lines_and_snapshot(
  p_quotation_id UUID,
  p_lines JSONB
)
RETURNS TABLE(id UUID, sort_order INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A quote needs at least one line';
  END IF;

  SELECT status::TEXT INTO v_status
  FROM public.quotations
  WHERE quotations.id = p_quotation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Quote not found';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Only draft quote lines can be changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_lines) AS line(id UUID)
    JOIN public.quote_line_items existing ON existing.id = line.id
    WHERE existing.quotation_id <> p_quotation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Quote line does not belong to this quote';
  END IF;

  UPDATE public.quote_attachments attachment
  SET quote_line_item_id = NULL
  WHERE attachment.quote_line_item_id IN (
    SELECT existing.id
    FROM public.quote_line_items existing
    WHERE existing.quotation_id = p_quotation_id
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_to_recordset(p_lines) AS line(id UUID)
        WHERE line.id = existing.id
      )
  );

  DELETE FROM public.quote_line_items existing
  WHERE existing.quotation_id = p_quotation_id
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_lines) AS line(id UUID)
      WHERE line.id = existing.id
    );

  INSERT INTO public.quote_line_items(
    id, quotation_id, item_template_id, description, pricing_mode, unit_of_measure,
    width, height, rate_per_sqft, quantity, computed_sqft, unit_price, line_total,
    no_charge, adjustment_label, adjustment_amount, sort_order
  )
  SELECT COALESCE(line.id, gen_random_uuid()), p_quotation_id, line.item_template_id,
         trim(line.description), line.pricing_mode::public.pricing_mode,
         line.unit_of_measure::public.unit_of_measure, line.width, line.height,
         line.rate_per_sqft, line.quantity, line.computed_sqft, line.unit_price,
         line.line_total, COALESCE(line.no_charge, false),
         COALESCE(NULLIF(trim(line.adjustment_label), ''), 'Adjustment'),
         COALESCE(line.adjustment_amount, 0), line.sort_order
  FROM jsonb_to_recordset(p_lines) AS line(
    id UUID, item_template_id UUID, description TEXT, pricing_mode TEXT,
    unit_of_measure TEXT, width NUMERIC, height NUMERIC, rate_per_sqft NUMERIC,
    quantity NUMERIC, computed_sqft NUMERIC, unit_price NUMERIC, line_total NUMERIC,
    no_charge BOOLEAN, adjustment_label TEXT, adjustment_amount NUMERIC, sort_order INTEGER
  )
  ON CONFLICT ON CONSTRAINT quote_line_items_pkey DO UPDATE SET
    item_template_id = EXCLUDED.item_template_id,
    description = EXCLUDED.description,
    pricing_mode = EXCLUDED.pricing_mode,
    unit_of_measure = EXCLUDED.unit_of_measure,
    width = EXCLUDED.width,
    height = EXCLUDED.height,
    rate_per_sqft = EXCLUDED.rate_per_sqft,
    quantity = EXCLUDED.quantity,
    computed_sqft = EXCLUDED.computed_sqft,
    unit_price = EXCLUDED.unit_price,
    line_total = EXCLUDED.line_total,
    no_charge = EXCLUDED.no_charge,
    adjustment_label = EXCLUDED.adjustment_label,
    adjustment_amount = EXCLUDED.adjustment_amount,
    sort_order = EXCLUDED.sort_order;

  PERFORM public.snapshot_quote_materials(p_quotation_id);

  RETURN QUERY
  SELECT quote_line.id, quote_line.sort_order
  FROM public.quote_line_items quote_line
  WHERE quote_line.quotation_id = p_quotation_id
  ORDER BY quote_line.sort_order, quote_line.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_quote_lines_and_snapshot(UUID, JSONB) TO authenticated;

COMMIT;
