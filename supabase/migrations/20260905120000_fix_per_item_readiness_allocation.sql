BEGIN;

CREATE OR REPLACE FUNCTION public.production_item_readiness(p_job_order_id UUID)
RETURNS TABLE(job_order_line_item_id UUID, description TEXT, quantity NUMERIC, status TEXT, required_materials JSONB, shortage_materials JSONB, next_action TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH req AS (
    SELECT l.id AS line_id, l.description, l.quantity, l.sort_order, e.material_id,
      SUM(e.estimated_quantity)::numeric AS planned
    FROM public.job_order_line_items l
    JOIN public.job_orders j ON j.id = l.job_order_id
    JOIN public.quote_material_estimates e ON e.quotation_id = j.quotation_id AND e.quote_line_item_id = l.quote_line_item_id
    WHERE l.job_order_id = p_job_order_id
    GROUP BY l.id, l.description, l.quantity, l.sort_order, e.material_id
  ), totals AS (
    SELECT material_id, SUM(planned)::numeric AS planned_total,
      COALESCE((SELECT SUM(CASE WHEN m.movement_type='reservation' THEN m.quantity WHEN m.movement_type='reservation_release' THEN -m.quantity ELSE 0 END) FROM public.inventory_movements m WHERE m.job_order_id=p_job_order_id AND m.material_id=req.material_id),0)::numeric AS reserved_total
    FROM req GROUP BY material_id
  ), allocated AS (
    SELECT req.*, totals.reserved_total,
      GREATEST(0, LEAST(req.planned, totals.reserved_total - COALESCE(SUM(req.planned) OVER (PARTITION BY req.material_id ORDER BY req.sort_order, req.line_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)))::numeric AS allocated_reserved
    FROM req JOIN totals USING (material_id)
  ), grouped AS (
    SELECT line_id, description, quantity, sort_order,
      jsonb_agg(jsonb_build_object('material_id',material_id,'material_name',COALESCE((SELECT name FROM public.materials m WHERE m.id=allocated.material_id),'Material'),'planned',planned,'reserved',allocated_reserved,'shortage',GREATEST(planned-allocated_reserved,0))) AS materials,
      jsonb_agg(jsonb_build_object('material_id',material_id,'material_name',COALESCE((SELECT name FROM public.materials m WHERE m.id=allocated.material_id),'Material'),'shortage',GREATEST(planned-allocated_reserved,0))) FILTER (WHERE planned > allocated_reserved) AS shortages,
      bool_and(planned <= allocated_reserved) AS ready
    FROM allocated GROUP BY line_id, description, quantity, sort_order
  )
  SELECT line_id, description, quantity,
    CASE WHEN EXISTS (SELECT 1 FROM public.production_tasks t WHERE t.job_order_line_item_id=line_id AND t.status='in_progress') THEN 'in_progress' WHEN ready THEN 'ready' ELSE 'blocked' END,
    materials, COALESCE(shortages,'[]'::jsonb), CASE WHEN ready THEN 'Start this item' ELSE 'Reserve stock or create a purchasing request' END
  FROM grouped ORDER BY CASE WHEN ready THEN 0 ELSE 1 END, sort_order, line_id;
$$;

COMMIT;
