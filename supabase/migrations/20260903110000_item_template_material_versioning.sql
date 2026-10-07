ALTER TABLE public.item_template_materials
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS item_template_materials_current_idx
  ON public.item_template_materials(item_template_id, active);

CREATE OR REPLACE FUNCTION public.save_item_template_material_version(
  p_item_template_id UUID,
  p_components JSONB,
  p_idempotency_key TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_next INTEGER;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')) THEN
    RAISE EXCEPTION 'Only an owner or admin can manage template materials';
  END IF;
  IF p_item_template_id IS NULL OR COALESCE(trim(p_idempotency_key), '') = '' THEN
    RAISE EXCEPTION 'Template and idempotency key are required';
  END IF;
  IF jsonb_typeof(p_components) <> 'array' OR jsonb_array_length(p_components) = 0 THEN
    RAISE EXCEPTION 'A template needs at least one material';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_item_template_id::text));
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next
  FROM public.item_template_materials WHERE item_template_id = p_item_template_id;
  UPDATE public.item_template_materials SET active = false WHERE item_template_id = p_item_template_id AND active = true;
  INSERT INTO public.item_template_materials(item_template_id, material_id, quantity, basis, version, active)
  SELECT p_item_template_id, c.material_id, c.quantity, c.basis::public.material_component_basis, v_next, true
  FROM jsonb_to_recordset(p_components) AS c(material_id UUID, quantity NUMERIC, basis TEXT);
  IF NOT FOUND THEN RAISE EXCEPTION 'A template needs at least one material'; END IF;
  IF EXISTS (SELECT 1 FROM public.item_template_materials WHERE item_template_id = p_item_template_id AND version = v_next AND (quantity <= 0 OR material_id IS NULL)) THEN
    RAISE EXCEPTION 'Material quantities must be positive';
  END IF;
  RETURN v_next;
END; $$;

UPDATE public.item_template_materials SET active = true WHERE version = 1;

CREATE OR REPLACE FUNCTION public.snapshot_quote_materials(p_quotation_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF EXISTS (SELECT 1 FROM public.quotations WHERE id=p_quotation_id AND status::text NOT IN ('draft','pending_manager_approval','pending_customer_approval')) THEN RAISE EXCEPTION 'quote materials are locked'; END IF;
  DELETE FROM public.quote_material_estimates WHERE quotation_id=p_quotation_id;
  INSERT INTO public.quote_material_estimates (quotation_id,quote_line_item_id,item_template_id,item_template_version,material_id,material_name,unit,basis,component_quantity,estimated_quantity)
  SELECT q.id,l.id,l.item_template_id,COALESCE(l.item_template_version,1),m.id,m.name,m.unit,tm.basis,tm.quantity,
    CASE tm.basis WHEN 'per_item' THEN tm.quantity*l.quantity WHEN 'per_sqft' THEN tm.quantity*COALESCE(l.computed_sqft,0)*l.quantity ELSE tm.quantity END
  FROM public.quote_line_items l JOIN public.quotations q ON q.id=l.quotation_id
  JOIN public.item_template_materials tm ON tm.item_template_id=l.item_template_id AND tm.active = true
  JOIN public.materials m ON m.id=tm.material_id
  WHERE q.id=p_quotation_id AND ((tm.basis <> 'per_sqft') OR COALESCE(l.computed_sqft,0) > 0);
END; $$;

GRANT EXECUTE ON FUNCTION public.save_item_template_material_version(UUID, JSONB, TEXT) TO authenticated;
