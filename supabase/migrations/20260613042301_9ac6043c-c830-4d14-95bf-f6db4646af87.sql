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