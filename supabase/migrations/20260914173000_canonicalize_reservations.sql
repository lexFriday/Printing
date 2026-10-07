CREATE OR REPLACE FUNCTION public.reserve_inventory(
  p_material_id UUID, p_job_order_id UUID, p_quantity NUMERIC, p_idempotency_key TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, app_private, pg_temp AS $$
DECLARE
  input_unit TEXT;
  canonical NUMERIC;
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  SELECT min(item.unit) INTO input_unit
  FROM public.job_bom_items item
  JOIN public.job_boms bom ON bom.id = item.job_bom_id
  WHERE bom.job_order_id = p_job_order_id AND item.material_id = p_material_id;
  IF input_unit IS NULL THEN
    RAISE EXCEPTION 'Material is not part of this Job Order.';
  END IF;
  SELECT inventory_quantity INTO canonical
  FROM public.convert_material_quantity(p_material_id, p_quantity, input_unit);
  RETURN app_private.reserve_inventory(p_material_id, p_job_order_id, canonical, p_idempotency_key);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_inventory(UUID, UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_inventory(UUID, UUID, NUMERIC, TEXT) TO authenticated;
