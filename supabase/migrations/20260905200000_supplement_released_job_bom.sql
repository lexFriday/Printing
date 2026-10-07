BEGIN;

-- Released BOM rows remain unchanged. Newly discovered requirements are appended
-- as supplemental rows so readiness and purchasing include them without losing
-- who added them or when they were added.
ALTER TABLE public.job_bom_items
  ADD COLUMN IF NOT EXISTS is_supplemental BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS added_after_release_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS added_after_release_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS supplement_reason TEXT;

DROP INDEX IF EXISTS public.job_bom_items_line_material_key;
CREATE UNIQUE INDEX job_bom_items_original_line_material_key
  ON public.job_bom_items(job_bom_id,job_order_line_item_id,material_id)
  WHERE is_supplemental = FALSE;

CREATE OR REPLACE FUNCTION public.add_custom_job_order_material(
  p_job_order_id UUID,
  p_job_order_line_item_id UUID,
  p_material_id UUID,
  p_quantity NUMERIC,
  p_unit TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bom UUID; v_released_at TIMESTAMPTZ; v_unit TEXT;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'owner or admin material setup required'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'material quantity is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.job_order_line_items AS line WHERE line.id=p_job_order_line_item_id AND line.job_order_id=p_job_order_id) THEN RAISE EXCEPTION 'Job Order item not found'; END IF;
  SELECT material.unit INTO v_unit FROM public.materials AS material WHERE material.id=p_material_id;
  IF v_unit IS NULL THEN RAISE EXCEPTION 'Material not found'; END IF;

  SELECT bom.id,bom.released_at INTO v_bom,v_released_at FROM public.job_boms AS bom WHERE bom.job_order_id=p_job_order_id FOR UPDATE;
  IF v_bom IS NULL THEN
    INSERT INTO public.job_boms(job_order_id,template_version) VALUES(p_job_order_id,1) RETURNING id INTO v_bom;
  END IF;

  IF v_released_at IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.production_jobs AS production WHERE production.job_order_id=p_job_order_id AND production.status IN ('preparing','partially_reserved','ready_to_start','in_progress')) THEN
      RAISE EXCEPTION 'materials cannot be added at this production stage';
    END IF;
    INSERT INTO public.job_bom_items(job_bom_id,job_order_line_item_id,material_id,planned_quantity,unit,is_supplemental,added_after_release_by,added_after_release_at,supplement_reason)
    VALUES(v_bom,p_job_order_line_item_id,p_material_id,p_quantity,v_unit,TRUE,auth.uid(),now(),'Missing material discovered after BOM release');
  ELSE
    UPDATE public.job_bom_items
    SET planned_quantity=p_quantity,unit=v_unit
    WHERE job_bom_id=v_bom AND job_order_line_item_id=p_job_order_line_item_id AND material_id=p_material_id AND is_supplemental=FALSE;
    IF NOT FOUND THEN
      INSERT INTO public.job_bom_items(job_bom_id,job_order_line_item_id,material_id,planned_quantity,unit)
      VALUES(v_bom,p_job_order_line_item_id,p_material_id,p_quantity,v_unit);
    END IF;
  END IF;
  RETURN v_bom;
END; $$;
GRANT EXECUTE ON FUNCTION public.add_custom_job_order_material(UUID,UUID,UUID,NUMERIC,TEXT) TO authenticated;

COMMIT;
