DROP FUNCTION IF EXISTS public.inventory_material_summary();

CREATE FUNCTION public.inventory_material_summary()
RETURNS TABLE(
  material_id uuid,
  material_name text,
  unit text,
  category text,
  pack_size numeric,
  reorder_threshold numeric,
  on_hand numeric,
  reserved numeric,
  available numeric,
  open_purchase_quantity numeric,
  open_purchase_request_id uuid,
  latest_movement_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    material.id,
    material.name,
    material.unit,
    material.category::text,
    material.pack_size,
    material.reorder_threshold,
    COALESCE(balance.on_hand, 0),
    COALESCE(balance.reserved, 0),
    COALESCE(balance.available, 0),
    COALESCE(purchases.open_purchase_quantity, 0),
    purchases.open_purchase_request_id,
    latest.created_at
  FROM public.materials material
  LEFT JOIN LATERAL public.inventory_balance(material.id) balance ON true
  LEFT JOIN LATERAL (
    SELECT
      SUM(GREATEST(0, request.requested_quantity - request.received_quantity)) AS open_purchase_quantity,
      (array_agg(request.id ORDER BY request.created_at DESC))[1] AS open_purchase_request_id
    FROM public.purchase_requests request
    WHERE request.material_id = material.id AND request.status::text <> 'cancelled'
  ) purchases ON true
  LEFT JOIN LATERAL (
    SELECT movement.created_at
    FROM public.inventory_movements movement
    WHERE movement.material_id = material.id
    ORDER BY movement.created_at DESC
    LIMIT 1
  ) latest ON true
  WHERE material.is_active = true
  ORDER BY material.name;
$function$;

GRANT EXECUTE ON FUNCTION public.inventory_material_summary() TO authenticated;
