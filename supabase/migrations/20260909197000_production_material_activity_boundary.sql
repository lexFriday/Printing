BEGIN;

-- Production workers need the usage ledger for their assigned Job Order, but
-- must not receive broad SELECT access to the inventory movement table.
CREATE OR REPLACE FUNCTION public.production_material_activity(p_job_order_id UUID)
RETURNS TABLE(material_id UUID, movement_type public.inventory_movement_type, quantity NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT movement.material_id, movement.movement_type, movement.quantity
  FROM public.inventory_movements movement
  WHERE movement.job_order_id = p_job_order_id
    AND public.can_access_production_job(auth.uid(), p_job_order_id)
    AND movement.movement_type IN ('consumption', 'return', 'waste');
$$;
REVOKE ALL ON FUNCTION public.production_material_activity(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_material_activity(UUID) TO authenticated;

-- Keep the existing retry-safe inventory implementation, but require a
-- Production worker's material to belong to an item they are assigned to.
CREATE OR REPLACE FUNCTION public.record_production_material_activity(
  p_material_id UUID,
  p_job_order_id UUID,
  p_movement_type public.inventory_movement_type,
  p_quantity NUMERIC,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, pg_temp
AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned items.';
  END IF;

  IF public.has_role(auth.uid(), 'production') AND NOT EXISTS (
    SELECT 1
    FROM public.job_boms bom
    JOIN public.job_bom_items item ON item.job_bom_id = bom.id
    WHERE bom.job_order_id = p_job_order_id
      AND item.material_id = p_material_id
      AND item.job_order_line_item_id IS NOT NULL
      AND public.can_access_production_item(auth.uid(), item.job_order_line_item_id)
  ) THEN
    RAISE EXCEPTION 'Production workers can only record materials for assigned items.';
  END IF;

  RETURN app_private.record_production_material_activity(
    p_material_id,
    p_job_order_id,
    p_movement_type,
    p_quantity,
    p_idempotency_key
  );
END;
$$;
REVOKE ALL ON FUNCTION public.record_production_material_activity(
  UUID, UUID, public.inventory_movement_type, NUMERIC, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_production_material_activity(
  UUID, UUID, public.inventory_movement_type, NUMERIC, TEXT
) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
