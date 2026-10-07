CREATE OR REPLACE FUNCTION app_private.can_sales_work(_user_id uuid)
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
        AND role::text IN ('owner', 'admin', 'sales', 'staff')
    );
$$;

CREATE OR REPLACE FUNCTION app_private.can_accounting_work(_user_id uuid)
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
        AND role::text IN ('owner', 'admin', 'accounting', 'staff')
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

CREATE OR REPLACE FUNCTION app_private.can_view_sensitive_operations(_user_id uuid)
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
        AND role::text IN ('owner', 'admin', 'sales', 'accounting', 'staff')
    );
$$;

REVOKE ALL ON FUNCTION app_private.can_sales_work(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.can_accounting_work(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.can_control_jobs(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.can_view_sensitive_operations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.can_sales_work(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_accounting_work(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_control_jobs(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_view_sensitive_operations(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "customers active read" ON public.customers;
DROP POLICY IF EXISTS "customers operations insert" ON public.customers;
DROP POLICY IF EXISTS "customers operations update" ON public.customers;
DROP POLICY IF EXISTS "customers admin delete" ON public.customers;
CREATE POLICY "customers sensitive read" ON public.customers
  FOR SELECT TO authenticated USING (app_private.can_view_sensitive_operations(auth.uid()));
CREATE POLICY "customers sales insert" ON public.customers
  FOR INSERT TO authenticated WITH CHECK (app_private.can_sales_work(auth.uid()));
CREATE POLICY "customers sales update" ON public.customers
  FOR UPDATE TO authenticated
  USING (app_private.can_sales_work(auth.uid()))
  WITH CHECK (app_private.can_sales_work(auth.uid()));
CREATE POLICY "customers admin delete" ON public.customers
  FOR DELETE TO authenticated USING (app_private.can_manage_users(auth.uid()));

DROP POLICY IF EXISTS "quotations active read" ON public.quotations;
DROP POLICY IF EXISTS "quotations operations insert" ON public.quotations;
DROP POLICY IF EXISTS "quotations operations update" ON public.quotations;
DROP POLICY IF EXISTS "quotations admin delete" ON public.quotations;
CREATE POLICY "quotations sensitive read" ON public.quotations
  FOR SELECT TO authenticated USING (app_private.can_view_sensitive_operations(auth.uid()));
CREATE POLICY "quotations sales insert" ON public.quotations
  FOR INSERT TO authenticated WITH CHECK (app_private.can_sales_work(auth.uid()));
CREATE POLICY "quotations sales update" ON public.quotations
  FOR UPDATE TO authenticated
  USING (app_private.can_sales_work(auth.uid()))
  WITH CHECK (app_private.can_sales_work(auth.uid()));
CREATE POLICY "quotations admin delete" ON public.quotations
  FOR DELETE TO authenticated USING (app_private.can_manage_users(auth.uid()));

DROP POLICY IF EXISTS "qli active read" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli draft operations insert" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli draft operations update" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli draft operations delete" ON public.quote_line_items;
CREATE POLICY "qli sensitive read" ON public.quote_line_items
  FOR SELECT TO authenticated USING (app_private.can_view_sensitive_operations(auth.uid()));
CREATE POLICY "qli draft sales insert" ON public.quote_line_items
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.can_sales_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quote_line_items.quotation_id
        AND q.status = 'draft'
    )
  );
CREATE POLICY "qli draft sales update" ON public.quote_line_items
  FOR UPDATE TO authenticated
  USING (
    app_private.can_sales_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quote_line_items.quotation_id
        AND q.status = 'draft'
    )
  )
  WITH CHECK (
    app_private.can_sales_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quote_line_items.quotation_id
        AND q.status = 'draft'
    )
  );
CREATE POLICY "qli draft sales delete" ON public.quote_line_items
  FOR DELETE TO authenticated
  USING (
    app_private.can_sales_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quote_line_items.quotation_id
        AND q.status = 'draft'
    )
  );

DROP POLICY IF EXISTS "jo active read" ON public.job_orders;
DROP POLICY IF EXISTS "jo operations insert from approved quote" ON public.job_orders;
DROP POLICY IF EXISTS "jo operations update" ON public.job_orders;
CREATE POLICY "jo sensitive read" ON public.job_orders
  FOR SELECT TO authenticated USING (app_private.can_view_sensitive_operations(auth.uid()));
CREATE POLICY "jo admin insert from approved quote"
ON public.job_orders FOR INSERT TO authenticated
WITH CHECK (
  app_private.can_control_jobs(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.quotations q
    WHERE q.id = job_orders.quotation_id
      AND q.status = 'approved'
      AND q.customer_id = job_orders.customer_id
      AND q.project_name = job_orders.project_name
      AND q.total_amount = job_orders.quoted_amount
  )
);
CREATE POLICY "jo admin update"
ON public.job_orders FOR UPDATE TO authenticated
USING (app_private.can_control_jobs(auth.uid()))
WITH CHECK (app_private.can_control_jobs(auth.uid()));

DROP POLICY IF EXISTS "joli active read" ON public.job_order_line_items;
DROP POLICY IF EXISTS "joli operations insert" ON public.job_order_line_items;
CREATE POLICY "joli sensitive read" ON public.job_order_line_items
  FOR SELECT TO authenticated USING (app_private.can_view_sensitive_operations(auth.uid()));
CREATE POLICY "joli admin insert" ON public.job_order_line_items
  FOR INSERT TO authenticated WITH CHECK (app_private.can_control_jobs(auth.uid()));

DROP POLICY IF EXISTS "expenses active read" ON public.job_expenses;
DROP POLICY IF EXISTS "expenses operations insert" ON public.job_expenses;
DROP POLICY IF EXISTS "expenses operations update" ON public.job_expenses;
DROP POLICY IF EXISTS "expenses admin delete" ON public.job_expenses;
CREATE POLICY "expenses sensitive read" ON public.job_expenses
  FOR SELECT TO authenticated USING (app_private.can_view_sensitive_operations(auth.uid()));
CREATE POLICY "expenses accounting insert" ON public.job_expenses
  FOR INSERT TO authenticated
  WITH CHECK (app_private.can_accounting_work(auth.uid()) AND amount >= 0);
CREATE POLICY "expenses accounting update" ON public.job_expenses
  FOR UPDATE TO authenticated
  USING (app_private.can_accounting_work(auth.uid()))
  WITH CHECK (app_private.can_accounting_work(auth.uid()) AND amount >= 0);
CREATE POLICY "expenses admin delete" ON public.job_expenses
  FOR DELETE TO authenticated USING (app_private.can_manage_users(auth.uid()));

DROP POLICY IF EXISTS "invoices active read" ON public.invoices;
DROP POLICY IF EXISTS "invoices operations insert from job" ON public.invoices;
DROP POLICY IF EXISTS "invoices operations update payment only" ON public.invoices;
CREATE POLICY "invoices sensitive read" ON public.invoices
  FOR SELECT TO authenticated USING (app_private.can_view_sensitive_operations(auth.uid()));
CREATE POLICY "invoices accounting insert from job"
ON public.invoices FOR INSERT TO authenticated
WITH CHECK (
  app_private.can_accounting_work(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.job_orders j
    WHERE j.id = invoices.job_order_id
      AND j.status = 'completed'
      AND j.customer_id = invoices.customer_id
      AND j.quoted_amount = invoices.invoice_amount
  )
);
CREATE POLICY "invoices accounting update payment only" ON public.invoices
  FOR UPDATE TO authenticated
  USING (app_private.can_accounting_work(auth.uid()))
  WITH CHECK (app_private.can_accounting_work(auth.uid()));

DROP POLICY IF EXISTS "invoice line active read" ON public.invoice_line_items;
DROP POLICY IF EXISTS "invoice line insert from invoice" ON public.invoice_line_items;
CREATE POLICY "invoice line sensitive read" ON public.invoice_line_items
  FOR SELECT TO authenticated USING (app_private.can_view_sensitive_operations(auth.uid()));
CREATE POLICY "invoice line accounting insert" ON public.invoice_line_items
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.can_accounting_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
    )
  );

DROP POLICY IF EXISTS "invoice payments active read" ON public.invoice_payments;
DROP POLICY IF EXISTS "invoice payments operations insert" ON public.invoice_payments;
CREATE POLICY "invoice payments sensitive read" ON public.invoice_payments
  FOR SELECT TO authenticated USING (app_private.can_view_sensitive_operations(auth.uid()));
CREATE POLICY "invoice payments accounting insert" ON public.invoice_payments
  FOR INSERT TO authenticated
  WITH CHECK (app_private.can_accounting_work(auth.uid()));
