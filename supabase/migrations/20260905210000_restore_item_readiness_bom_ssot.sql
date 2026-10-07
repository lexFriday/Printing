BEGIN;

-- Item readiness must use the released Job Order BOM, the same source used by
-- aggregate production readiness and purchasing. Quote estimates may change
-- after handoff and must not create phantom production requirements.
CREATE OR REPLACE FUNCTION public.production_item_readiness(p_job_order_id UUID)
RETURNS TABLE(job_order_line_item_id UUID, description TEXT, quantity NUMERIC, status TEXT, required_materials JSONB, shortage_materials JSONB, next_action TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH lines AS (
    SELECT line.id, line.description, line.quantity, line.sort_order
    FROM public.job_order_line_items AS line
    WHERE line.job_order_id = p_job_order_id
  ), requirements AS (
    SELECT line.id AS line_id, line.description, line.quantity, line.sort_order,
      item.material_id, SUM(item.planned_quantity)::numeric AS planned
    FROM lines AS line
    JOIN public.job_boms AS bom ON bom.job_order_id = p_job_order_id
    JOIN public.job_bom_items AS item ON item.job_bom_id = bom.id
      AND (item.job_order_line_item_id = line.id OR (
        item.job_order_line_item_id IS NULL AND (SELECT COUNT(*) FROM lines) = 1
      ))
    GROUP BY line.id, line.description, line.quantity, line.sort_order, item.material_id
  ), material_totals AS (
    SELECT requirement.material_id,
      COALESCE((
        SELECT SUM(CASE
          WHEN movement.movement_type = 'reservation' THEN movement.quantity
          WHEN movement.movement_type = 'reservation_release' THEN -movement.quantity
          ELSE 0
        END)
        FROM public.inventory_movements AS movement
        WHERE movement.job_order_id = p_job_order_id
          AND movement.material_id = requirement.material_id
      ), 0)::numeric AS reserved_total
    FROM requirements AS requirement
    GROUP BY requirement.material_id
  ), allocated AS (
    SELECT requirement.*,
      GREATEST(0, LEAST(
        requirement.planned,
        material_totals.reserved_total - COALESCE(SUM(requirement.planned) OVER (
          PARTITION BY requirement.material_id
          ORDER BY requirement.sort_order, requirement.line_id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)
      ))::numeric AS allocated_reserved
    FROM requirements AS requirement
    JOIN material_totals USING (material_id)
  ), grouped AS (
    SELECT allocated.line_id, allocated.description, allocated.quantity, allocated.sort_order,
      jsonb_agg(jsonb_build_object(
        'material_id', allocated.material_id,
        'material_name', COALESCE(material.name, 'Material'),
        'planned', allocated.planned,
        'reserved', allocated.allocated_reserved,
        'shortage', GREATEST(allocated.planned - allocated.allocated_reserved, 0)
      )) AS materials,
      jsonb_agg(jsonb_build_object(
        'material_id', allocated.material_id,
        'material_name', COALESCE(material.name, 'Material'),
        'shortage', GREATEST(allocated.planned - allocated.allocated_reserved, 0)
      )) FILTER (WHERE allocated.planned > allocated.allocated_reserved) AS shortages,
      bool_and(allocated.planned <= allocated.allocated_reserved) AS ready
    FROM allocated
    LEFT JOIN public.materials AS material ON material.id = allocated.material_id
    GROUP BY allocated.line_id, allocated.description, allocated.quantity, allocated.sort_order
  )
  SELECT grouped.line_id, grouped.description, grouped.quantity,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.production_tasks AS task
        WHERE task.job_order_line_item_id = grouped.line_id AND task.status = 'in_progress'
      ) THEN 'in_progress'
      WHEN grouped.ready THEN 'ready'
      ELSE 'blocked'
    END,
    grouped.materials,
    COALESCE(grouped.shortages, '[]'::jsonb),
    CASE WHEN grouped.ready THEN 'Start this item' ELSE 'Reserve stock or create a purchasing request' END
  FROM grouped
  ORDER BY CASE WHEN grouped.ready THEN 0 ELSE 1 END, grouped.sort_order, grouped.line_id;
$$;

GRANT EXECUTE ON FUNCTION public.production_item_readiness(UUID) TO authenticated;

COMMIT;
