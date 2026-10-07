-- Lovable Cloud one-paste migration preflight.
-- Safe to rerun: clears duplicate RLS policy names on affected tables before migrations recreate them.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname IN ('public', 'storage')
      AND (
        (schemaname = 'public' AND tablename IN (
          'customers',
          'quotations',
          'quote_line_items',
          'job_orders',
          'job_order_line_items',
          'job_expenses',
          'invoices',
          'invoice_line_items',
          'invoice_payments',
          'quote_attachments',
          'audit_logs'
        ))
        OR (schemaname = 'storage' AND tablename = 'objects')
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;


-- ============================================================================
-- supabase\migrations\20260613042301_9ac6043c-c830-4d14-95bf-f6db4646af87.sql
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA app_private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION app_private.is_active_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION app_private.can_write_operations(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_private.is_active_user(_user_id)
    AND (
      app_private.has_role(_user_id, 'admin')
      OR app_private.has_role(_user_id, 'staff')
    )
$$;

REVOKE ALL ON FUNCTION app_private.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.is_active_user(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.can_write_operations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.is_active_user(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_write_operations(uuid) TO authenticated, service_role;

DO $$
DECLARE policy_row record;
DECLARE using_expr text;
DECLARE check_expr text;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (coalesce(qual, '') ~ 'public\.(has_role|is_active_user|can_write_operations)|(?<![a-z_])(has_role|is_active_user|can_write_operations)\('
           OR coalesce(with_check, '') ~ 'public\.(has_role|is_active_user|can_write_operations)|(?<![a-z_])(has_role|is_active_user|can_write_operations)\(')
  LOOP
    using_expr := policy_row.qual;
    check_expr := policy_row.with_check;
    using_expr := replace(using_expr, 'public.has_role(', 'app_private.has_role(');
    using_expr := replace(using_expr, 'public.is_active_user(', 'app_private.is_active_user(');
    using_expr := replace(using_expr, 'public.can_write_operations(', 'app_private.can_write_operations(');
    using_expr := regexp_replace(using_expr, '(^|[^a-z_\.])has_role\(', '\1app_private.has_role(', 'g');
    using_expr := regexp_replace(using_expr, '(^|[^a-z_\.])is_active_user\(', '\1app_private.is_active_user(', 'g');
    using_expr := regexp_replace(using_expr, '(^|[^a-z_\.])can_write_operations\(', '\1app_private.can_write_operations(', 'g');
    check_expr := replace(check_expr, 'public.has_role(', 'app_private.has_role(');
    check_expr := replace(check_expr, 'public.is_active_user(', 'app_private.is_active_user(');
    check_expr := replace(check_expr, 'public.can_write_operations(', 'app_private.can_write_operations(');
    check_expr := regexp_replace(check_expr, '(^|[^a-z_\.])has_role\(', '\1app_private.has_role(', 'g');
    check_expr := regexp_replace(check_expr, '(^|[^a-z_\.])is_active_user\(', '\1app_private.is_active_user(', 'g');
    check_expr := regexp_replace(check_expr, '(^|[^a-z_\.])can_write_operations\(', '\1app_private.can_write_operations(', 'g');
    EXECUTE format('ALTER POLICY %I ON %I.%I%s%s',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename,
      CASE WHEN using_expr IS NOT NULL THEN ' USING (' || using_expr || ')' ELSE '' END,
      CASE WHEN check_expr IS NOT NULL THEN ' WITH CHECK (' || check_expr || ')' ELSE '' END
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS "jo operations insert from approved quote" ON public.job_orders;
CREATE POLICY "jo operations insert from approved quote"
ON public.job_orders FOR INSERT TO authenticated
WITH CHECK (
  app_private.can_write_operations(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.quotations q
    WHERE q.id = job_orders.quotation_id
      AND q.status = 'approved'
      AND q.customer_id = job_orders.customer_id
      AND q.project_name = job_orders.project_name
      AND q.total_amount = job_orders.quoted_amount
  )
);

DROP POLICY IF EXISTS "invoices operations insert from job" ON public.invoices;
CREATE POLICY "invoices operations insert from job"
ON public.invoices FOR INSERT TO authenticated
WITH CHECK (
  app_private.can_write_operations(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.job_orders j
    WHERE j.id = invoices.job_order_id
      AND j.status = 'completed'
      AND j.customer_id = invoices.customer_id
      AND j.quoted_amount = invoices.invoice_amount
  )
);

DROP POLICY IF EXISTS "audit insert active" ON public.audit_logs;
DROP POLICY IF EXISTS "audit insert authed" ON public.audit_logs;
REVOKE INSERT ON public.audit_logs FROM authenticated;

CREATE OR REPLACE FUNCTION app_private.capture_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  record_id uuid;
BEGIN
  old_data := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  new_data := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  record_id := COALESCE((new_data ->> 'id')::uuid, (old_data ->> 'id')::uuid);

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
  VALUES (
    auth.uid(),
    lower(TG_OP),
    TG_TABLE_NAME,
    record_id,
    old_data,
    new_data
  );
  RETURN COALESCE(NEW, OLD);
END
$$;
REVOKE ALL ON FUNCTION app_private.capture_audit_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.capture_audit_log() TO service_role;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profiles', 'user_roles', 'customers', 'quotations', 'quote_line_items',
    'job_orders', 'job_order_line_items', 'job_expenses', 'invoices',
    'invoice_line_items', 'item_templates'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS capture_audit_log ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER capture_audit_log AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app_private.capture_audit_log()',
      table_name
    );
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_active_user(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_write_operations(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

COMMENT ON TABLE public.job_order_line_items IS 'Immutable snapshot copied from an approved quotation; no UPDATE or DELETE policy by design.';
COMMENT ON TABLE public.invoice_line_items IS 'Immutable snapshot copied from a completed job order; no UPDATE or DELETE policy by design.';



-- ============================================================================
-- supabase\migrations\20260624090000_role_boundary_hardening.sql
-- ============================================================================

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




-- ============================================================================
-- supabase\migrations\20260624103000_owner_admin_staff_reframe.sql
-- ============================================================================

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




-- ============================================================================
-- supabase\migrations\20260625090000_quote_core_workflow_fields.sql
-- ============================================================================

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS tin_number TEXT;

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS sales_agent TEXT,
  ADD COLUMN IF NOT EXISTS terms TEXT;

CREATE OR REPLACE FUNCTION public.validate_quote_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, app_private AS $$
DECLARE
  old_status TEXT := OLD.status::text;
  new_status TEXT := NEW.status::text;
BEGIN
  IF old_status NOT IN ('draft', 'pending_manager_approval') THEN
    IF NEW.customer_id <> OLD.customer_id
      OR NEW.project_name <> OLD.project_name
      OR NEW.quote_date <> OLD.quote_date
      OR COALESCE(NEW.remarks, '') <> COALESCE(OLD.remarks, '')
      OR COALESCE(NEW.sales_agent, '') <> COALESCE(OLD.sales_agent, '')
      OR COALESCE(NEW.terms, '') <> COALESCE(OLD.terms, '')
      OR NEW.subtotal <> OLD.subtotal
      OR NEW.total_amount <> OLD.total_amount
      OR NEW.tax_type <> OLD.tax_type THEN
      RAISE EXCEPTION 'Only draft or pending manager approval quotations can be edited.';
    END IF;
  END IF;

  IF new_status <> old_status THEN
    IF old_status = 'draft' AND new_status <> 'pending_manager_approval' THEN
      RAISE EXCEPTION 'Draft quotations must be submitted for manager approval.';
    END IF;

    IF old_status = 'pending_manager_approval' THEN
      IF new_status <> 'pending_customer_approval' THEN
        RAISE EXCEPTION 'Manager-approved quotations must move to customer approval.';
      END IF;
      IF NOT app_private.can_create_job_orders(auth.uid()) THEN
        RAISE EXCEPTION 'Only owner or admin staff can approve quotations for customer approval.';
      END IF;
    END IF;

    IF old_status IN ('pending_customer_approval', 'sent')
      AND new_status NOT IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Customer approval quotations can only be approved or rejected.';
    END IF;

    IF old_status IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Final quotation statuses cannot be changed.';
    END IF;

    IF new_status IN ('pending_manager_approval', 'pending_customer_approval', 'approved')
      AND NEW.total_amount <= 0 THEN
      RAISE EXCEPTION 'Quote total must be greater than zero.';
    END IF;

    IF new_status = 'pending_manager_approval' THEN
      NEW.submitted_for_manager_at := COALESCE(NEW.submitted_for_manager_at, now());
    END IF;
    IF new_status = 'pending_customer_approval' THEN
      NEW.manager_approved_at := COALESCE(NEW.manager_approved_at, now());
    END IF;
    IF new_status IN ('approved', 'rejected') THEN
      NEW.customer_decided_at := COALESCE(NEW.customer_decided_at, now());
    END IF;
  END IF;

  RETURN NEW;
END; $$;




-- ============================================================================
-- supabase\migrations\20260625103000_unique_customer_tin.sql
-- ============================================================================

do $$
begin
  if exists (
    select 1
    from public.customers
    where nullif(regexp_replace(tin_number, '\D', '', 'g'), '') is not null
    group by regexp_replace(tin_number, '\D', '', 'g')
    having count(*) > 1
  ) then
    raise exception 'Duplicate customer TIN values exist. Update duplicates before applying unique TIN restriction.';
  end if;
end $$;

create unique index if not exists customers_tin_number_normalized_key
on public.customers ((regexp_replace(tin_number, '\D', '', 'g')))
where nullif(regexp_replace(tin_number, '\D', '', 'g'), '') is not null;




-- ============================================================================
-- supabase\migrations\20260701162000_quote_line_item_edit_policy_repair.sql
-- ============================================================================

DROP POLICY IF EXISTS "qli draft sales insert" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli draft sales update" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli draft sales delete" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli editable sales insert" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli editable sales update" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli editable sales delete" ON public.quote_line_items;

CREATE POLICY "qli editable sales insert" ON public.quote_line_items
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.can_sales_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quote_line_items.quotation_id
        AND q.status IN ('draft', 'pending_manager_approval')
    )
  );

CREATE POLICY "qli editable sales update" ON public.quote_line_items
  FOR UPDATE TO authenticated
  USING (
    app_private.can_sales_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quote_line_items.quotation_id
        AND q.status IN ('draft', 'pending_manager_approval')
    )
  )
  WITH CHECK (
    app_private.can_sales_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quote_line_items.quotation_id
        AND q.status IN ('draft', 'pending_manager_approval')
    )
  );

CREATE POLICY "qli editable sales delete" ON public.quote_line_items
  FOR DELETE TO authenticated
  USING (
    app_private.can_sales_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quote_line_items.quotation_id
        AND q.status IN ('draft', 'pending_manager_approval')
    )
  );




-- ============================================================================
-- supabase\migrations\20260702090000_goal2_quote_foundation.sql
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signature_url TEXT;

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS sales_agent_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS sales_agent_signature_url_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS adjustment_label TEXT NOT NULL DEFAULT 'Adjustment',
  ADD COLUMN IF NOT EXISTS adjustment_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.get_current_user_profile()
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  role TEXT,
  signature_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS user_id,
    p.display_name,
    ur.role::text AS role,
    p.signature_url
  FROM public.profiles p
  LEFT JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE p.id = auth.uid()
    AND p.status = 'active'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_current_user_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_user_profile() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_quote_derived_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.adjustment_label := COALESCE(NULLIF(trim(NEW.adjustment_label), ''), 'Adjustment');
  NEW.adjustment_amount := COALESCE(NEW.adjustment_amount, 0);
  NEW.total_amount := COALESCE(NEW.subtotal, 0) + NEW.adjustment_amount;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_quote_derived_totals ON public.quotations;
CREATE TRIGGER trg_apply_quote_derived_totals
  BEFORE INSERT OR UPDATE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.apply_quote_derived_totals();

CREATE OR REPLACE FUNCTION public.recompute_quote_totals(_quote UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s NUMERIC(14,2);
BEGIN
  SELECT COALESCE(SUM(line_total), 0)
  INTO s
  FROM public.quote_line_items
  WHERE quotation_id = _quote;

  UPDATE public.quotations
  SET subtotal = s
  WHERE id = _quote;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_quote_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, app_private
AS $$
DECLARE
  old_status TEXT := OLD.status::text;
  new_status TEXT := NEW.status::text;
  reopening BOOLEAN := current_setting('app.reopen_quote_for_correction', true) = 'on';
  actor_signature TEXT;
BEGIN
  IF old_status <> 'draft' THEN
    IF NOT (reopening AND old_status = 'approved' AND new_status = 'draft') THEN
      IF NEW.customer_id <> OLD.customer_id
        OR NEW.project_name <> OLD.project_name
        OR NEW.quote_date <> OLD.quote_date
        OR COALESCE(NEW.remarks, '') <> COALESCE(OLD.remarks, '')
        OR COALESCE(NEW.sales_agent, '') <> COALESCE(OLD.sales_agent, '')
        OR COALESCE(NEW.terms, '') <> COALESCE(OLD.terms, '')
        OR COALESCE(NEW.sales_agent_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
           <> COALESCE(OLD.sales_agent_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
        OR COALESCE(NEW.sales_agent_signature_url_snapshot, '')
           <> COALESCE(OLD.sales_agent_signature_url_snapshot, '')
        OR COALESCE(NEW.adjustment_label, '') <> COALESCE(OLD.adjustment_label, '')
        OR NEW.adjustment_amount <> OLD.adjustment_amount
        OR NEW.subtotal <> OLD.subtotal
        OR NEW.total_amount <> OLD.total_amount
        OR NEW.tax_type <> OLD.tax_type THEN
        RAISE EXCEPTION 'Only draft quotations can be edited.';
      END IF;
    END IF;
  END IF;

  IF new_status <> old_status THEN
    IF old_status = 'draft' AND new_status <> 'sent' THEN
      RAISE EXCEPTION 'Draft quotations must be sent before approval or rejection.';
    END IF;

    IF old_status = 'sent' AND new_status NOT IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Sent quotations can only be approved or rejected.';
    END IF;

    IF old_status IN ('approved', 'rejected') THEN
      IF NOT (reopening AND old_status = 'approved' AND new_status = 'draft') THEN
        RAISE EXCEPTION 'Final quotation statuses cannot be changed.';
      END IF;
    END IF;

    IF new_status IN ('sent', 'approved') AND NEW.total_amount <= 0 THEN
      RAISE EXCEPTION 'Quote total must be greater than zero.';
    END IF;

    IF new_status = 'sent' AND OLD.status = 'draft' THEN
      NEW.sent_at := COALESCE(NEW.sent_at, now());
      IF NEW.sales_agent_user_id IS NULL THEN
        NEW.sales_agent_user_id := auth.uid();
      END IF;
      SELECT p.signature_url
      INTO actor_signature
      FROM public.profiles p
      WHERE p.id = COALESCE(NEW.sales_agent_user_id, auth.uid());
      NEW.sales_agent_signature_url_snapshot := actor_signature;
    END IF;

    IF new_status = 'approved' THEN
      NEW.approved_at := COALESCE(NEW.approved_at, now());
    END IF;

    IF new_status = 'rejected' THEN
      NEW.rejected_at := COALESCE(NEW.rejected_at, now());
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_quotation_for_correction(
  quotation_id UUID,
  reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
  q public.quotations%ROWTYPE;
  actor_role TEXT;
  trimmed_reason TEXT := trim(COALESCE(reason, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to reopen quotations.';
  END IF;

  SELECT ur.role::text
  INTO actor_role
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.user_id = auth.uid()
    AND p.status = 'active'
  LIMIT 1;

  IF actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owner or admin staff can reopen approved quotations.';
  END IF;

  IF trimmed_reason = '' THEN
    RAISE EXCEPTION 'A correction reason is required.';
  END IF;

  SELECT *
  INTO q
  FROM public.quotations
  WHERE id = quotation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found.';
  END IF;

  IF q.status::text <> 'approved' THEN
    RAISE EXCEPTION 'Only approved quotations can be reopened for correction.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.job_orders jo WHERE jo.quotation_id = q.id) THEN
    RAISE EXCEPTION 'This quotation already has a job order and cannot be reopened.';
  END IF;

  PERFORM set_config('app.reopen_quote_for_correction', 'on', true);

  UPDATE public.quotations
  SET
    status = 'draft',
    sent_at = NULL,
    approved_at = NULL,
    rejected_at = NULL
  WHERE id = q.id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_type,
    entity_id,
    old_values,
    new_values
  )
  VALUES (
    auth.uid(),
    'quotation.reopened',
    'quotation',
    q.id,
    jsonb_build_object('status', q.status::text),
    jsonb_build_object(
      'status', 'draft',
      'reason', trimmed_reason,
      'old_status', q.status::text,
      'new_status', 'draft'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_quotation_for_correction(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_quotation_for_correction(UUID, TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS "qli editable sales insert" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli editable sales update" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli editable sales delete" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli draft sales insert" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli draft sales update" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli draft sales delete" ON public.quote_line_items;

CREATE POLICY "qli draft sales insert" ON public.quote_line_items
  FOR INSERT TO authenticated WITH CHECK (
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




-- ============================================================================
-- supabase\migrations\20260702093000_goal4_quote_attachments.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.quote_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size bigint NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE public.quote_attachments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_quote_attachments_quotation
  ON public.quote_attachments(quotation_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.quote_attachments
  DROP CONSTRAINT IF EXISTS quote_attachments_file_type_check,
  ADD CONSTRAINT quote_attachments_file_type_check
    CHECK (file_type IN ('image/jpeg', 'image/png', 'image/webp')),
  DROP CONSTRAINT IF EXISTS quote_attachments_file_size_check,
  ADD CONSTRAINT quote_attachments_file_size_check
    CHECK (file_size > 0 AND file_size <= 10485760);

GRANT SELECT, INSERT, UPDATE ON public.quote_attachments TO authenticated;
GRANT ALL ON public.quote_attachments TO service_role;

DROP POLICY IF EXISTS "quote attachments sensitive read" ON public.quote_attachments;
DROP POLICY IF EXISTS "quote attachments sales insert" ON public.quote_attachments;
DROP POLICY IF EXISTS "quote attachments owner admin delete" ON public.quote_attachments;

CREATE POLICY "quote attachments sensitive read"
ON public.quote_attachments FOR SELECT TO authenticated
USING (
  (
    deleted_at IS NULL
    AND app_private.can_view_sensitive_operations(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.quotations q
      WHERE q.id = quote_attachments.quotation_id
    )
  )
  OR (
    app_private.is_active_user(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role::text IN ('owner', 'admin')
    )
  )
);

CREATE POLICY "quote attachments sales insert"
ON public.quote_attachments FOR INSERT TO authenticated
WITH CHECK (
  deleted_at IS NULL
  AND uploaded_by = auth.uid()
  AND app_private.can_sales_work(auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.quotations q
    WHERE q.id = quote_attachments.quotation_id
  )
);

CREATE POLICY "quote attachments owner admin delete"
ON public.quote_attachments FOR UPDATE TO authenticated
USING (
  deleted_at IS NULL
  AND app_private.is_active_user(auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role::text IN ('owner', 'admin')
  )
)
WITH CHECK (
  app_private.is_active_user(auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role::text IN ('owner', 'admin')
  )
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'quote-attachments',
  'quote-attachments',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "quote attachment objects read" ON storage.objects;
DROP POLICY IF EXISTS "quote attachment objects upload" ON storage.objects;
DROP POLICY IF EXISTS "quote attachment objects delete owner admin" ON storage.objects;

CREATE POLICY "quote attachment objects read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'quote-attachments'
  AND app_private.can_view_sensitive_operations(auth.uid())
);

CREATE POLICY "quote attachment objects upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'quote-attachments'
  AND app_private.can_sales_work(auth.uid())
);

CREATE POLICY "quote attachment objects delete owner admin"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'quote-attachments'
  AND app_private.is_active_user(auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role::text IN ('owner', 'admin')
  )
);




-- ============================================================================
-- supabase\migrations\20260702103000_goal6_invoice_ewt_snapshots.sql
-- ============================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS ewt_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ewt_rate NUMERIC(8,4) NOT NULL DEFAULT 0.02,
  ADD COLUMN IF NOT EXISTS vatable_sales_snapshot NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_rate_snapshot NUMERIC(8,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_amount_snapshot NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ewt_amount_snapshot NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_total_snapshot NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ewt_treatment_snapshot TEXT NOT NULL DEFAULT 'reference_only',
  ADD COLUMN IF NOT EXISTS amount_due_snapshot NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_ewt_treatment_snapshot_check,
  ADD CONSTRAINT invoices_ewt_treatment_snapshot_check
    CHECK (ewt_treatment_snapshot IN ('reference_only', 'deducted_from_amount_due'));

UPDATE public.invoices
SET
  vat_rate_snapshot = CASE WHEN tax_type = 'vatable' THEN 0.12 ELSE 0 END,
  gross_total_snapshot = invoice_amount,
  vatable_sales_snapshot = CASE
    WHEN tax_type = 'vatable' THEN ROUND(invoice_amount / 1.12, 2)
    ELSE invoice_amount
  END,
  vat_amount_snapshot = CASE
    WHEN tax_type = 'vatable' THEN ROUND(invoice_amount - ROUND(invoice_amount / 1.12, 2), 2)
    ELSE 0
  END,
  ewt_amount_snapshot = CASE
    WHEN tax_type = 'vatable' AND ewt_enabled THEN ROUND(ROUND(invoice_amount / 1.12, 2) * ewt_rate, 2)
    ELSE 0
  END,
  amount_due_snapshot = CASE
    WHEN tax_type = 'vatable'
      AND ewt_enabled
      AND ewt_treatment_snapshot = 'deducted_from_amount_due'
      THEN ROUND(invoice_amount - ROUND(ROUND(invoice_amount / 1.12, 2) * ewt_rate, 2), 2)
    ELSE invoice_amount
  END;

CREATE OR REPLACE FUNCTION public.validate_invoice_from_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE
  j public.job_orders%ROWTYPE;
  vatable_sales NUMERIC(14,2);
  vat_amount NUMERIC(14,2);
  ewt_amount NUMERIC(14,2);
  gross_total NUMERIC(14,2);
BEGIN
  SELECT * INTO j FROM public.job_orders WHERE id = NEW.job_order_id;
  IF j.id IS NULL THEN
    RAISE EXCEPTION 'Invoices must be generated from job orders.';
  END IF;
  IF j.status <> 'completed' THEN
    RAISE EXCEPTION 'Complete the Job Order before generating an invoice.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.job_order_line_items WHERE job_order_id = NEW.job_order_id) THEN
    RAISE EXCEPTION 'Invoices require job order line items.';
  END IF;

  NEW.customer_id := j.customer_id;
  NEW.invoice_amount := j.quoted_amount;
  NEW.tax_type := COALESCE(j.tax_type, 'non_vat'::public.tax_type);
  NEW.ewt_treatment_snapshot := COALESCE(NEW.ewt_treatment_snapshot, 'reference_only');

  IF NEW.tax_type = 'vatable' THEN
    gross_total := ROUND(NEW.invoice_amount, 2);
    vatable_sales := ROUND(gross_total / 1.12, 2);
    vat_amount := ROUND(gross_total - vatable_sales, 2);
    NEW.ewt_enabled := COALESCE(NEW.ewt_enabled, false);
    NEW.ewt_rate := COALESCE(NEW.ewt_rate, 0.02);
    ewt_amount := CASE
      WHEN NEW.ewt_enabled THEN ROUND(vatable_sales * NEW.ewt_rate, 2)
      ELSE 0
    END;

    NEW.vat_rate_snapshot := 0.12;
    NEW.vatable_sales_snapshot := vatable_sales;
    NEW.vat_amount_snapshot := vat_amount;
    NEW.ewt_amount_snapshot := ewt_amount;
    NEW.gross_total_snapshot := gross_total;
    NEW.amount_due_snapshot := CASE
      WHEN NEW.ewt_treatment_snapshot = 'deducted_from_amount_due' THEN ROUND(gross_total - ewt_amount, 2)
      ELSE gross_total
    END;
  ELSE
    NEW.ewt_enabled := false;
    NEW.ewt_rate := COALESCE(NEW.ewt_rate, 0.02);
    NEW.vat_rate_snapshot := 0;
    NEW.vatable_sales_snapshot := ROUND(NEW.invoice_amount, 2);
    NEW.vat_amount_snapshot := 0;
    NEW.ewt_amount_snapshot := 0;
    NEW.gross_total_snapshot := ROUND(NEW.invoice_amount, 2);
    NEW.amount_due_snapshot := ROUND(NEW.invoice_amount, 2);
  END IF;

  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.validate_invoice_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  invoice_total NUMERIC(14,2);
  paid_total NUMERIC(14,2);
BEGIN
  SELECT COALESCE(amount_due_snapshot, invoice_amount)
  INTO invoice_total
  FROM public.invoices
  WHERE id = NEW.invoice_id;

  IF invoice_total IS NULL THEN
    RAISE EXCEPTION 'Invoice not found.';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
  INTO paid_total
  FROM public.invoice_payments
  WHERE invoice_id = NEW.invoice_id
    AND id <> COALESCE(NEW.id, gen_random_uuid());

  IF paid_total + NEW.amount > invoice_total THEN
    RAISE EXCEPTION 'Payment exceeds remaining invoice balance.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_invoice_paid_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target_invoice UUID := COALESCE(NEW.invoice_id, OLD.invoice_id);
  invoice_total NUMERIC(14,2);
  paid_total NUMERIC(14,2);
BEGIN
  SELECT COALESCE(amount_due_snapshot, invoice_amount)
  INTO invoice_total
  FROM public.invoices
  WHERE id = target_invoice;

  SELECT COALESCE(SUM(amount), 0)
  INTO paid_total
  FROM public.invoice_payments
  WHERE invoice_id = target_invoice;

  UPDATE public.invoices
  SET
    status = CASE WHEN paid_total >= invoice_total THEN 'paid'::public.invoice_status ELSE 'issued'::public.invoice_status END,
    paid_at = CASE WHEN paid_total >= invoice_total THEN COALESCE(paid_at, now()) ELSE NULL END,
    payment_date = CASE WHEN paid_total >= invoice_total THEN (SELECT MAX(payment_date) FROM public.invoice_payments WHERE invoice_id = target_invoice) ELSE NULL END
  WHERE id = target_invoice;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_invoice_payment_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'This invoice has already been marked as paid.';
  END IF;

  IF NEW.job_order_id <> OLD.job_order_id
    OR NEW.customer_id <> OLD.customer_id
    OR NEW.invoice_amount <> OLD.invoice_amount
    OR NEW.invoice_date <> OLD.invoice_date
    OR COALESCE(NEW.due_date, DATE '0001-01-01') <> COALESCE(OLD.due_date, DATE '0001-01-01')
    OR NEW.invoice_number <> OLD.invoice_number
    OR NEW.tax_type <> OLD.tax_type
    OR NEW.ewt_enabled <> OLD.ewt_enabled
    OR NEW.ewt_rate <> OLD.ewt_rate
    OR NEW.vatable_sales_snapshot <> OLD.vatable_sales_snapshot
    OR NEW.vat_rate_snapshot <> OLD.vat_rate_snapshot
    OR NEW.vat_amount_snapshot <> OLD.vat_amount_snapshot
    OR NEW.ewt_amount_snapshot <> OLD.ewt_amount_snapshot
    OR NEW.gross_total_snapshot <> OLD.gross_total_snapshot
    OR NEW.ewt_treatment_snapshot <> OLD.ewt_treatment_snapshot
    OR NEW.amount_due_snapshot <> OLD.amount_due_snapshot
  THEN
    RAISE EXCEPTION 'Invoice source and amount are immutable.';
  END IF;

  IF NEW.status <> 'paid' THEN
    RAISE EXCEPTION 'Invoices can only be updated to record payment.';
  END IF;

  IF NEW.payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required.';
  END IF;

  IF NEW.payment_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Future payment dates are not allowed.';
  END IF;

  IF NEW.paid_at IS NULL THEN
    NEW.paid_at := now();
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_invoice_payment_update ON public.invoices;
CREATE TRIGGER trg_validate_invoice_payment_update
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.payment_date IS DISTINCT FROM NEW.payment_date
    OR OLD.payment_remarks IS DISTINCT FROM NEW.payment_remarks
    OR OLD.job_order_id IS DISTINCT FROM NEW.job_order_id
    OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
    OR OLD.invoice_amount IS DISTINCT FROM NEW.invoice_amount
    OR OLD.invoice_date IS DISTINCT FROM NEW.invoice_date
    OR OLD.due_date IS DISTINCT FROM NEW.due_date
    OR OLD.invoice_number IS DISTINCT FROM NEW.invoice_number
    OR OLD.tax_type IS DISTINCT FROM NEW.tax_type
    OR OLD.ewt_enabled IS DISTINCT FROM NEW.ewt_enabled
    OR OLD.ewt_rate IS DISTINCT FROM NEW.ewt_rate
    OR OLD.vatable_sales_snapshot IS DISTINCT FROM NEW.vatable_sales_snapshot
    OR OLD.vat_rate_snapshot IS DISTINCT FROM NEW.vat_rate_snapshot
    OR OLD.vat_amount_snapshot IS DISTINCT FROM NEW.vat_amount_snapshot
    OR OLD.ewt_amount_snapshot IS DISTINCT FROM NEW.ewt_amount_snapshot
    OR OLD.gross_total_snapshot IS DISTINCT FROM NEW.gross_total_snapshot
    OR OLD.ewt_treatment_snapshot IS DISTINCT FROM NEW.ewt_treatment_snapshot
    OR OLD.amount_due_snapshot IS DISTINCT FROM NEW.amount_due_snapshot
  )
  EXECUTE FUNCTION public.validate_invoice_payment_update();

CREATE OR REPLACE VIEW public.customer_operational_summaries
WITH (security_invoker = true) AS
SELECT
  c.id AS customer_id,
  COALESCE(q.total_quotes, 0)::integer AS total_quotes,
  COALESCE(j.active_jobs, 0)::integer AS active_jobs,
  COALESCE(i.outstanding_balance, 0)::numeric(14, 2) AS outstanding_balance,
  COALESCE(i.lifetime_revenue, 0)::numeric(14, 2) AS lifetime_revenue
FROM public.customers c
LEFT JOIN (
  SELECT customer_id, COUNT(*) AS total_quotes
  FROM public.quotations
  GROUP BY customer_id
) q ON q.customer_id = c.id
LEFT JOIN (
  SELECT customer_id, COUNT(*) FILTER (WHERE status <> 'completed') AS active_jobs
  FROM public.job_orders
  GROUP BY customer_id
) j ON j.customer_id = c.id
LEFT JOIN (
  SELECT
    i.customer_id,
    SUM(GREATEST(COALESCE(i.amount_due_snapshot, i.invoice_amount) - COALESCE(p.amount_paid, 0), 0)) AS outstanding_balance,
    SUM(COALESCE(i.amount_due_snapshot, i.invoice_amount)) AS lifetime_revenue
  FROM public.invoices i
  LEFT JOIN (
    SELECT invoice_id, SUM(amount) AS amount_paid
    FROM public.invoice_payments
    GROUP BY invoice_id
  ) p ON p.invoice_id = i.id
  GROUP BY i.customer_id
) i ON i.customer_id = c.id;

GRANT SELECT ON public.customer_operational_summaries TO authenticated;




-- ============================================================================
-- supabase\migrations\20260702113000_goal7_owner_only_audit_logs.sql
-- ============================================================================

DROP POLICY IF EXISTS "audit read admin" ON public.audit_logs;
DROP POLICY IF EXISTS "audit read owner" ON public.audit_logs;

CREATE POLICY "audit read owner" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (app_private.can_manage_users(auth.uid()) AND app_private.is_active_user(auth.uid()));



