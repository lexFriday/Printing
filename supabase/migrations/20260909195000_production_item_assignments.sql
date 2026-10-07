BEGIN;

CREATE TABLE public.production_item_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_line_item_id UUID NOT NULL REFERENCES public.job_order_line_items(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  removed_at TIMESTAMPTZ,
  CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);

CREATE UNIQUE INDEX production_item_assignments_active_unique
ON public.production_item_assignments(job_order_line_item_id, user_id)
WHERE removed_at IS NULL;
CREATE INDEX production_item_assignments_user_active_idx
ON public.production_item_assignments(user_id, job_order_line_item_id)
WHERE removed_at IS NULL;

ALTER TABLE public.production_item_assignments ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.production_item_assignments TO authenticated;
CREATE POLICY production_item_assignments_read ON public.production_item_assignments
FOR SELECT TO authenticated USING (
  public.is_active_user(auth.uid()) AND (
    user_id = auth.uid() OR public.can_assign_production(auth.uid())
  )
);

CREATE TRIGGER capture_audit_log
AFTER INSERT OR UPDATE OR DELETE ON public.production_item_assignments
FOR EACH ROW EXECUTE FUNCTION app_private.capture_audit_log();

-- Preserve the intent of any pending project assignment by applying it to
-- every immutable Job Order item once. The project table remains audit history.
INSERT INTO public.production_item_assignments(
  job_order_line_item_id, user_id, assigned_by, assigned_at
)
SELECT line.id, assignment.user_id, assignment.assigned_by, assignment.assigned_at
FROM public.production_job_assignments assignment
JOIN public.job_order_line_items line ON line.job_order_id = assignment.job_order_id
WHERE assignment.removed_at IS NULL
ON CONFLICT (job_order_line_item_id, user_id) WHERE removed_at IS NULL DO NOTHING;

UPDATE public.production_job_assignments
SET removed_at = now(), removed_by = assigned_by
WHERE removed_at IS NULL;

DROP FUNCTION IF EXISTS public.set_production_job_assignments(UUID, UUID[]);

CREATE OR REPLACE FUNCTION public.can_access_production_item(
  p_user_id UUID,
  p_job_order_line_item_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_active_user(p_user_id) AND (
    public.has_role(p_user_id, 'owner')
    OR public.has_role(p_user_id, 'admin')
    OR public.has_role(p_user_id, 'staff')
    OR (
      public.has_role(p_user_id, 'production')
      AND EXISTS (
        SELECT 1
        FROM public.production_item_assignments assignment
        JOIN public.profiles profile ON profile.id = assignment.user_id
        JOIN public.user_roles role ON role.user_id = profile.id AND role.role = 'production'
        WHERE assignment.job_order_line_item_id = p_job_order_line_item_id
          AND assignment.user_id = p_user_id
          AND assignment.removed_at IS NULL
          AND profile.status = 'active'
      )
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_production_item(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_production_item(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_production_job(
  p_user_id UUID,
  p_job_order_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_active_user(p_user_id) AND (
    public.has_role(p_user_id, 'owner')
    OR public.has_role(p_user_id, 'admin')
    OR public.has_role(p_user_id, 'staff')
    OR (
      public.has_role(p_user_id, 'production')
      AND EXISTS (
        SELECT 1 FROM public.job_order_line_items line
        WHERE line.job_order_id = p_job_order_id
          AND public.can_access_production_item(p_user_id, line.id)
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.set_production_item_assignments(
  p_job_order_line_item_id UUID,
  p_user_ids UUID[],
  p_expected_user_ids UUID[]
)
RETURNS SETOF public.production_item_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_ids UUID[];
  v_expected_user_ids UUID[];
  v_current_user_ids UUID[];
  v_valid_count INTEGER;
BEGIN
  IF NOT public.can_assign_production(auth.uid()) THEN
    RAISE EXCEPTION 'Only Owner or Admin can assign production work.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT value ORDER BY value), ARRAY[]::UUID[])
  INTO v_user_ids FROM unnest(COALESCE(p_user_ids, ARRAY[]::UUID[])) value;
  SELECT COALESCE(array_agg(DISTINCT value ORDER BY value), ARRAY[]::UUID[])
  INTO v_expected_user_ids FROM unnest(COALESCE(p_expected_user_ids, ARRAY[]::UUID[])) value;
  IF array_position(v_user_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Production assignment contains an invalid user.';
  END IF;

  PERFORM 1 FROM public.job_order_line_items
  WHERE id = p_job_order_line_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production item not found.'; END IF;

  SELECT COALESCE(array_agg(user_id ORDER BY user_id), ARRAY[]::UUID[])
  INTO v_current_user_ids
  FROM public.production_item_assignments
  WHERE job_order_line_item_id = p_job_order_line_item_id AND removed_at IS NULL;

  IF v_current_user_ids IS DISTINCT FROM v_expected_user_ids THEN
    RAISE EXCEPTION 'Assignments changed since you opened this item. Refresh and try again.';
  END IF;

  SELECT COUNT(*) INTO v_valid_count
  FROM public.profiles profile
  JOIN public.user_roles role ON role.user_id = profile.id AND role.role = 'production'
  WHERE profile.id = ANY(v_user_ids) AND profile.status = 'active';
  IF v_valid_count <> cardinality(v_user_ids) THEN
    RAISE EXCEPTION 'Assign only active Production users.';
  END IF;

  UPDATE public.production_item_assignments
  SET removed_at = now(), removed_by = auth.uid()
  WHERE job_order_line_item_id = p_job_order_line_item_id
    AND removed_at IS NULL
    AND NOT (user_id = ANY(v_user_ids));

  INSERT INTO public.production_item_assignments(job_order_line_item_id, user_id, assigned_by)
  SELECT p_job_order_line_item_id, selected_user_id, auth.uid()
  FROM unnest(v_user_ids) selected_user_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.production_item_assignments existing
    WHERE existing.job_order_line_item_id = p_job_order_line_item_id
      AND existing.user_id = selected_user_id
      AND existing.removed_at IS NULL
  );

  RETURN QUERY SELECT assignment.*
  FROM public.production_item_assignments assignment
  WHERE assignment.job_order_line_item_id = p_job_order_line_item_id
    AND assignment.removed_at IS NULL
  ORDER BY assignment.assigned_at, assignment.id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_production_item_assignments(UUID, UUID[], UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_production_item_assignments(UUID, UUID[], UUID[]) TO authenticated;

DROP FUNCTION IF EXISTS public.production_assignment_options();
CREATE FUNCTION public.production_assignment_options()
RETURNS TABLE(user_id UUID, display_name TEXT, email TEXT, active_item_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT profile.id, profile.display_name, profile.email,
    COUNT(assignment.id) FILTER (
      WHERE assignment.removed_at IS NULL
        AND job.status::TEXT NOT IN ('completed', 'cancelled')
    ) AS active_item_count
  FROM public.profiles profile
  JOIN public.user_roles role ON role.user_id = profile.id AND role.role = 'production'
  LEFT JOIN public.production_item_assignments assignment ON assignment.user_id = profile.id
  LEFT JOIN public.job_order_line_items line ON line.id = assignment.job_order_line_item_id
  LEFT JOIN public.job_orders job ON job.id = line.job_order_id
  WHERE profile.status = 'active' AND public.can_assign_production(auth.uid())
  GROUP BY profile.id, profile.display_name, profile.email
  ORDER BY profile.display_name NULLS LAST, profile.email;
$$;

DROP FUNCTION IF EXISTS public.production_workspace_queue();
CREATE FUNCTION public.production_workspace_queue()
RETURNS TABLE(
  job_order_line_item_id UUID, job_order_id UUID, job_number TEXT, project_name TEXT,
  item_description TEXT, quantity NUMERIC, item_order INTEGER, customer_name TEXT,
  target_completion_date DATE, job_status TEXT, production_status TEXT, item_status TEXT,
  shortage_count INTEGER, current_task TEXT, next_action TEXT,
  assigned_user_ids UUID[], assigned_names TEXT[], is_unassigned BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
  SELECT line.id, job.id, job.job_number, job.project_name, line.description, line.quantity,
    line.sort_order, customer.customer_name, job.target_completion_date, job.status::TEXT,
    production.status::TEXT, COALESCE(readiness.status, 'blocked'),
    COALESCE(jsonb_array_length(readiness.shortage_materials), 0), current_task.task_type,
    CASE
      WHEN assignment.assigned_user_ids IS NULL THEN 'Assign a production team'
      WHEN readiness.status = 'blocked' THEN COALESCE(readiness.next_action, 'Resolve the item blocker')
      WHEN current_task.status = 'on_hold' THEN 'Review the hold reason'
      WHEN current_task.status = 'in_progress' THEN 'Continue the current step'
      WHEN current_task.id IS NOT NULL THEN 'Start the next step'
      WHEN production.status = 'completed' OR job.status = 'completed' THEN 'Production complete'
      ELSE 'Prepare production'
    END,
    COALESCE(assignment.assigned_user_ids, ARRAY[]::UUID[]),
    COALESCE(assignment.assigned_names, ARRAY[]::TEXT[]),
    assignment.assigned_user_ids IS NULL
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
    (assignment.assigned_user_ids IS NULL) DESC,
    (COALESCE(jsonb_array_length(readiness.shortage_materials), 0) > 0) DESC,
    job.target_completion_date NULLS LAST, job.created_at, line.sort_order, line.id;
$$;
REVOKE ALL ON FUNCTION public.production_workspace_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_workspace_queue() TO authenticated;

CREATE OR REPLACE FUNCTION public.production_item_assignment_details(p_job_order_id UUID)
RETURNS TABLE(job_order_line_item_id UUID, assigned_user_ids UUID[], assigned_names TEXT[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT line.id,
    COALESCE(array_agg(assignment.user_id ORDER BY profile.display_name, assignment.user_id)
      FILTER (WHERE assignment.id IS NOT NULL), ARRAY[]::UUID[]),
    COALESCE(array_agg(COALESCE(NULLIF(trim(profile.display_name), ''), profile.email, 'Unnamed user')
      ORDER BY profile.display_name, assignment.user_id)
      FILTER (WHERE assignment.id IS NOT NULL), ARRAY[]::TEXT[])
  FROM public.job_order_line_items line
  LEFT JOIN public.production_item_assignments assignment
    ON assignment.job_order_line_item_id = line.id AND assignment.removed_at IS NULL
  LEFT JOIN public.profiles profile ON profile.id = assignment.user_id AND profile.status = 'active'
  WHERE line.job_order_id = p_job_order_id
    AND (public.can_assign_production(auth.uid()) OR public.can_access_production_item(auth.uid(), line.id))
  GROUP BY line.id, line.sort_order
  ORDER BY line.sort_order, line.id;
$$;
REVOKE ALL ON FUNCTION public.production_item_assignment_details(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_item_assignment_details(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.production_item_readiness(p_job_order_id UUID)
RETURNS TABLE(
  job_order_line_item_id UUID, description TEXT, quantity NUMERIC, status TEXT,
  required_materials JSONB, shortage_materials JSONB, next_action TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
  SELECT readiness.*
  FROM app_private.production_item_readiness(p_job_order_id) readiness
  WHERE public.can_access_production_item(auth.uid(), readiness.job_order_line_item_id);
$$;

CREATE OR REPLACE FUNCTION public.ensure_production_tasks(p_job_order_id UUID)
RETURNS SETOF public.production_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  line RECORD;
  steps TEXT[] := ARRAY['Artwork / Export','Production / Printing','Cutting / Finishing','Quality Check'];
  step_index INTEGER;
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned items.';
  END IF;

  FOR line IN
    SELECT item.id
    FROM public.job_order_line_items item
    WHERE item.job_order_id = p_job_order_id
      AND public.can_access_production_item(auth.uid(), item.id)
    ORDER BY item.sort_order, item.id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.production_task_plans plan
      WHERE plan.job_order_line_item_id = line.id
    ) THEN
      FOR step_index IN 1..array_length(steps, 1) LOOP
        INSERT INTO public.production_tasks(job_order_id, job_order_line_item_id, task_type, task_order)
        VALUES (p_job_order_id, line.id, steps[step_index], step_index)
        ON CONFLICT (job_order_line_item_id, task_type) DO NOTHING;
      END LOOP;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT task.*
  FROM public.production_tasks task
  WHERE task.job_order_id = p_job_order_id
    AND public.can_access_production_item(auth.uid(), task.job_order_line_item_id)
  ORDER BY task.job_order_line_item_id, task.task_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.production_job_line_items(p_job_order_id UUID)
RETURNS TABLE(id UUID, description TEXT, quantity NUMERIC, sort_order INTEGER, item_template_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT line.id, line.description, line.quantity, line.sort_order, quote_line.item_template_id
  FROM public.job_order_line_items line
  LEFT JOIN public.quote_line_items quote_line ON quote_line.id = line.quote_line_item_id
  WHERE line.job_order_id = p_job_order_id
    AND public.can_access_production_item(auth.uid(), line.id)
  ORDER BY line.sort_order, line.id;
$$;

CREATE OR REPLACE FUNCTION public.production_task_board()
RETURNS TABLE(
  id UUID, job_order_id UUID, job_order_line_item_id UUID, task_type TEXT,
  task_order INTEGER, department TEXT, assignee_id UUID, priority INTEGER,
  due_at TIMESTAMPTZ, status TEXT, hold_reason TEXT,
  job_number TEXT, project_name TEXT, line_item_description TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT task.id, task.job_order_id, task.job_order_line_item_id, task.task_type,
    task.task_order, task.department, task.assignee_id, task.priority,
    task.due_at, task.status, task.hold_reason,
    job.job_number, job.project_name, line.description
  FROM public.production_tasks task
  JOIN public.job_orders job ON job.id = task.job_order_id
  JOIN public.job_order_line_items line ON line.id = task.job_order_line_item_id
  WHERE public.can_access_production_item(auth.uid(), task.job_order_line_item_id)
  ORDER BY task.priority, task.due_at NULLS LAST, task.task_order, task.id;
$$;

CREATE OR REPLACE FUNCTION public.update_production_task(
  p_task_id UUID, p_status TEXT, p_hold_reason TEXT DEFAULT NULL
)
RETURNS public.production_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
DECLARE r public.production_tasks%ROWTYPE; item_status TEXT;
BEGIN
  SELECT * INTO r FROM public.production_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production task not found.'; END IF;
  IF NOT public.can_access_production_item(auth.uid(), r.job_order_line_item_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned items.';
  END IF;
  IF p_status NOT IN ('not_started','in_progress','done','on_hold') THEN RAISE EXCEPTION 'Invalid task status.'; END IF;
  IF p_status = 'on_hold' AND COALESCE(trim(p_hold_reason), '') = '' THEN RAISE EXCEPTION 'Hold reason is required.'; END IF;
  IF p_status = 'in_progress' THEN
    SELECT status INTO item_status FROM app_private.production_item_readiness(r.job_order_id)
      WHERE job_order_line_item_id = r.job_order_line_item_id;
    IF item_status = 'blocked' THEN RAISE EXCEPTION 'Item materials are not ready.'; END IF;
    IF EXISTS (SELECT 1 FROM public.production_tasks task
      WHERE task.job_order_line_item_id = r.job_order_line_item_id
        AND task.task_order < r.task_order AND task.status <> 'done') THEN
      RAISE EXCEPTION 'Complete the previous production step first.';
    END IF;
  END IF;
  UPDATE public.production_tasks SET status = p_status,
    hold_reason = CASE WHEN p_status = 'on_hold' THEN trim(p_hold_reason) ELSE NULL END,
    started_at = CASE WHEN p_status = 'in_progress' THEN COALESCE(started_at, now()) ELSE started_at END,
    completed_at = CASE WHEN p_status = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END,
    updated_at = now()
  WHERE id = p_task_id RETURNING * INTO r;
  UPDATE public.production_jobs SET status = CASE
      WHEN EXISTS (SELECT 1 FROM public.production_tasks task WHERE task.job_order_id = r.job_order_id AND task.status IN ('in_progress','on_hold')) THEN 'in_progress'::production_status
      WHEN EXISTS (SELECT 1 FROM public.production_tasks task WHERE task.job_order_id = r.job_order_id AND task.status = 'done')
        AND NOT EXISTS (SELECT 1 FROM public.production_tasks task WHERE task.job_order_id = r.job_order_id AND task.status <> 'done') THEN 'for_reconciliation'::production_status
      ELSE 'preparing'::production_status END,
    updated_at = now()
  WHERE job_order_id = r.job_order_id AND status NOT IN ('completed','cancelled');
  RETURN r;
END;
$$;

DROP POLICY IF EXISTS production_tasks_read ON public.production_tasks;
CREATE POLICY production_tasks_read ON public.production_tasks FOR SELECT TO authenticated
USING (public.can_access_production_item(auth.uid(), job_order_line_item_id));
DROP POLICY IF EXISTS production_tasks_update ON public.production_tasks;
CREATE POLICY production_tasks_update ON public.production_tasks FOR UPDATE TO authenticated
USING (public.can_access_production_item(auth.uid(), job_order_line_item_id))
WITH CHECK (public.can_access_production_item(auth.uid(), job_order_line_item_id));

NOTIFY pgrst, 'reload schema';
COMMIT;
