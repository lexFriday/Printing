ALTER TABLE public.job_bom_items
  ADD COLUMN IF NOT EXISTS inventory_quantity NUMERIC,
  ADD COLUMN IF NOT EXISTS inventory_unit TEXT;

CREATE OR REPLACE FUNCTION public.snapshot_bom_inventory_quantity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c RECORD;
BEGIN
  SELECT * INTO c FROM public.convert_material_quantity(NEW.material_id, NEW.planned_quantity, NEW.unit);
  NEW.inventory_quantity := c.inventory_quantity;
  NEW.inventory_unit := c.inventory_unit;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_bom_items_canonical_quantity ON public.job_bom_items;
CREATE TRIGGER job_bom_items_canonical_quantity
BEFORE INSERT OR UPDATE OF material_id, planned_quantity, unit ON public.job_bom_items
FOR EACH ROW EXECUTE FUNCTION public.snapshot_bom_inventory_quantity();
