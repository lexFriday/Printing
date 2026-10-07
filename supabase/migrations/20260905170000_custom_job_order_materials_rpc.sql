BEGIN;

-- Custom-item material setup belongs to the Job Order when the quote has no
-- reusable Item Template. Keep it secured and editable only before BOM release.
CREATE OR REPLACE FUNCTION public.add_custom_job_order_material(
  p_job_order_id UUID,
  p_job_order_line_item_id UUID,
  p_material_id UUID,
  p_quantity NUMERIC,
  p_unit TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bom UUID;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'owner or admin material setup required'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR COALESCE(trim(p_unit),'') = '' THEN RAISE EXCEPTION 'material quantity and unit are required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.job_order_line_items AS line WHERE line.id=p_job_order_line_item_id AND line.job_order_id=p_job_order_id) THEN RAISE EXCEPTION 'Job Order item not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.materials AS material WHERE material.id=p_material_id) THEN RAISE EXCEPTION 'Material not found'; END IF;
  SELECT jb.id INTO v_bom FROM public.job_boms AS jb WHERE jb.job_order_id=p_job_order_id FOR UPDATE;
  IF v_bom IS NOT NULL AND EXISTS (SELECT 1 FROM public.job_boms AS jb WHERE jb.id=v_bom AND jb.released_at IS NOT NULL) THEN RAISE EXCEPTION 'Released Job Order BOM is immutable'; END IF;
  IF v_bom IS NULL THEN INSERT INTO public.job_boms(job_order_id,template_version) VALUES(p_job_order_id,1) RETURNING id INTO v_bom; END IF;
  INSERT INTO public.job_bom_items(job_bom_id,job_order_line_item_id,material_id,planned_quantity,unit)
  VALUES(v_bom,p_job_order_line_item_id,p_material_id,p_quantity,trim(p_unit))
  ON CONFLICT (job_bom_id,job_order_line_item_id,material_id) DO UPDATE SET planned_quantity=EXCLUDED.planned_quantity,unit=EXCLUDED.unit;
  RETURN v_bom;
END; $$;
GRANT EXECUTE ON FUNCTION public.add_custom_job_order_material(UUID,UUID,UUID,NUMERIC,TEXT) TO authenticated;
COMMIT;
