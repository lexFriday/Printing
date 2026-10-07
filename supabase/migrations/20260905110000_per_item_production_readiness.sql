BEGIN;

ALTER TABLE public.job_bom_items
  ADD COLUMN IF NOT EXISTS job_order_line_item_id UUID REFERENCES public.job_order_line_items(id) ON DELETE RESTRICT;
ALTER TABLE public.job_bom_items DROP CONSTRAINT IF EXISTS job_bom_items_job_bom_id_material_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS job_bom_items_line_material_key
  ON public.job_bom_items(job_bom_id, job_order_line_item_id, material_id);
CREATE INDEX IF NOT EXISTS job_bom_items_line_idx ON public.job_bom_items(job_order_line_item_id);

-- Link existing frozen BOM rows to their originating JO line where possible.
UPDATE public.job_bom_items item
SET job_order_line_item_id = line.id
FROM public.job_boms bom
JOIN public.job_orders job ON job.id = bom.job_order_id
JOIN public.job_order_line_items line ON line.job_order_id = job.id
 JOIN public.quote_material_estimates estimate
  ON estimate.quotation_id = job.quotation_id
 AND estimate.quote_line_item_id = line.quote_line_item_id
WHERE item.job_bom_id = bom.id
  AND estimate.material_id = item.material_id
  AND item.job_order_line_item_id IS NULL;

CREATE OR REPLACE FUNCTION public.production_item_readiness(p_job_order_id UUID)
RETURNS TABLE(
  job_order_line_item_id UUID,
  description TEXT,
  quantity NUMERIC,
  status TEXT,
  required_materials JSONB,
  shortage_materials JSONB,
  next_action TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH lines AS (
    SELECT id, description, quantity, sort_order
    FROM public.job_order_line_items
    WHERE job_order_id = p_job_order_id
  ),
  req AS (
    SELECT l.id AS line_id, l.description, l.quantity, l.sort_order, i.material_id,
           SUM(i.planned_quantity)::numeric AS planned,
           COALESCE(SUM(CASE WHEN m.movement_type = 'reservation' THEN m.quantity WHEN m.movement_type = 'reservation_release' THEN -m.quantity ELSE 0 END), 0)::numeric AS reserved
    FROM lines l
    JOIN public.job_boms b ON b.job_order_id = p_job_order_id
    JOIN public.job_bom_items i ON i.job_bom_id = b.id AND (i.job_order_line_item_id = l.id OR i.job_order_line_item_id IS NULL)
    LEFT JOIN public.inventory_movements m ON m.job_order_id = p_job_order_id AND m.material_id = i.material_id
    GROUP BY l.id, l.description, l.quantity, l.sort_order, i.material_id
  ),
  grouped AS (
    SELECT line_id, description, quantity, sort_order,
      jsonb_agg(jsonb_build_object('material_id', material_id, 'planned', planned, 'reserved', GREATEST(reserved,0), 'shortage', GREATEST(planned-GREATEST(reserved,0),0))) AS materials,
      jsonb_agg(jsonb_build_object('material_id', material_id, 'shortage', GREATEST(planned-GREATEST(reserved,0),0))) FILTER (WHERE planned > GREATEST(reserved,0)) AS shortages,
      bool_and(planned <= GREATEST(reserved,0)) AS ready
    FROM req GROUP BY line_id, description, quantity, sort_order
  )
  SELECT line_id, description, quantity,
    CASE WHEN EXISTS (SELECT 1 FROM public.production_tasks t WHERE t.job_order_line_item_id = line_id AND t.status = 'in_progress') THEN 'in_progress' WHEN ready THEN 'ready' ELSE 'blocked' END,
    materials, COALESCE(shortages, '[]'::jsonb),
    CASE WHEN ready THEN 'Start this item' ELSE 'Reserve stock or create a purchasing request' END
  FROM grouped ORDER BY CASE WHEN ready THEN 0 ELSE 1 END, sort_order, line_id;
$$;
GRANT EXECUTE ON FUNCTION public.production_item_readiness(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_production_task(p_task_id UUID,p_status TEXT,p_hold_reason TEXT DEFAULT NULL)
RETURNS public.production_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.production_tasks%ROWTYPE; item_status TEXT;
BEGIN
  IF p_status NOT IN ('not_started','in_progress','done','on_hold') THEN RAISE EXCEPTION 'invalid task status'; END IF;
  IF p_status='on_hold' AND COALESCE(trim(p_hold_reason),'')='' THEN RAISE EXCEPTION 'hold reason is required'; END IF;
  IF p_status = 'in_progress' THEN
    SELECT status INTO item_status FROM public.production_item_readiness((SELECT job_order_id FROM public.production_tasks WHERE id=p_task_id)) WHERE job_order_line_item_id = (SELECT job_order_line_item_id FROM public.production_tasks WHERE id=p_task_id);
    IF item_status = 'blocked' THEN RAISE EXCEPTION 'item materials are not ready'; END IF;
  END IF;
  UPDATE public.production_tasks SET status=p_status, hold_reason=CASE WHEN p_status='on_hold' THEN trim(p_hold_reason) ELSE NULL END, started_at=CASE WHEN p_status='in_progress' THEN COALESCE(started_at,now()) ELSE started_at END, completed_at=CASE WHEN p_status='done' THEN COALESCE(completed_at,now()) ELSE NULL END, updated_at=now() WHERE id=p_task_id RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  UPDATE public.production_jobs pj
  SET status = CASE
    WHEN EXISTS (SELECT 1 FROM public.production_tasks t WHERE t.job_order_id = r.job_order_id AND t.status IN ('in_progress','on_hold')) THEN 'in_progress'::production_status
    WHEN EXISTS (SELECT 1 FROM public.production_tasks t WHERE t.job_order_id = r.job_order_id AND t.status = 'done')
      AND NOT EXISTS (SELECT 1 FROM public.production_tasks t WHERE t.job_order_id = r.job_order_id AND t.status <> 'done') THEN 'for_reconciliation'::production_status
    ELSE 'preparing'::production_status
  END, updated_at = now()
  WHERE pj.job_order_id = r.job_order_id AND pj.status NOT IN ('completed','cancelled');
  RETURN r;
END; $$;

COMMIT;
