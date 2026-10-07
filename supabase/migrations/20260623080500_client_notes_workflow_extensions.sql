ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'owner';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'sales';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'accounting';

ALTER TABLE public.job_expenses
  ADD COLUMN IF NOT EXISTS quantity NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS unit_of_measure TEXT,
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14,2);

DO $$
BEGIN
  ALTER TABLE public.job_expenses
    ADD CONSTRAINT job_expenses_material_breakdown_positive
    CHECK (
      expense_type <> 'materials'
      OR (
        (quantity IS NULL OR quantity > 0)
        AND (unit_cost IS NULL OR unit_cost > 0)
      )
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.tax_type AS ENUM ('vatable', 'non_vat');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS tax_type public.tax_type NOT NULL DEFAULT 'non_vat';

ALTER TABLE public.job_orders
  ADD COLUMN IF NOT EXISTS tax_type public.tax_type NOT NULL DEFAULT 'non_vat';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tax_type public.tax_type NOT NULL DEFAULT 'non_vat';

UPDATE public.job_orders j
SET tax_type = q.tax_type
FROM public.quotations q
WHERE j.quotation_id = q.id;

UPDATE public.invoices i
SET tax_type = j.tax_type
FROM public.job_orders j
WHERE i.job_order_id = j.id;

DO $$
BEGIN
  ALTER TABLE public.invoices
    ADD CONSTRAINT invoices_job_order_id_unique UNIQUE (job_order_id);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE OR REPLACE FUNCTION app_private.can_write_operations(_user_id uuid)
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
        AND role::text IN ('owner', 'admin', 'sales', 'accounting')
    );
$$;

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
        AND role::text IN ('owner', 'admin')
    );
$$;

REVOKE ALL ON FUNCTION app_private.can_manage_users(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.can_manage_users(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "roles active self or admin read" ON public.user_roles;
CREATE POLICY "roles active self or admin read" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    app_private.is_active_user(auth.uid())
    AND (user_id = auth.uid() OR app_private.can_manage_users(auth.uid()))
  );

DROP POLICY IF EXISTS "roles admin write" ON public.user_roles;
CREATE POLICY "roles admin write" ON public.user_roles
  FOR ALL TO authenticated
  USING (app_private.can_manage_users(auth.uid()) AND app_private.is_active_user(auth.uid()))
  WITH CHECK (app_private.can_manage_users(auth.uid()) AND app_private.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "profiles admin update" ON public.profiles;
CREATE POLICY "profiles admin update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (app_private.can_manage_users(auth.uid()) AND app_private.is_active_user(auth.uid()))
  WITH CHECK (app_private.can_manage_users(auth.uid()) AND app_private.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "audit read admin" ON public.audit_logs;
CREATE POLICY "audit read admin" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (app_private.can_manage_users(auth.uid()) AND app_private.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "item templates admin insert" ON public.item_templates;
CREATE POLICY "item templates admin insert" ON public.item_templates
  FOR INSERT TO authenticated
  WITH CHECK (app_private.can_manage_users(auth.uid()) AND app_private.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "item templates admin update" ON public.item_templates;
CREATE POLICY "item templates admin update" ON public.item_templates
  FOR UPDATE TO authenticated
  USING (app_private.can_manage_users(auth.uid()) AND app_private.is_active_user(auth.uid()))
  WITH CHECK (app_private.can_manage_users(auth.uid()) AND app_private.is_active_user(auth.uid()));
