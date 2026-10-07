BEGIN;

-- Sales users are allowed to create and edit their own draft quotations.
-- Keep the existing restrictions for inventory and other operational RPCs.
CREATE OR REPLACE FUNCTION public.snapshot_quote_materials(p_quotation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR
          public.has_role(auth.uid(),'staff') OR public.has_role(auth.uid(),'sales')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized';
  END IF;
  SELECT status::TEXT INTO v_status FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Quote not found'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Submitted quote materials are locked'; END IF;
  UPDATE public.quote_line_items line
  SET item_template_version = recipe.version
  FROM (SELECT item_template_id, MAX(version) AS version FROM public.item_template_materials WHERE active GROUP BY item_template_id) recipe
  WHERE line.quotation_id = p_quotation_id AND line.item_template_id = recipe.item_template_id;
  DELETE FROM public.quote_material_estimates WHERE quotation_id = p_quotation_id;
  INSERT INTO public.quote_material_estimates(quotation_id, quote_line_item_id, item_template_id, item_template_version, material_id, material_name, unit, basis, component_quantity, estimated_quantity)
  SELECT quote.id, line.id, line.item_template_id, component.version, material.id, material.name, material.unit, component.basis, component.quantity,
    CASE component.basis WHEN 'per_item' THEN component.quantity * line.quantity WHEN 'per_sqft' THEN component.quantity * COALESCE(line.computed_sqft, 0) * line.quantity ELSE component.quantity END
  FROM public.quote_line_items line
  JOIN public.quotations quote ON quote.id = line.quotation_id
  JOIN public.item_template_materials component ON component.item_template_id = line.item_template_id AND component.active
  JOIN public.materials material ON material.id = component.material_id
  WHERE quote.id = p_quotation_id AND (component.basis <> 'per_sqft' OR COALESCE(line.computed_sqft, 0) > 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_quote_lines_and_snapshot(p_quotation_id UUID, p_lines JSONB)
RETURNS TABLE(id UUID, sort_order INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_status TEXT;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff') OR public.has_role(auth.uid(),'sales')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A quote needs at least one line';
  END IF;
  SELECT status::TEXT INTO v_status FROM public.quotations WHERE quotations.id = p_quotation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Quote not found'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Only draft quote lines can be changed'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_lines) AS line(id UUID) JOIN public.quote_line_items existing ON existing.id = line.id WHERE existing.quotation_id <> p_quotation_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Quote line does not belong to this quote';
  END IF;
  UPDATE public.quote_attachments SET quote_line_item_id = NULL WHERE quote_line_item_id IN (SELECT existing.id FROM public.quote_line_items existing WHERE existing.quotation_id = p_quotation_id AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(p_lines) AS line(id UUID) WHERE line.id = existing.id));
  DELETE FROM public.quote_line_items existing WHERE existing.quotation_id = p_quotation_id AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(p_lines) AS line(id UUID) WHERE line.id = existing.id);
  INSERT INTO public.quote_line_items(id, quotation_id, item_template_id, description, pricing_mode, unit_of_measure, width, height, rate_per_sqft, quantity, computed_sqft, unit_price, line_total, no_charge, adjustment_label, adjustment_amount, sort_order)
  SELECT COALESCE(line.id, gen_random_uuid()), p_quotation_id, line.item_template_id, trim(line.description), line.pricing_mode::public.pricing_mode, line.unit_of_measure::public.unit_of_measure, line.width, line.height, line.rate_per_sqft, line.quantity, line.computed_sqft, line.unit_price, line.line_total, COALESCE(line.no_charge, false), COALESCE(NULLIF(trim(line.adjustment_label), ''), 'Adjustment'), COALESCE(line.adjustment_amount, 0), line.sort_order
  FROM jsonb_to_recordset(p_lines) AS line(id UUID, item_template_id UUID, description TEXT, pricing_mode TEXT, unit_of_measure TEXT, width NUMERIC, height NUMERIC, rate_per_sqft NUMERIC, quantity NUMERIC, computed_sqft NUMERIC, unit_price NUMERIC, line_total NUMERIC, no_charge BOOLEAN, adjustment_label TEXT, adjustment_amount NUMERIC, sort_order INTEGER)
  ON CONFLICT ON CONSTRAINT quote_line_items_pkey DO UPDATE SET item_template_id = EXCLUDED.item_template_id, description = EXCLUDED.description, pricing_mode = EXCLUDED.pricing_mode, unit_of_measure = EXCLUDED.unit_of_measure, width = EXCLUDED.width, height = EXCLUDED.height, rate_per_sqft = EXCLUDED.rate_per_sqft, quantity = EXCLUDED.quantity, computed_sqft = EXCLUDED.computed_sqft, unit_price = EXCLUDED.unit_price, line_total = EXCLUDED.line_total, no_charge = EXCLUDED.no_charge, adjustment_label = EXCLUDED.adjustment_label, adjustment_amount = EXCLUDED.adjustment_amount, sort_order = EXCLUDED.sort_order;
  PERFORM public.snapshot_quote_materials(p_quotation_id);
  RETURN QUERY SELECT quote_line.id, quote_line.sort_order FROM public.quote_line_items quote_line WHERE quote_line.quotation_id = p_quotation_id ORDER BY quote_line.sort_order, quote_line.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_quote_materials(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_quote_lines_and_snapshot(UUID, JSONB) TO authenticated;
COMMIT;
