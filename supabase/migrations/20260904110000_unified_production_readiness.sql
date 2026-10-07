-- Use the existing production_material_readiness RPC as the sole readiness
-- calculation for the production queue. Inventory availability remains owned
-- by inventory_balance and is checked by reserve_inventory.
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
    COALESCE(readiness.shortage_count, 0)::INTEGER,
    CASE
      WHEN production.job_order_id IS NULL THEN 'Create production plan'
      WHEN bom.released_at IS NULL THEN 'Release production'
      WHEN production.status IN ('preparing', 'partially_reserved', 'ready_to_start')
        AND COALESCE(readiness.shortage_count, 0) > 0 THEN 'Reserve materials'
      WHEN production.status IN ('preparing', 'partially_reserved', 'ready_to_start') THEN 'Start production'
      WHEN production.status = 'in_progress' THEN 'Record material usage'
      WHEN production.status = 'for_reconciliation' THEN 'Complete production'
      WHEN production.status = 'awaiting_approval' THEN 'Awaiting approval'
      ELSE 'Open production'
    END
  FROM public.job_orders job
  LEFT JOIN public.production_jobs production ON production.job_order_id = job.id
  LEFT JOIN public.job_boms bom ON bom.job_order_id = job.id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE material.shortage_quantity > 0)::INTEGER AS shortage_count
    FROM public.production_material_readiness(job.id) material
  ) readiness ON true
  WHERE job.status::TEXT NOT IN ('completed', 'cancelled')
    AND COALESCE(production.status::TEXT, '') <> 'completed'
  ORDER BY job.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.production_queue() TO authenticated;
