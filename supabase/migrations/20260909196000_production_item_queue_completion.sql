BEGIN;

-- Item completion is derived from operational task state. It is never stored as
-- a second workflow status, so the queue cannot drift from the production steps.
DROP FUNCTION IF EXISTS public.production_workspace_queue();
CREATE FUNCTION public.production_workspace_queue()
RETURNS TABLE(
  job_order_line_item_id UUID, job_order_id UUID, job_number TEXT, project_name TEXT,
  item_description TEXT, quantity NUMERIC, item_order INTEGER, customer_name TEXT,
  target_completion_date DATE, job_status TEXT, production_status TEXT, item_status TEXT,
  shortage_count INTEGER, current_task TEXT, next_action TEXT,
  assigned_user_ids UUID[], assigned_names TEXT[], is_unassigned BOOLEAN, item_completed BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
  SELECT line.id, job.id, job.job_number, job.project_name, line.description, line.quantity,
    line.sort_order, customer.customer_name, job.target_completion_date, job.status::TEXT,
    production.status::TEXT, COALESCE(readiness.status, 'blocked'),
    COALESCE(jsonb_array_length(readiness.shortage_materials), 0), current_task.task_type,
    CASE
      WHEN completion.item_completed THEN 'Production complete'
      WHEN assignment.assigned_user_ids IS NULL THEN 'Assign a production team'
      WHEN readiness.status = 'blocked' THEN COALESCE(readiness.next_action, 'Resolve the item blocker')
      WHEN current_task.status = 'on_hold' THEN 'Review the hold reason'
      WHEN current_task.status = 'in_progress' THEN 'Continue the current step'
      WHEN current_task.id IS NOT NULL THEN 'Start the next step'
      ELSE 'Prepare production'
    END,
    COALESCE(assignment.assigned_user_ids, ARRAY[]::UUID[]),
    COALESCE(assignment.assigned_names, ARRAY[]::TEXT[]),
    assignment.assigned_user_ids IS NULL,
    completion.item_completed
  FROM public.job_order_line_items line
  JOIN public.job_orders job ON job.id = line.job_order_id
  JOIN public.customers customer ON customer.id = job.customer_id
  LEFT JOIN public.production_jobs production ON production.job_order_id = job.id
  LEFT JOIN LATERAL (
    SELECT value.status, value.shortage_materials, value.next_action
    FROM app_private.production_item_readiness(job.id) value
    WHERE value.job_order_line_item_id = line.id
  ) readiness ON true
  LEFT JOIN LATERAL (
    SELECT task.id, task.task_type, task.status
    FROM public.production_tasks task
    WHERE task.job_order_line_item_id = line.id AND task.status <> 'done'
    ORDER BY CASE task.status WHEN 'in_progress' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END,
      task.task_order, task.created_at LIMIT 1
  ) current_task ON true
  LEFT JOIN LATERAL (
    SELECT (
      job.status::TEXT = 'completed'
      OR production.status::TEXT = 'completed'
      OR (
        EXISTS (SELECT 1 FROM public.production_tasks task WHERE task.job_order_line_item_id = line.id)
        AND NOT EXISTS (
          SELECT 1 FROM public.production_tasks task
          WHERE task.job_order_line_item_id = line.id AND task.status <> 'done'
        )
      )
    ) item_completed
  ) completion ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(active.user_id ORDER BY active.display_name, active.user_id) assigned_user_ids,
      array_agg(active.display_name ORDER BY active.display_name, active.user_id) assigned_names
    FROM (
      SELECT assignment.user_id,
        COALESCE(NULLIF(trim(profile.display_name), ''), profile.email, 'Unnamed user') display_name
      FROM public.production_item_assignments assignment
      JOIN public.profiles profile ON profile.id = assignment.user_id AND profile.status = 'active'
      JOIN public.user_roles role ON role.user_id = profile.id AND role.role = 'production'
      WHERE assignment.job_order_line_item_id = line.id AND assignment.removed_at IS NULL
    ) active
  ) assignment ON true
  WHERE public.is_active_user(auth.uid())
    AND job.status::TEXT <> 'cancelled'
    AND (
      public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'staff')
      OR public.can_access_production_item(auth.uid(), line.id)
    )
  ORDER BY
    (assignment.assigned_user_ids IS NULL AND NOT completion.item_completed) DESC,
    (COALESCE(jsonb_array_length(readiness.shortage_materials), 0) > 0) DESC,
    job.target_completion_date NULLS LAST, job.created_at, line.sort_order, line.id;
$$;
REVOKE ALL ON FUNCTION public.production_workspace_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_workspace_queue() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
