-- Read models only: queues derive their state from Job Orders, BOM snapshots,
-- and the inventory ledger.  They do not create another workflow truth.
CREATE OR REPLACE FUNCTION public.inventory_material_summary()
RETURNS TABLE(
  material_id UUID,
  material_name TEXT,
  unit TEXT,
  category TEXT,
  pack_size NUMERIC,
  reorder_threshold NUMERIC,
  on_hand NUMERIC,
  reserved NUMERIC,
  available NUMERIC,
  open_purchase_quantity NUMERIC,
  latest_movement_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    material.id,
    material.name,
    material.unit,
    material.category::TEXT,
    material.pack_size,
    material.reorder_threshold,
    COALESCE(balance.on_hand, 0),
    COALESCE(balance.reserved, 0),
    COALESCE(balance.available, 0),
    COALESCE(purchases.open_purchase_quantity, 0),
    latest.created_at
  FROM public.materials material
  LEFT JOIN LATERAL public.inventory_balance(material.id) balance ON true
  LEFT JOIN LATERAL (
    SELECT SUM(GREATEST(0, request.requested_quantity - request.received_quantity)) AS open_purchase_quantity
    FROM public.purchase_requests request
    WHERE request.material_id = material.id AND request.status::TEXT <> 'cancelled'
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
$$;

CREATE OR REPLACE FUNCTION public.production_queue()
RETURNS TABLE(
  job_order_id UUID,
  job_number TEXT,
  project_name TEXT,
  job_status TEXT,
  production_status TEXT,
  bom_status TEXT,
  shortage_count INTEGER,
  next_action TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH requirements AS (
    SELECT bom.job_order_id,
           COUNT(*) FILTER (WHERE GREATEST(0, item.planned_quantity - COALESCE(reserved.quantity, 0)) > 0)::INTEGER AS shortage_count
    FROM public.job_boms bom
    JOIN public.job_bom_items item ON item.job_bom_id = bom.id
    LEFT JOIN LATERAL (
      SELECT SUM(CASE WHEN movement_type = 'reservation' THEN quantity
                      WHEN movement_type = 'reservation_release' THEN -quantity ELSE 0 END) AS quantity
      FROM public.inventory_movements
      WHERE job_order_id = bom.job_order_id AND material_id = item.material_id
    ) reserved ON true
    GROUP BY bom.job_order_id
  )
  SELECT
    job.id,
    job.job_number,
    job.project_name,
    job.status::TEXT,
    production.status::TEXT,
    CASE
      WHEN bom.id IS NULL THEN 'Not prepared'
      WHEN bom.released_at IS NULL THEN 'Prepared'
      ELSE 'Released'
    END,
    COALESCE(requirements.shortage_count, 0),
    CASE
      WHEN production.job_order_id IS NULL THEN 'Create production plan'
      WHEN bom.released_at IS NULL THEN 'Release production'
      WHEN production.status IN ('preparing', 'partially_reserved', 'ready_to_start')
           AND COALESCE(requirements.shortage_count, 0) > 0 THEN 'Reserve materials'
      WHEN production.status IN ('preparing', 'partially_reserved', 'ready_to_start') THEN 'Start production'
      WHEN production.status = 'in_progress' THEN 'Record material usage'
      WHEN production.status = 'for_reconciliation' THEN 'Complete production'
      WHEN production.status = 'awaiting_approval' THEN 'Awaiting approval'
      ELSE 'Open production'
    END
  FROM public.job_orders job
  LEFT JOIN public.production_jobs production ON production.job_order_id = job.id
  LEFT JOIN public.job_boms bom ON bom.job_order_id = job.id
  LEFT JOIN requirements ON requirements.job_order_id = job.id
  WHERE job.status::TEXT NOT IN ('completed', 'cancelled')
    AND COALESCE(production.status::TEXT, '') <> 'completed'
  ORDER BY job.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.inventory_material_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.production_queue() TO authenticated;
