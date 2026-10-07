CREATE OR REPLACE FUNCTION app_private.can_manage_users(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT app_private.is_active_user(_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = _user_id
        AND role::text = 'owner'
    );
$$;

CREATE OR REPLACE FUNCTION app_private.can_control_jobs(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT app_private.can_manage_users(_user_id);
$$;

CREATE OR REPLACE FUNCTION app_private.can_create_job_orders(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT app_private.is_active_user(_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = _user_id
        AND role::text IN ('owner', 'admin', 'staff')
    );
$$;

REVOKE ALL ON FUNCTION app_private.can_manage_users(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.can_control_jobs(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.can_create_job_orders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.can_manage_users(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_control_jobs(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_create_job_orders(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "jo admin insert from approved quote" ON public.job_orders;
DROP POLICY IF EXISTS "jo operations insert from approved quote" ON public.job_orders;
CREATE POLICY "jo admin staff insert from approved quote"
ON public.job_orders FOR INSERT TO authenticated
WITH CHECK (
  app_private.can_create_job_orders(auth.uid())
  AND status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.quotations q
    WHERE q.id = job_orders.quotation_id
      AND q.status = 'approved'
      AND q.customer_id = job_orders.customer_id
      AND q.project_name = job_orders.project_name
      AND q.total_amount = job_orders.quoted_amount
  )
);

DROP POLICY IF EXISTS "joli admin insert" ON public.job_order_line_items;
DROP POLICY IF EXISTS "joli operations insert" ON public.job_order_line_items;
CREATE POLICY "joli admin staff insert" ON public.job_order_line_items
  FOR INSERT TO authenticated WITH CHECK (app_private.can_create_job_orders(auth.uid()));
