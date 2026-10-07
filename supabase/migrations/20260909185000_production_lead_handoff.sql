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
