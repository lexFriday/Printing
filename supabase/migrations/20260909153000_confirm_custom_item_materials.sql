BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_custom_item_materials(
  p_job_order_id UUID,
  p_job_order_line_item_id UUID,
  p_materials JSONB,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public AS $$
DECLARE
  v_material JSONB;
  v_bom UUID;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner')) THEN
    RAISE EXCEPTION 'Owner or Admin access is required to confirm custom-item materials';
  END IF;
  IF COALESCE(trim(p_idempotency_key),'')='' THEN RAISE EXCEPTION 'Idempotency key is required'; END IF;
  IF jsonb_typeof(p_materials)<>'array' OR jsonb_array_length(p_materials)<1 THEN
    RAISE EXCEPTION 'Add at least one material';
  END IF;
  IF jsonb_array_length(p_materials)>20 THEN RAISE EXCEPTION 'Add up to 20 materials at a time'; END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_materials) AS material
    WHERE COALESCE(material->>'materialId','')=''
      OR COALESCE((material->>'quantity')::NUMERIC,0)<=0
  ) THEN
    RAISE EXCEPTION 'Every material needs a valid quantity';
  END IF;
  IF (
    SELECT count(DISTINCT material->>'materialId')
    FROM jsonb_array_elements(p_materials) AS material
  )<>jsonb_array_length(p_materials) THEN
    RAISE EXCEPTION 'Each material can only be added once';
  END IF;

  FOR v_material IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    PERFORM public.add_custom_job_order_material(
      p_job_order_id,
      p_job_order_line_item_id,
      (v_material->>'materialId')::UUID,
      (v_material->>'quantity')::NUMERIC,
      COALESCE(v_material->>'unit','')
    );
  END LOOP;

  v_bom := public.release_production_from_quote(p_job_order_id,p_idempotency_key);

  INSERT INTO public.audit_logs(user_id,action,entity_type,entity_id,new_values)
  VALUES(
    auth.uid(),
    'production.custom_materials_confirmed',
    'job_order',
    p_job_order_id,
    jsonb_build_object('job_order_line_item_id',p_job_order_line_item_id,'materials',p_materials)
  );

  RETURN v_bom;
END; $$;

GRANT EXECUTE ON FUNCTION public.confirm_custom_item_materials(UUID,UUID,JSONB,TEXT) TO authenticated;

COMMIT;
