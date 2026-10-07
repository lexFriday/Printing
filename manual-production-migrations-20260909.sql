-- Manual production migration bundle
-- Run once in the Supabase/Lovable SQL Editor, in this complete order.
-- Signature migrations are intentionally excluded.

-- ============================================================================
-- SOURCE: supabase/migrations/20260909185000_production_lead_handoff.sql
-- ============================================================================
BEGIN;

-- Return only operational fields to Production. Do not widen the Job Order
-- table policy because that table also contains commercial values.
DROP POLICY IF EXISTS job_orders_production_read ON public.job_orders;
DROP POLICY IF EXISTS job_order_line_items_production_read ON public.job_order_line_items;

CREATE OR REPLACE FUNCTION public.production_job_document(p_job_order_id UUID)
RETURNS TABLE(id UUID, job_number TEXT, project_name TEXT, status TEXT, customer_id UUID, quotation_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
  SELECT job.id, job.job_number, job.project_name, job.status::TEXT, job.customer_id, job.quotation_id
  FROM public.job_orders AS job
  WHERE job.id = p_job_order_id
    AND public.is_active_user(auth.uid())
    AND (public.has_role(auth.uid(), 'production') OR app_private.can_view_sensitive_operations(auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.production_job_document(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_job_document(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.production_job_line_items(p_job_order_id UUID)
RETURNS TABLE(id UUID, description TEXT, quantity NUMERIC, sort_order INTEGER, item_template_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
  SELECT line.id, line.description, line.quantity, line.sort_order, quote_line.item_template_id
  FROM public.job_order_line_items AS line
  LEFT JOIN public.quote_line_items AS quote_line ON quote_line.id = line.quote_line_item_id
  WHERE line.job_order_id = p_job_order_id
    AND public.is_active_user(auth.uid())
    AND (public.has_role(auth.uid(), 'production') OR app_private.can_view_sensitive_operations(auth.uid()))
  ORDER BY line.sort_order, line.id;
$$;
REVOKE ALL ON FUNCTION public.production_job_line_items(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_job_line_items(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.production_task_board()
RETURNS TABLE(
  id UUID, job_order_id UUID, job_order_line_item_id UUID, task_type TEXT,
  task_order INTEGER, department TEXT, assignee_id UUID, priority INTEGER,
  due_at TIMESTAMPTZ, status TEXT, hold_reason TEXT,
  job_number TEXT, project_name TEXT, line_item_description TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
  SELECT task.id, task.job_order_id, task.job_order_line_item_id, task.task_type,
    task.task_order, task.department, task.assignee_id, task.priority,
    task.due_at, task.status, task.hold_reason,
    job.job_number, job.project_name, line.description
  FROM public.production_tasks AS task
  JOIN public.job_orders AS job ON job.id = task.job_order_id
  JOIN public.job_order_line_items AS line ON line.id = task.job_order_line_item_id
  WHERE public.is_active_user(auth.uid())
    AND (public.has_role(auth.uid(), 'production') OR app_private.can_view_sensitive_operations(auth.uid()))
  ORDER BY task.priority, task.due_at NULLS LAST, task.task_order, task.id;
$$;
REVOKE ALL ON FUNCTION public.production_task_board() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_task_board() TO authenticated;

DROP FUNCTION IF EXISTS public.create_job_order_from_approved_quote(UUID,DATE,UUID,UUID,TEXT,TEXT,DATE,TEXT);

-- Quote conversion and Production plan creation are one transaction. People
-- are assigned later at task level in the Production workspace.
CREATE OR REPLACE FUNCTION public.create_job_order_from_approved_quote(
  p_quotation_id UUID,
  p_target_completion_date DATE,
  p_approved_by_user_id UUID,
  p_client_po_number TEXT DEFAULT NULL,
  p_dr_number TEXT DEFAULT NULL,
  p_installation_date DATE DEFAULT NULL,
  p_internal_notes TEXT DEFAULT NULL
)
RETURNS TABLE(id UUID, job_number TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, pg_temp
AS $$
DECLARE
  v_quote public.quotations%ROWTYPE;
  v_job public.job_orders%ROWTYPE;
  v_approver_name TEXT;
BEGIN
  IF NOT app_private.can_create_job_orders(auth.uid()) THEN
    RAISE EXCEPTION 'Only owner or admin staff can create Job Orders.';
  END IF;
  IF p_target_completion_date IS NULL THEN RAISE EXCEPTION 'Date Requested is required.'; END IF;

  SELECT * INTO v_quote FROM public.quotations
  WHERE quotations.id = p_quotation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quotation not found.'; END IF;
  IF v_quote.status::TEXT <> 'approved' THEN
    RAISE EXCEPTION 'Only approved quotations can create a Job Order.';
  END IF;

  SELECT COALESCE(NULLIF(trim(display_name), ''), email)
  INTO v_approver_name FROM public.profiles
  WHERE profiles.id = p_approved_by_user_id AND profiles.status = 'active';
  IF v_approver_name IS NULL THEN RAISE EXCEPTION 'Approver must be an active user.'; END IF;

  SELECT job.* INTO v_job FROM public.job_orders AS job
  WHERE job.quotation_id = p_quotation_id;
  IF FOUND THEN RETURN QUERY SELECT v_job.id, v_job.job_number; RETURN; END IF;

  INSERT INTO public.job_orders (
    quotation_id, customer_id, customer_contact_id,
    contact_name_snapshot, contact_department_snapshot, contact_phone_snapshot,
    contact_email_snapshot, project_name, quoted_amount, tax_type, status,
    target_completion_date, client_po_number, project_manager,
    approved_by_name, approved_by_user_id, prepared_by_user_id,
    dr_number, installation_date, internal_notes
  ) VALUES (
    v_quote.id, v_quote.customer_id, v_quote.customer_contact_id,
    v_quote.contact_name_snapshot, v_quote.contact_department_snapshot,
    v_quote.contact_phone_snapshot, v_quote.contact_email_snapshot,
    v_quote.project_name, v_quote.total_amount, v_quote.tax_type, 'pending',
    p_target_completion_date, NULLIF(trim(p_client_po_number), ''), NULL,
    v_approver_name, p_approved_by_user_id, v_quote.sales_agent_user_id,
    NULLIF(trim(p_dr_number), ''), p_installation_date,
    NULLIF(trim(p_internal_notes), '')
  ) RETURNING * INTO v_job;

  INSERT INTO public.production_jobs (job_order_id, job_type, responsible_user_id, status)
  VALUES (v_job.id, 'general', NULL, 'preparing');

  RETURN QUERY SELECT v_job.id, v_job.job_number;
END;
$$;

REVOKE ALL ON FUNCTION public.create_job_order_from_approved_quote(UUID,DATE,UUID,TEXT,TEXT,DATE,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_job_order_from_approved_quote(UUID,DATE,UUID,TEXT,TEXT,DATE,TEXT) TO authenticated;

-- Supervisors may only assign steps to eligible Production users. NULL remains
-- valid for deliberately unassigned work.
CREATE OR REPLACE FUNCTION public.assign_production_task(
  p_task_id UUID,
  p_assignee_id UUID,
  p_department TEXT DEFAULT NULL
)
RETURNS public.production_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r public.production_tasks%ROWTYPE;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Supervisor assignment required.';
  END IF;
  IF p_assignee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    JOIN public.user_roles AS user_role ON user_role.user_id = profile.id
    WHERE profile.id = p_assignee_id
      AND profile.status = 'active'
      AND user_role.role = 'production'
  ) THEN
    RAISE EXCEPTION 'Production assignee must be an active Production user.';
  END IF;
  UPDATE public.production_tasks
  SET assignee_id = p_assignee_id,
      department = NULLIF(trim(p_department), ''),
      updated_at = now()
  WHERE production_tasks.id = p_task_id
  RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production task not found.'; END IF;
  RETURN r;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;


-- ============================================================================
-- SOURCE: supabase/migrations/20260909192000_production_project_assignments.sql
-- ============================================================================
BEGIN;

CREATE TABLE public.production_job_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id UUID NOT NULL REFERENCES public.job_orders(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  removed_at TIMESTAMPTZ,
  CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);

CREATE UNIQUE INDEX production_job_assignments_active_unique
ON public.production_job_assignments(job_order_id, user_id)
WHERE removed_at IS NULL;
CREATE INDEX production_job_assignments_user_active_idx
ON public.production_job_assignments(user_id, job_order_id)
WHERE removed_at IS NULL;

ALTER TABLE public.production_job_assignments ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.production_job_assignments TO authenticated;
CREATE POLICY production_job_assignments_read ON public.production_job_assignments
FOR SELECT TO authenticated USING (
  public.is_active_user(auth.uid())
  AND (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
  )
);

CREATE TRIGGER capture_audit_log
AFTER INSERT OR UPDATE OR DELETE ON public.production_job_assignments
FOR EACH ROW EXECUTE FUNCTION app_private.capture_audit_log();

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
        SELECT 1 FROM public.production_job_assignments AS assignment
        WHERE assignment.job_order_id = p_job_order_id
          AND assignment.user_id = p_user_id
          AND assignment.removed_at IS NULL
      )
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_production_job(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_production_job(UUID,UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.production_assignment_options()
RETURNS TABLE(user_id UUID, display_name TEXT, email TEXT, active_job_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT profile.id, profile.display_name, profile.email,
    COUNT(assignment.id) FILTER (
      WHERE assignment.removed_at IS NULL
        AND COALESCE(production.status::TEXT, '') <> 'completed'
        AND job.status::TEXT NOT IN ('completed', 'cancelled')
    ) AS active_job_count
  FROM public.profiles AS profile
  JOIN public.user_roles AS user_role ON user_role.user_id = profile.id
  LEFT JOIN public.production_job_assignments AS assignment ON assignment.user_id = profile.id
  LEFT JOIN public.job_orders AS job ON job.id = assignment.job_order_id
  LEFT JOIN public.production_jobs AS production ON production.job_order_id = job.id
  WHERE profile.status = 'active'
    AND user_role.role = 'production'
    AND public.is_active_user(auth.uid())
    AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin'))
  GROUP BY profile.id, profile.display_name, profile.email
  ORDER BY profile.display_name NULLS LAST, profile.email;
$$;
REVOKE ALL ON FUNCTION public.production_assignment_options() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_assignment_options() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_production_job_assignments(
  p_job_order_id UUID,
  p_user_ids UUID[]
)
RETURNS SETOF public.production_job_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_ids UUID[] := COALESCE(p_user_ids, ARRAY[]::UUID[]);
  v_distinct_count INTEGER;
  v_valid_count INTEGER;
BEGIN
  IF NOT public.is_active_user(auth.uid())
    OR NOT (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Only Owner or Admin can assign production work.';
  END IF;
  IF array_position(v_user_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Production assignment contains an invalid user.';
  END IF;

  PERFORM 1 FROM public.job_orders WHERE id = p_job_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job Order not found.'; END IF;

  SELECT COUNT(DISTINCT value) INTO v_distinct_count FROM unnest(v_user_ids) AS value;
  SELECT COUNT(*) INTO v_valid_count
  FROM public.profiles AS profile
  JOIN public.user_roles AS user_role ON user_role.user_id = profile.id
  WHERE profile.id = ANY(v_user_ids)
    AND profile.status = 'active'
    AND user_role.role = 'production';
  IF v_valid_count <> v_distinct_count THEN
    RAISE EXCEPTION 'Assign only active Production users.';
  END IF;

  UPDATE public.production_job_assignments
  SET removed_at = now(), removed_by = auth.uid()
  WHERE job_order_id = p_job_order_id
    AND removed_at IS NULL
    AND NOT (user_id = ANY(v_user_ids));

  INSERT INTO public.production_job_assignments(job_order_id, user_id, assigned_by)
  SELECT p_job_order_id, selected_user_id, auth.uid()
  FROM (SELECT DISTINCT unnest(v_user_ids) AS selected_user_id) selected
  WHERE NOT EXISTS (
    SELECT 1 FROM public.production_job_assignments existing
    WHERE existing.job_order_id = p_job_order_id
      AND existing.user_id = selected.selected_user_id
      AND existing.removed_at IS NULL
  );

  RETURN QUERY
  SELECT assignment.* FROM public.production_job_assignments AS assignment
  WHERE assignment.job_order_id = p_job_order_id AND assignment.removed_at IS NULL
  ORDER BY assignment.assigned_at, assignment.id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_production_job_assignments(UUID,UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_production_job_assignments(UUID,UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.production_workspace_queue()
RETURNS TABLE(
  job_order_id UUID,
  job_number TEXT,
  project_name TEXT,
  customer_name TEXT,
  target_completion_date DATE,
  job_status TEXT,
  production_status TEXT,
  shortage_count INTEGER,
  current_step TEXT,
  next_action TEXT,
  assigned_user_ids UUID[],
  assigned_names TEXT[],
  is_unassigned BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app_private, pg_temp
AS $$
  SELECT job.id, job.job_number, job.project_name, customer.customer_name,
    job.target_completion_date, job.status::TEXT, production.status::TEXT,
    COALESCE(readiness.shortage_count, 0), current_task.task_type,
    CASE
      WHEN assignment.assigned_user_ids IS NULL THEN 'Assign production staff'
      WHEN COALESCE(readiness.shortage_count, 0) > 0 THEN 'Resolve material shortage'
      WHEN current_task.status = 'on_hold' THEN 'Review hold'
      WHEN current_task.status = 'in_progress' THEN 'Continue current step'
      WHEN current_task.id IS NOT NULL THEN 'Start next step'
      WHEN production.status = 'completed' OR job.status = 'completed' THEN 'Production complete'
      ELSE 'Open production'
    END,
    COALESCE(assignment.assigned_user_ids, ARRAY[]::UUID[]),
    COALESCE(assignment.assigned_names, ARRAY[]::TEXT[]),
    assignment.assigned_user_ids IS NULL
  FROM public.job_orders AS job
  JOIN public.customers AS customer ON customer.id = job.customer_id
  LEFT JOIN public.production_jobs AS production ON production.job_order_id = job.id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE material.shortage_quantity > 0)::INTEGER AS shortage_count
    FROM public.production_material_readiness(job.id) AS material
  ) readiness ON true
  LEFT JOIN LATERAL (
    SELECT task.id, task.task_type, task.status
    FROM public.production_tasks AS task
    WHERE task.job_order_id = job.id AND task.status <> 'done'
    ORDER BY CASE task.status WHEN 'in_progress' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END,
      task.task_order, task.created_at
    LIMIT 1
  ) current_task ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(active.user_id ORDER BY active.display_name, active.user_id) AS assigned_user_ids,
      array_agg(active.display_name ORDER BY active.display_name, active.user_id) AS assigned_names
    FROM (
      SELECT assignment.user_id,
        COALESCE(NULLIF(trim(profile.display_name), ''), profile.email, 'Unnamed user') AS display_name
      FROM public.production_job_assignments AS assignment
      JOIN public.profiles AS profile ON profile.id = assignment.user_id
      JOIN public.user_roles AS user_role ON user_role.user_id = profile.id AND user_role.role = 'production'
      WHERE assignment.job_order_id = job.id
        AND assignment.removed_at IS NULL
        AND profile.status = 'active'
    ) active
  ) assignment ON true
  WHERE public.is_active_user(auth.uid())
    AND (
      public.has_role(auth.uid(), 'owner')
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'staff')
      OR (
        public.has_role(auth.uid(), 'production')
        AND auth.uid() = ANY(COALESCE(assignment.assigned_user_ids, ARRAY[]::UUID[]))
      )
    )
  ORDER BY
    (assignment.assigned_user_ids IS NULL) DESC,
    (COALESCE(readiness.shortage_count, 0) > 0) DESC,
    (current_task.status IN ('in_progress', 'on_hold')) DESC,
    job.target_completion_date NULLS LAST,
    job.created_at;
$$;
REVOKE ALL ON FUNCTION public.production_workspace_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_workspace_queue() TO authenticated;

CREATE OR REPLACE FUNCTION public.production_job_document(p_job_order_id UUID)
RETURNS TABLE(id UUID, job_number TEXT, project_name TEXT, status TEXT, customer_id UUID, quotation_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
  SELECT job.id, job.job_number, job.project_name, job.status::TEXT, job.customer_id, job.quotation_id
  FROM public.job_orders AS job
  WHERE job.id = p_job_order_id AND public.can_access_production_job(auth.uid(), job.id);
$$;

CREATE OR REPLACE FUNCTION public.production_job_line_items(p_job_order_id UUID)
RETURNS TABLE(id UUID, description TEXT, quantity NUMERIC, sort_order INTEGER, item_template_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
  SELECT line.id, line.description, line.quantity, line.sort_order, quote_line.item_template_id
  FROM public.job_order_line_items AS line
  LEFT JOIN public.quote_line_items AS quote_line ON quote_line.id = line.quote_line_item_id
  WHERE line.job_order_id = p_job_order_id
    AND public.can_access_production_job(auth.uid(), line.job_order_id)
  ORDER BY line.sort_order, line.id;
$$;

CREATE OR REPLACE FUNCTION public.production_task_board()
RETURNS TABLE(
  id UUID, job_order_id UUID, job_order_line_item_id UUID, task_type TEXT,
  task_order INTEGER, department TEXT, assignee_id UUID, priority INTEGER,
  due_at TIMESTAMPTZ, status TEXT, hold_reason TEXT,
  job_number TEXT, project_name TEXT, line_item_description TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
  SELECT task.id, task.job_order_id, task.job_order_line_item_id, task.task_type,
    task.task_order, task.department, task.assignee_id, task.priority,
    task.due_at, task.status, task.hold_reason,
    job.job_number, job.project_name, line.description
  FROM public.production_tasks AS task
  JOIN public.job_orders AS job ON job.id = task.job_order_id
  JOIN public.job_order_line_items AS line ON line.id = task.job_order_line_item_id
  WHERE public.can_access_production_job(auth.uid(), task.job_order_id)
  ORDER BY task.priority, task.due_at NULLS LAST, task.task_order, task.id;
$$;

CREATE OR REPLACE FUNCTION public.ensure_production_tasks(p_job_order_id UUID)
RETURNS SETOF public.production_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l RECORD;
  steps TEXT[] := ARRAY['Artwork / Export','Production / Printing','Cutting / Finishing','Quality Check'];
  i INTEGER;
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  FOR l IN SELECT id FROM public.job_order_line_items
    WHERE job_order_id = p_job_order_id ORDER BY sort_order, id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.production_task_plans plan WHERE plan.job_order_line_item_id = l.id) THEN
      FOR i IN 1..array_length(steps, 1) LOOP
        INSERT INTO public.production_tasks(job_order_id, job_order_line_item_id, task_type, task_order)
        VALUES (p_job_order_id, l.id, steps[i], i)
        ON CONFLICT (job_order_line_item_id, task_type) DO NOTHING;
      END LOOP;
    END IF;
  END LOOP;
  RETURN QUERY SELECT * FROM public.production_tasks
    WHERE job_order_id = p_job_order_id ORDER BY job_order_line_item_id, task_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_production_task(
  p_task_id UUID, p_status TEXT, p_hold_reason TEXT DEFAULT NULL
)
RETURNS public.production_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.production_tasks%ROWTYPE; item_status TEXT;
BEGIN
  SELECT * INTO r FROM public.production_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production task not found.'; END IF;
  IF NOT public.can_access_production_job(auth.uid(), r.job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  IF public.has_role(auth.uid(), 'production')
    AND r.assignee_id IS NOT NULL AND r.assignee_id <> auth.uid() THEN
    RAISE EXCEPTION 'Production workers can only update their own assigned step.';
  END IF;
  IF p_status NOT IN ('not_started','in_progress','done','on_hold') THEN RAISE EXCEPTION 'Invalid task status.'; END IF;
  IF p_status = 'on_hold' AND COALESCE(trim(p_hold_reason), '') = '' THEN RAISE EXCEPTION 'Hold reason is required.'; END IF;
  IF p_status = 'in_progress' THEN
    SELECT status INTO item_status FROM public.production_item_readiness(r.job_order_id)
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

-- Direct table policies mirror the RPC boundary and prevent API bypass.
DROP POLICY IF EXISTS production_tasks_read ON public.production_tasks;
CREATE POLICY production_tasks_read ON public.production_tasks FOR SELECT TO authenticated
USING (public.can_access_production_job(auth.uid(), job_order_id));
DROP POLICY IF EXISTS production_tasks_update ON public.production_tasks;
CREATE POLICY production_tasks_update ON public.production_tasks FOR UPDATE TO authenticated
USING (
  public.can_access_production_job(auth.uid(), job_order_id)
  AND (NOT public.has_role(auth.uid(), 'production') OR assignee_id IS NULL OR assignee_id = auth.uid())
)
WITH CHECK (
  public.can_access_production_job(auth.uid(), job_order_id)
  AND (NOT public.has_role(auth.uid(), 'production') OR assignee_id IS NULL OR assignee_id = auth.uid())
);

NOTIFY pgrst, 'reload schema';
COMMIT;


-- ============================================================================
-- SOURCE: supabase/migrations/20260909193000_enforce_production_assignment_boundary.sql
-- ============================================================================
BEGIN;

-- Keep the mature workflow implementations intact, but put them behind one
-- project-assignment boundary. The implementation functions are private and
-- cannot be called through PostgREST.
ALTER FUNCTION public.get_production_job(UUID) SET SCHEMA app_private;
ALTER FUNCTION public.production_material_readiness(UUID) SET SCHEMA app_private;
ALTER FUNCTION public.production_item_readiness(UUID) SET SCHEMA app_private;
ALTER FUNCTION public.reserve_inventory(UUID, UUID, NUMERIC, TEXT) SET SCHEMA app_private;
ALTER FUNCTION public.record_inventory_movement(UUID, UUID, public.inventory_movement_type, NUMERIC, TEXT) SET SCHEMA app_private;
ALTER FUNCTION public.record_production_material_activity(UUID, UUID, public.inventory_movement_type, NUMERIC, TEXT) SET SCHEMA app_private;
ALTER FUNCTION public.start_production(UUID, TEXT) SET SCHEMA app_private;
ALTER FUNCTION public.create_shortage_request(UUID, UUID, TEXT) SET SCHEMA app_private;
ALTER FUNCTION public.reconcile_production(UUID, TEXT, TEXT) SET SCHEMA app_private;
ALTER FUNCTION public.complete_production(UUID, TEXT) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.get_production_job(UUID) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.production_material_readiness(UUID) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.production_item_readiness(UUID) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.reserve_inventory(UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.record_inventory_movement(UUID, UUID, public.inventory_movement_type, NUMERIC, TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.record_production_material_activity(UUID, UUID, public.inventory_movement_type, NUMERIC, TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.start_production(UUID, TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.create_shortage_request(UUID, UUID, TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.reconcile_production(UUID, TEXT, TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.complete_production(UUID, TEXT) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.get_production_job(p_job_order_id UUID)
RETURNS public.production_jobs
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN RETURN NULL; END IF;
  RETURN app_private.get_production_job(p_job_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.production_material_readiness(p_job_order_id UUID)
RETURNS TABLE(material_id UUID, planned_quantity NUMERIC, reserved_quantity NUMERIC, shortage_quantity NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM app_private.production_material_readiness(p_job_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.production_item_readiness(p_job_order_id UUID)
RETURNS TABLE(
  job_order_line_item_id UUID, description TEXT, quantity NUMERIC, status TEXT,
  required_materials JSONB, shortage_materials JSONB, next_action TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM app_private.production_item_readiness(p_job_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_inventory(
  p_material_id UUID, p_job_order_id UUID, p_quantity NUMERIC, p_idempotency_key TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  RETURN app_private.reserve_inventory(p_material_id, p_job_order_id, p_quantity, p_idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_inventory_movement(
  p_material_id UUID, p_job_order_id UUID, p_movement_type public.inventory_movement_type,
  p_quantity NUMERIC, p_idempotency_key TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF p_job_order_id IS NOT NULL AND NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  RETURN app_private.record_inventory_movement(p_material_id, p_job_order_id, p_movement_type, p_quantity, p_idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_production_material_activity(
  p_material_id UUID, p_job_order_id UUID, p_movement_type public.inventory_movement_type,
  p_quantity NUMERIC, p_idempotency_key TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  RETURN app_private.record_production_material_activity(p_material_id, p_job_order_id, p_movement_type, p_quantity, p_idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_production(p_job_order_id UUID, p_idempotency_key TEXT)
RETURNS public.production_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  RETURN app_private.start_production(p_job_order_id, p_idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_shortage_request(
  p_job_order_id UUID, p_material_id UUID, p_idempotency_key TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  RETURN app_private.create_shortage_request(p_job_order_id, p_material_id, p_idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_production(
  p_job_order_id UUID, p_decision TEXT, p_reason TEXT DEFAULT NULL
)
RETURNS public.production_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  IF public.has_role(auth.uid(), 'production') AND p_decision = 'accept'
    AND EXISTS (
      SELECT 1 FROM public.production_material_exceptions
      WHERE job_order_id = p_job_order_id AND status = 'pending'
    ) THEN
    RAISE EXCEPTION 'Production workers cannot approve protected exceptions.';
  END IF;
  RETURN app_private.reconcile_production(p_job_order_id, p_decision, p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_production(p_job_order_id UUID, p_idempotency_key TEXT)
RETURNS public.production_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  RETURN app_private.complete_production(p_job_order_id, p_idempotency_key);
END;
$$;

-- Workers may execute a normal close-out, but an exception still requires an
-- Owner/Admin decision. These private implementations preserve existing status
-- transitions while aligning ordinary execution with assigned worker access.
CREATE OR REPLACE FUNCTION app_private.reconcile_production(
  p_job_order_id UUID, p_decision TEXT, p_reason TEXT DEFAULT NULL
)
RETURNS public.production_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
DECLARE v_result public.production_jobs%ROWTYPE; v_planned NUMERIC; v_consumed NUMERIC;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff') OR public.has_role(auth.uid(),'production')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_decision NOT IN ('accept','request_approval') THEN RAISE EXCEPTION 'invalid reconciliation decision'; END IF;
  SELECT COALESCE(SUM(i.planned_quantity),0) INTO v_planned FROM public.job_bom_items i JOIN public.job_boms b ON b.id=i.job_bom_id WHERE b.job_order_id=p_job_order_id;
  SELECT COALESCE(SUM(CASE WHEN movement_type IN ('consumption','waste') THEN quantity WHEN movement_type='return' THEN -quantity ELSE 0 END),0) INTO v_consumed FROM public.inventory_movements WHERE job_order_id=p_job_order_id;
  IF v_consumed > v_planned AND p_decision <> 'request_approval' AND NOT public.has_role(auth.uid(),'admin') AND NOT public.has_role(auth.uid(),'owner') THEN
    RAISE EXCEPTION 'over-consumption requires Owner or Admin approval';
  END IF;
  UPDATE public.production_jobs SET status=(CASE WHEN p_decision='request_approval' OR v_consumed>v_planned THEN 'awaiting_approval' ELSE 'for_reconciliation' END)::public.production_status, notes=COALESCE(NULLIF(trim(p_reason),''),notes), updated_at=now() WHERE job_order_id=p_job_order_id RETURNING * INTO v_result;
  IF NOT FOUND THEN RAISE EXCEPTION 'production plan not found'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.complete_production(p_job_order_id UUID, p_idempotency_key TEXT)
RETURNS public.production_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
DECLARE v_result public.production_jobs%ROWTYPE;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff') OR public.has_role(auth.uid(),'production')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key='' THEN RAISE EXCEPTION 'idempotency key required'; END IF;
  UPDATE public.production_jobs SET status='completed',completed_at=COALESCE(completed_at,now()),updated_at=now()
    WHERE job_order_id=p_job_order_id AND status='for_reconciliation' RETURNING * INTO v_result;
  IF NOT FOUND THEN RAISE EXCEPTION 'production must be reconciled before completion'; END IF;
  UPDATE public.job_orders SET status='in_production', updated_at=now() WHERE id=p_job_order_id AND status='pending';
  UPDATE public.job_orders SET status='ready', ready_at=COALESCE(ready_at,now()), updated_at=now() WHERE id=p_job_order_id AND status='in_production';
  IF NOT FOUND THEN RAISE EXCEPTION 'job order is not ready for completion'; END IF;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_production_job(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.production_material_readiness(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.production_item_readiness(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_inventory(UUID, UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_inventory_movement(UUID, UUID, public.inventory_movement_type, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_production_material_activity(UUID, UUID, public.inventory_movement_type, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_production(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_shortage_request(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_production(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_production(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_current_production_user()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.is_active_user(auth.uid()) AND public.has_role(auth.uid(), 'production');
$$;
REVOKE ALL ON FUNCTION public.is_current_production_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_current_production_user() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_assign_production(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.is_active_user(p_user_id)
    AND (public.has_role(p_user_id, 'owner') OR public.has_role(p_user_id, 'admin'));
$$;
REVOKE ALL ON FUNCTION public.can_assign_production(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_assign_production(UUID) TO authenticated;

-- Direct table policies keep non-Production operational roles unchanged while
-- restricting Production accounts to project assignments.
DROP POLICY IF EXISTS production_jobs_read ON public.production_jobs;
CREATE POLICY production_jobs_read ON public.production_jobs FOR SELECT TO authenticated USING (
  (public.is_current_production_user() AND public.can_access_production_job(auth.uid(), job_order_id))
  OR (NOT public.is_current_production_user() AND app_private.can_read_operations(auth.uid()))
);
DROP POLICY IF EXISTS job_boms_read ON public.job_boms;
CREATE POLICY job_boms_read ON public.job_boms FOR SELECT TO authenticated USING (
  (public.is_current_production_user() AND public.can_access_production_job(auth.uid(), job_order_id))
  OR (NOT public.is_current_production_user() AND app_private.can_read_operations(auth.uid()))
);
DROP POLICY IF EXISTS job_bom_items_read ON public.job_bom_items;
CREATE POLICY job_bom_items_read ON public.job_bom_items FOR SELECT TO authenticated USING (
  (public.is_current_production_user() AND EXISTS (
      SELECT 1 FROM public.job_boms bom
      WHERE bom.id = job_bom_id AND public.can_access_production_job(auth.uid(), bom.job_order_id)
  )) OR (NOT public.is_current_production_user() AND app_private.can_read_operations(auth.uid()))
);
DROP POLICY IF EXISTS production_exception_read ON public.production_material_exceptions;
CREATE POLICY production_exception_read ON public.production_material_exceptions FOR SELECT TO authenticated USING (
  (public.is_current_production_user() AND public.can_access_production_job(auth.uid(), job_order_id))
  OR (NOT public.is_current_production_user() AND app_private.can_read_operations(auth.uid()))
);
DROP POLICY IF EXISTS purchase_ops_read ON public.purchase_requests;
CREATE POLICY purchase_ops_read ON public.purchase_requests FOR SELECT TO authenticated USING (
  (public.is_current_production_user() AND job_order_id IS NOT NULL AND public.can_access_production_job(auth.uid(), job_order_id))
  OR (NOT public.is_current_production_user() AND app_private.can_read_operations(auth.uid()))
);

DROP POLICY IF EXISTS production_job_assignments_read ON public.production_job_assignments;
CREATE POLICY production_job_assignments_read ON public.production_job_assignments FOR SELECT TO authenticated USING (
  public.is_active_user(auth.uid()) AND (
    user_id = auth.uid()
    OR public.can_assign_production(auth.uid())
  )
);

DROP POLICY IF EXISTS production_tasks_read ON public.production_tasks;
CREATE POLICY production_tasks_read ON public.production_tasks FOR SELECT TO authenticated
USING (public.can_access_production_job(auth.uid(), job_order_id));
DROP POLICY IF EXISTS production_tasks_update ON public.production_tasks;
CREATE POLICY production_tasks_update ON public.production_tasks FOR UPDATE TO authenticated
USING (
  public.can_access_production_job(auth.uid(), job_order_id)
  AND (NOT public.is_current_production_user() OR assignee_id IS NULL OR assignee_id = auth.uid())
)
WITH CHECK (
  public.can_access_production_job(auth.uid(), job_order_id)
  AND (NOT public.is_current_production_user() OR assignee_id IS NULL OR assignee_id = auth.uid())
);

NOTIFY pgrst, 'reload schema';
COMMIT;


-- ============================================================================
-- SOURCE: supabase/migrations/20260909195000_production_item_assignments.sql
-- ============================================================================
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


-- ============================================================================
-- SOURCE: supabase/migrations/20260909196000_production_item_queue_completion.sql
-- ============================================================================
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


-- ============================================================================
-- SOURCE: supabase/migrations/20260909197000_production_material_activity_boundary.sql
-- ============================================================================
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


-- ============================================================================
-- SOURCE: supabase/migrations/20260909198000_scope_production_document_to_assignments.sql
-- ============================================================================
BEGIN;

-- The document shell is operational context, but Production users must still
-- have at least one currently assigned item in the Job Order. Owner, Admin,
-- and Staff access continues through can_access_production_job.
CREATE OR REPLACE FUNCTION public.production_job_document(p_job_order_id UUID)
RETURNS TABLE(id UUID, job_number TEXT, project_name TEXT, status TEXT, customer_id UUID, quotation_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
  SELECT job.id, job.job_number, job.project_name, job.status::TEXT, job.customer_id, job.quotation_id
  FROM public.job_orders AS job
  WHERE job.id = p_job_order_id
    AND public.can_access_production_job(auth.uid(), job.id);
$$;
REVOKE ALL ON FUNCTION public.production_job_document(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_job_document(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;


-- ============================================================================
-- SOURCE: supabase/migrations/20260909199000_lock_production_task_writes_to_rpcs.sql
-- ============================================================================
BEGIN;

-- Task transitions and assignment must pass through the validated SECURITY
-- DEFINER RPCs. Row-level UPDATE alone cannot protect individual columns or
-- enforce step ordering, readiness, and hold-reason rules.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.production_tasks FROM anon, authenticated;

DROP POLICY IF EXISTS production_tasks_update ON public.production_tasks;

GRANT SELECT ON public.production_tasks TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;


-- ============================================================================
-- SOURCE: supabase/migrations/20260909200000_enforce_item_owned_job_bom_materials.sql
-- ============================================================================
BEGIN;

-- Job Order lines are created after the Job Order itself, so the legacy insert
-- trigger cannot know which item owns a material. Production now performs the
-- quote-to-BOM handoff explicitly after the line items exist.
DROP TRIGGER IF EXISTS trg_snapshot_job_order_materials ON public.job_orders;

-- Historical rows are safe to repair when the Job Order has exactly one item.
-- Multi-item rows remain unchanged because assigning them automatically would
-- invent ownership and could affect readiness or purchasing for the wrong item.
WITH single_item_boms AS (
  SELECT bom.id AS job_bom_id, (ARRAY_AGG(line.id))[1] AS line_id
  FROM public.job_boms AS bom
  JOIN public.job_order_line_items AS line ON line.job_order_id = bom.job_order_id
  GROUP BY bom.id
  HAVING COUNT(line.id) = 1
)
DELETE FROM public.job_bom_items AS legacy
USING single_item_boms AS owner
WHERE legacy.job_bom_id = owner.job_bom_id
  AND legacy.job_order_line_item_id IS NULL
  AND legacy.is_supplemental = FALSE
  AND EXISTS (
    SELECT 1
    FROM public.job_bom_items AS existing
    WHERE existing.job_bom_id = legacy.job_bom_id
      AND existing.job_order_line_item_id = owner.line_id
      AND existing.material_id = legacy.material_id
      AND existing.is_supplemental = FALSE
  );

WITH single_item_boms AS (
  SELECT bom.id AS job_bom_id
  FROM public.job_boms AS bom
  JOIN public.job_order_line_items AS line ON line.job_order_id = bom.job_order_id
  GROUP BY bom.id
  HAVING COUNT(line.id) = 1
), ranked_legacy AS (
  SELECT material.id,
    ROW_NUMBER() OVER (
      PARTITION BY material.job_bom_id, material.material_id
      ORDER BY material.created_at, material.id
    ) AS occurrence,
    SUM(material.planned_quantity) OVER (
      PARTITION BY material.job_bom_id, material.material_id
    ) AS combined_quantity
  FROM public.job_bom_items AS material
  JOIN single_item_boms AS bom ON bom.job_bom_id = material.job_bom_id
  WHERE material.job_order_line_item_id IS NULL
    AND material.is_supplemental = FALSE
)
UPDATE public.job_bom_items AS material
SET planned_quantity = ranked.combined_quantity
FROM ranked_legacy AS ranked
WHERE material.id = ranked.id
  AND ranked.occurrence = 1;

WITH single_item_boms AS (
  SELECT bom.id AS job_bom_id
  FROM public.job_boms AS bom
  JOIN public.job_order_line_items AS line ON line.job_order_id = bom.job_order_id
  GROUP BY bom.id
  HAVING COUNT(line.id) = 1
), ranked_legacy AS (
  SELECT material.id,
    ROW_NUMBER() OVER (
      PARTITION BY material.job_bom_id, material.material_id
      ORDER BY material.created_at, material.id
    ) AS occurrence
  FROM public.job_bom_items AS material
  JOIN single_item_boms AS bom ON bom.job_bom_id = material.job_bom_id
  WHERE material.job_order_line_item_id IS NULL
    AND material.is_supplemental = FALSE
)
DELETE FROM public.job_bom_items AS legacy
USING ranked_legacy AS ranked
WHERE legacy.id = ranked.id
  AND ranked.occurrence > 1;

WITH single_item_boms AS (
  SELECT bom.id AS job_bom_id, (ARRAY_AGG(line.id))[1] AS line_id
  FROM public.job_boms AS bom
  JOIN public.job_order_line_items AS line ON line.job_order_id = bom.job_order_id
  GROUP BY bom.id
  HAVING COUNT(line.id) = 1
)
UPDATE public.job_bom_items AS material
SET job_order_line_item_id = owner.line_id
FROM single_item_boms AS owner
WHERE material.job_bom_id = owner.job_bom_id
  AND material.job_order_line_item_id IS NULL;

-- NOT VALID preserves ambiguous historical rows while enforcing item ownership
-- for every new or subsequently updated BOM material row.
ALTER TABLE public.job_bom_items
  DROP CONSTRAINT IF EXISTS job_bom_items_require_line_owner;
ALTER TABLE public.job_bom_items
  ADD CONSTRAINT job_bom_items_require_line_owner
  CHECK (job_order_line_item_id IS NOT NULL) NOT VALID;

NOTIFY pgrst, 'reload schema';
COMMIT;


