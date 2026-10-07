-- Complete, server-derived activity totals for one material.
-- The UI may show a recent movement window, but totals must never be limited
-- by that presentation window.
CREATE OR REPLACE FUNCTION public.inventory_material_activity_summary(p_material_id UUID)
RETURNS TABLE(consumed NUMERIC, returned NUMERIC, wasted NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'consumption'), 0),
    COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'return'), 0),
    COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'waste'), 0)
  FROM public.inventory_movements
  WHERE material_id = p_material_id;
$$;

GRANT EXECUTE ON FUNCTION public.inventory_material_activity_summary(UUID) TO authenticated;
