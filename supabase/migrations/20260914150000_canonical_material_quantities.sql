-- Canonical material quantities: inventory remains in the material's unit.
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS inventory_unit TEXT;
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS roll_width_ft NUMERIC(12,4);
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS roll_length_ft NUMERIC(12,4);

UPDATE public.materials
SET inventory_unit = unit
WHERE inventory_unit IS NULL;

ALTER TABLE public.job_bom_items
  ADD COLUMN IF NOT EXISTS inventory_quantity NUMERIC(14,6);
ALTER TABLE public.job_bom_items
  ADD COLUMN IF NOT EXISTS inventory_unit TEXT;

CREATE OR REPLACE FUNCTION public.convert_material_quantity(
  p_material_id UUID,
  p_quantity NUMERIC,
  p_input_unit TEXT
)
RETURNS TABLE(
  entered_quantity NUMERIC,
  entered_unit TEXT,
  inventory_quantity NUMERIC,
  inventory_unit TEXT,
  conversion_factor NUMERIC,
  capacity_description TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.materials%ROWTYPE;
  v_factor NUMERIC;
  v_input TEXT := lower(trim(p_input_unit));
  v_inventory TEXT;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 OR v_input = '' THEN
    RAISE EXCEPTION 'A positive quantity and unit are required.';
  END IF;
  SELECT * INTO m FROM public.materials WHERE id = p_material_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material is inactive or unavailable.'; END IF;
  v_inventory := lower(COALESCE(m.inventory_unit, m.unit));
  IF v_input = v_inventory THEN
    v_factor := 1;
  ELSIF v_inventory = 'roll' AND lower(m.category) LIKE '%tarpaulin%' AND v_input IN ('sqft','ft2','square feet') THEN
    IF m.roll_width_ft IS NULL OR m.roll_length_ft IS NULL OR m.roll_width_ft <= 0 OR m.roll_length_ft <= 0 THEN
      RAISE EXCEPTION 'Tarpaulin roll dimensions are not configured.';
    END IF;
    v_factor := 1 / (m.roll_width_ft * m.roll_length_ft);
  ELSE
    RAISE EXCEPTION 'No verified conversion exists from % to % for this material.', p_input_unit, v_inventory;
  END IF;
  RETURN QUERY SELECT p_quantity, p_input_unit, p_quantity * v_factor, v_inventory, v_factor,
    CASE WHEN v_inventory = 'roll' AND m.roll_width_ft IS NOT NULL AND m.roll_length_ft IS NOT NULL
      THEN format('%s ft × %s ft = %s sq ft per roll', m.roll_width_ft, m.roll_length_ft, m.roll_width_ft * m.roll_length_ft)
      ELSE NULL END;
END; $$;

CREATE OR REPLACE FUNCTION public.snapshot_job_bom_inventory_quantity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c RECORD;
BEGIN
  SELECT * INTO c FROM public.convert_material_quantity(NEW.material_id, NEW.planned_quantity, NEW.unit);
  NEW.inventory_quantity := c.inventory_quantity;
  NEW.inventory_unit := c.inventory_unit;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS job_bom_items_inventory_snapshot ON public.job_bom_items;
CREATE TRIGGER job_bom_items_inventory_snapshot
BEFORE INSERT OR UPDATE OF material_id, planned_quantity, unit ON public.job_bom_items
FOR EACH ROW EXECUTE FUNCTION public.snapshot_job_bom_inventory_quantity();

UPDATE public.job_bom_items item
SET inventory_quantity = c.inventory_quantity, inventory_unit = c.inventory_unit
FROM (
  SELECT i.id, x.inventory_quantity, x.inventory_unit
  FROM public.job_bom_items i
  CROSS JOIN LATERAL public.convert_material_quantity(i.material_id, i.planned_quantity, i.unit) x
) c
WHERE item.id = c.id;

GRANT EXECUTE ON FUNCTION public.convert_material_quantity(UUID, NUMERIC, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_custom_job_order_material(
  p_job_order_id UUID, p_job_order_line_item_id UUID, p_material_id UUID,
  p_quantity NUMERIC, p_unit TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bom UUID;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'owner or admin material setup required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.job_order_line_items WHERE id=p_job_order_line_item_id AND job_order_id=p_job_order_id) THEN RAISE EXCEPTION 'Job Order item not found'; END IF;
  SELECT id INTO v_bom FROM public.job_boms WHERE job_order_id=p_job_order_id FOR UPDATE;
  IF v_bom IS NOT NULL AND EXISTS (SELECT 1 FROM public.job_boms WHERE id=v_bom AND released_at IS NOT NULL) THEN RAISE EXCEPTION 'Released Job Order BOM is immutable'; END IF;
  IF v_bom IS NULL THEN INSERT INTO public.job_boms(job_order_id,template_version) VALUES(p_job_order_id,1) RETURNING id INTO v_bom; END IF;
  INSERT INTO public.job_bom_items(job_bom_id,job_order_line_item_id,material_id,planned_quantity,unit)
  VALUES(v_bom,p_job_order_line_item_id,p_material_id,p_quantity,trim(p_unit))
  ON CONFLICT (job_bom_id,job_order_line_item_id,material_id)
  DO UPDATE SET planned_quantity=EXCLUDED.planned_quantity, unit=EXCLUDED.unit;
  RETURN v_bom;
END; $$;
GRANT EXECUTE ON FUNCTION public.add_custom_job_order_material(UUID,UUID,UUID,NUMERIC,TEXT) TO authenticated;
