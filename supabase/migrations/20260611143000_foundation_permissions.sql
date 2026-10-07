-- Foundation permissions and workflow guards.

CREATE TYPE public.user_status AS ENUM ('active','inactive');

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status public.user_status NOT NULL DEFAULT 'active';

DELETE FROM public.user_roles a
USING public.user_roles b
WHERE a.user_id = b.user_id
  AND a.created_at > b.created_at;

ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);

CREATE OR REPLACE FUNCTION public.is_active_user(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = _user_id
      AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION public.can_write_operations(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public AS $$
  SELECT public.is_active_user(_user_id)
    AND (
      public.has_role(_user_id, 'admin')
      OR public.has_role(_user_id, 'staff')
    )
$$;

-- PROFILES
DROP POLICY IF EXISTS "profiles read all authed" ON public.profiles;
DROP POLICY IF EXISTS "profiles update self" ON public.profiles;
CREATE POLICY "profiles active read" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));
CREATE POLICY "profiles admin update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND public.is_active_user(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND public.is_active_user(auth.uid()));

-- USER ROLES
DROP POLICY IF EXISTS "roles self read" ON public.user_roles;
DROP POLICY IF EXISTS "roles admin write" ON public.user_roles;
CREATE POLICY "roles active self or admin read" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  );
CREATE POLICY "roles admin write" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND public.is_active_user(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND public.is_active_user(auth.uid()));

-- CUSTOMERS
DROP POLICY IF EXISTS "customers all authed" ON public.customers;
CREATE POLICY "customers active read" ON public.customers
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "customers operations insert" ON public.customers
  FOR INSERT TO authenticated WITH CHECK (public.can_write_operations(auth.uid()));
CREATE POLICY "customers operations update" ON public.customers
  FOR UPDATE TO authenticated
  USING (public.can_write_operations(auth.uid()))
  WITH CHECK (public.can_write_operations(auth.uid()));
CREATE POLICY "customers admin delete" ON public.customers
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') AND public.is_active_user(auth.uid()));

-- QUOTATIONS
DROP POLICY IF EXISTS "quotations all authed" ON public.quotations;
CREATE POLICY "quotations active read" ON public.quotations
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "quotations operations insert" ON public.quotations
  FOR INSERT TO authenticated WITH CHECK (public.can_write_operations(auth.uid()));
CREATE POLICY "quotations operations update" ON public.quotations
  FOR UPDATE TO authenticated
  USING (public.can_write_operations(auth.uid()))
  WITH CHECK (public.can_write_operations(auth.uid()));
CREATE POLICY "quotations admin delete" ON public.quotations
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') AND public.is_active_user(auth.uid()));

-- QUOTE LINE ITEMS
DROP POLICY IF EXISTS "qli all authed" ON public.quote_line_items;
CREATE POLICY "qli active read" ON public.quote_line_items
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "qli draft operations insert" ON public.quote_line_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_write_operations(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quotation_id
        AND q.status = 'draft'
    )
  );
CREATE POLICY "qli draft operations update" ON public.quote_line_items
  FOR UPDATE TO authenticated
  USING (
    public.can_write_operations(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quotation_id
        AND q.status = 'draft'
    )
  )
  WITH CHECK (
    public.can_write_operations(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quotation_id
        AND q.status = 'draft'
    )
  );
CREATE POLICY "qli draft operations delete" ON public.quote_line_items
  FOR DELETE TO authenticated
  USING (
    public.can_write_operations(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quotation_id
        AND q.status = 'draft'
    )
  );

-- JOB ORDERS
DROP POLICY IF EXISTS "jo all authed" ON public.job_orders;
CREATE POLICY "jo active read" ON public.job_orders
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "jo operations insert from approved quote" ON public.job_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_write_operations(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quotation_id
        AND q.status = 'approved'
        AND q.customer_id = customer_id
        AND q.project_name = project_name
        AND q.total_amount = quoted_amount
    )
  );
CREATE POLICY "jo operations update" ON public.job_orders
  FOR UPDATE TO authenticated
  USING (public.can_write_operations(auth.uid()))
  WITH CHECK (public.can_write_operations(auth.uid()));

-- JOB EXPENSES
DROP POLICY IF EXISTS "expenses all authed" ON public.job_expenses;
CREATE POLICY "expenses active read" ON public.job_expenses
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "expenses operations insert" ON public.job_expenses
  FOR INSERT TO authenticated WITH CHECK (public.can_write_operations(auth.uid()) AND amount >= 0);
CREATE POLICY "expenses operations update" ON public.job_expenses
  FOR UPDATE TO authenticated
  USING (public.can_write_operations(auth.uid()))
  WITH CHECK (public.can_write_operations(auth.uid()) AND amount >= 0);
CREATE POLICY "expenses admin delete" ON public.job_expenses
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') AND public.is_active_user(auth.uid()));

-- INVOICES
DROP POLICY IF EXISTS "invoices all authed" ON public.invoices;
CREATE POLICY "invoices active read" ON public.invoices
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "invoices operations insert from job" ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_write_operations(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.job_orders j
      WHERE j.id = job_order_id
        AND j.customer_id = customer_id
        AND j.quoted_amount = invoice_amount
    )
  );
CREATE POLICY "invoices operations update payment only" ON public.invoices
  FOR UPDATE TO authenticated
  USING (public.can_write_operations(auth.uid()))
  WITH CHECK (public.can_write_operations(auth.uid()));

-- AUDIT LOGS
DROP POLICY IF EXISTS "audit insert authed" ON public.audit_logs;
DROP POLICY IF EXISTS "audit read admin" ON public.audit_logs;
CREATE POLICY "audit insert active" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "audit read admin" ON public.audit_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') AND public.is_active_user(auth.uid()));

CREATE OR REPLACE FUNCTION public.validate_job_order_from_quote()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE q public.quotations%ROWTYPE;
BEGIN
  SELECT * INTO q FROM public.quotations WHERE id = NEW.quotation_id;
  IF q.id IS NULL THEN
    RAISE EXCEPTION 'Job order must reference an existing quotation.';
  END IF;
  IF q.status <> 'approved' THEN
    RAISE EXCEPTION 'Job orders may only be created from approved quotations.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_orders WHERE quotation_id = NEW.quotation_id AND id <> COALESCE(NEW.id, gen_random_uuid())) THEN
    RAISE EXCEPTION 'This quotation already has a job order.';
  END IF;
  NEW.customer_id := q.customer_id;
  NEW.project_name := q.project_name;
  NEW.quoted_amount := q.total_amount;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_job_order_from_quote ON public.job_orders;
CREATE TRIGGER trg_validate_job_order_from_quote
  BEFORE INSERT ON public.job_orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_job_order_from_quote();

CREATE OR REPLACE FUNCTION public.validate_invoice_from_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE j public.job_orders%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public.job_orders WHERE id = NEW.job_order_id;
  IF j.id IS NULL THEN
    RAISE EXCEPTION 'Invoices must be generated from job orders.';
  END IF;
  NEW.customer_id := j.customer_id;
  NEW.invoice_amount := j.quoted_amount;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_invoice_from_job ON public.invoices;
CREATE TRIGGER trg_validate_invoice_from_job
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.validate_invoice_from_job();
