
-- ============================================================
-- Migration: supabase/migrations/20260611124808_7875be9c-f2b7-44c1-91f2-0f994cda881a.sql
-- ============================================================

-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin','staff','viewer');
CREATE TYPE public.quote_status AS ENUM ('draft','sent','approved','rejected');
CREATE TYPE public.job_status AS ENUM ('open','completed');
CREATE TYPE public.invoice_status AS ENUM ('issued','paid');
CREATE TYPE public.pricing_mode AS ENUM ('sqft','fixed');
CREATE TYPE public.unit_of_measure AS ENUM ('inches','feet','millimeters','centimeters','meters');
CREATE TYPE public.expense_type AS ENUM ('materials','labor','delivery','outsourcing','miscellaneous');

-- ============ updated_at trigger fn ============
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles read all authed" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles update self" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE TRIGGER trg_profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "roles self read" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "roles admin write" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- handle new user: create profile + assign role (admin if first user)
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE user_count INT;
BEGIN
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)), NEW.email);
  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count <= 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'staff');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ SEQUENCES for numbering ============
CREATE SEQUENCE public.seq_customer_no START 1;
CREATE SEQUENCE public.seq_quote_no START 1;
CREATE SEQUENCE public.seq_job_no START 1;
CREATE SEQUENCE public.seq_invoice_no START 1;

-- ============ CUSTOMERS ============
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code TEXT UNIQUE NOT NULL DEFAULT ('CUST-' || lpad(nextval('public.seq_customer_no')::text, 4, '0')),
  customer_name TEXT NOT NULL,
  contact_person TEXT NOT NULL,
  contact_number TEXT NOT NULL,
  email TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers all authed" ON public.customers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_customers_touch BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ QUOTATIONS ============
CREATE TABLE public.quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number TEXT UNIQUE NOT NULL DEFAULT ('QUO-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.seq_quote_no')::text, 4, '0')),
  customer_id UUID NOT NULL REFERENCES public.customers ON DELETE RESTRICT,
  project_name TEXT NOT NULL,
  quote_date DATE NOT NULL DEFAULT CURRENT_DATE,
  remarks TEXT,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status public.quote_status NOT NULL DEFAULT 'draft',
  sent_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotations TO authenticated;
GRANT ALL ON public.quotations TO service_role;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotations all authed" ON public.quotations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_quotations_touch BEFORE UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_quotations_customer ON public.quotations(customer_id);
CREATE INDEX idx_quotations_status ON public.quotations(status);

-- ============ QUOTE LINE ITEMS ============
CREATE TABLE public.quote_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES public.quotations ON DELETE CASCADE,
  description TEXT NOT NULL,
  pricing_mode public.pricing_mode NOT NULL,
  unit_of_measure public.unit_of_measure,
  width NUMERIC(12,4),
  height NUMERIC(12,4),
  quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
  rate_per_sqft NUMERIC(12,2),
  computed_sqft NUMERIC(14,4),
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_line_items TO authenticated;
GRANT ALL ON public.quote_line_items TO service_role;
ALTER TABLE public.quote_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qli all authed" ON public.quote_line_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_qli_touch BEFORE UPDATE ON public.quote_line_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_qli_quotation ON public.quote_line_items(quotation_id);

-- Recompute quotation totals when line items change
CREATE OR REPLACE FUNCTION public.recompute_quote_totals(_quote UUID) RETURNS VOID
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s NUMERIC(14,2);
BEGIN
  SELECT COALESCE(SUM(line_total),0) INTO s FROM public.quote_line_items WHERE quotation_id = _quote;
  UPDATE public.quotations SET subtotal = s, total_amount = s WHERE id = _quote;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_qli_recompute() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM public.recompute_quote_totals(COALESCE(NEW.quotation_id, OLD.quotation_id));
  RETURN COALESCE(NEW, OLD);
END; $$;
CREATE TRIGGER trg_qli_recompute_aiud AFTER INSERT OR UPDATE OR DELETE ON public.quote_line_items
FOR EACH ROW EXECUTE FUNCTION public.trg_qli_recompute();

-- ============ JOB ORDERS ============
CREATE TABLE public.job_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_number TEXT UNIQUE NOT NULL DEFAULT ('JO-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.seq_job_no')::text, 4, '0')),
  quotation_id UUID NOT NULL REFERENCES public.quotations ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers ON DELETE RESTRICT,
  project_name TEXT NOT NULL,
  quoted_amount NUMERIC(14,2) NOT NULL,
  target_completion_date DATE,
  internal_notes TEXT,
  status public.job_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_orders TO authenticated;
GRANT ALL ON public.job_orders TO service_role;
ALTER TABLE public.job_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jo all authed" ON public.job_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_jo_touch BEFORE UPDATE ON public.job_orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_jo_quote ON public.job_orders(quotation_id);
CREATE INDEX idx_jo_status ON public.job_orders(status);

-- ============ JOB EXPENSES ============
CREATE TABLE public.job_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id UUID NOT NULL REFERENCES public.job_orders ON DELETE CASCADE,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expense_type public.expense_type NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  created_by UUID REFERENCES auth.users,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_expenses TO authenticated;
GRANT ALL ON public.job_expenses TO service_role;
ALTER TABLE public.job_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expenses all authed" ON public.job_expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_exp_job ON public.job_expenses(job_order_id);

-- ============ INVOICES ============
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT UNIQUE NOT NULL DEFAULT ('INV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.seq_invoice_no')::text, 4, '0')),
  job_order_id UUID NOT NULL UNIQUE REFERENCES public.job_orders ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers ON DELETE RESTRICT,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  invoice_amount NUMERIC(14,2) NOT NULL,
  status public.invoice_status NOT NULL DEFAULT 'issued',
  paid_at TIMESTAMPTZ,
  payment_remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices all authed" ON public.invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_inv_touch BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_inv_job ON public.invoices(job_order_id);
CREATE INDEX idx_inv_status ON public.invoices(status);

-- ============ AUDIT LOGS ============
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit insert authed" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "audit read admin" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_audit_entity ON public.audit_logs(entity_type, entity_id);

-- ============================================================
-- Migration: supabase/migrations/20260611143000_foundation_permissions.sql
-- ============================================================
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
        AND q.status IN ('draft', 'pending_manager_approval')
    )
  );
CREATE POLICY "qli draft operations update" ON public.quote_line_items
  FOR UPDATE TO authenticated
  USING (
    public.can_write_operations(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quotation_id
        AND q.status IN ('draft', 'pending_manager_approval')
    )
  )
  WITH CHECK (
    public.can_write_operations(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quotation_id
        AND q.status IN ('draft', 'pending_manager_approval')
    )
  );
CREATE POLICY "qli draft operations delete" ON public.quote_line_items
  FOR DELETE TO authenticated
  USING (
    public.can_write_operations(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quotation_id
        AND q.status IN ('draft', 'pending_manager_approval')
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

-- ============================================================
-- Migration: supabase/migrations/20260611150000_quote_workflow_guards.sql
-- ============================================================
-- Quote workflow guards: draft is editable, sent/approved/rejected are historical.

ALTER TABLE public.quote_line_items
  ADD CONSTRAINT quote_line_items_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT quote_line_items_unit_price_nonnegative CHECK (unit_price >= 0),
  ADD CONSTRAINT quote_line_items_line_total_nonnegative CHECK (line_total >= 0),
  ADD CONSTRAINT quote_line_items_sqft_values_valid CHECK (
    (
      pricing_mode = 'sqft'
      AND unit_of_measure IS NOT NULL
      AND width > 0
      AND height > 0
      AND rate_per_sqft > 0
      AND computed_sqft > 0
    )
    OR (
      pricing_mode = 'fixed'
      AND unit_of_measure IS NULL
      AND width IS NULL
      AND height IS NULL
      AND rate_per_sqft IS NULL
      AND computed_sqft IS NULL
    )
  );

CREATE OR REPLACE FUNCTION public.validate_quote_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF NEW.customer_id <> OLD.customer_id
      OR NEW.project_name <> OLD.project_name
      OR NEW.quote_date <> OLD.quote_date
      OR COALESCE(NEW.remarks, '') <> COALESCE(OLD.remarks, '')
      OR NEW.subtotal <> OLD.subtotal
      OR NEW.total_amount <> OLD.total_amount THEN
      RAISE EXCEPTION 'Only draft quotations can be edited.';
    END IF;
  END IF;

  IF NEW.status <> OLD.status THEN
    IF OLD.status = 'draft' AND NEW.status <> 'sent' THEN
      RAISE EXCEPTION 'Draft quotations must be sent before approval or rejection.';
    END IF;
    IF OLD.status = 'sent' AND NEW.status NOT IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Sent quotations can only be approved or rejected.';
    END IF;
    IF OLD.status IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Final quotation statuses cannot be changed.';
    END IF;
    IF NEW.status IN ('sent', 'approved') AND NEW.total_amount <= 0 THEN
      RAISE EXCEPTION 'Quote total must be greater than zero.';
    END IF;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_quote_update ON public.quotations;
CREATE TRIGGER trg_validate_quote_update
  BEFORE UPDATE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.validate_quote_update();

-- ============================================================
-- Migration: supabase/migrations/20260611153000_job_order_snapshots.sql
-- ============================================================
-- Job order snapshots preserve quote line details at conversion time.

CREATE TABLE public.job_order_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id UUID NOT NULL REFERENCES public.job_orders ON DELETE CASCADE,
  quote_line_item_id UUID REFERENCES public.quote_line_items ON DELETE SET NULL,
  description TEXT NOT NULL,
  pricing_mode public.pricing_mode NOT NULL,
  unit_of_measure public.unit_of_measure,
  width NUMERIC(12,4),
  height NUMERIC(12,4),
  quantity NUMERIC(12,2) NOT NULL,
  rate_per_sqft NUMERIC(12,2),
  computed_sqft NUMERIC(14,4),
  unit_price NUMERIC(14,2) NOT NULL,
  line_total NUMERIC(14,2) NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.job_order_line_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.job_order_line_items TO authenticated;
GRANT ALL ON public.job_order_line_items TO service_role;

CREATE INDEX idx_joli_job ON public.job_order_line_items(job_order_id);

CREATE POLICY "joli active read" ON public.job_order_line_items
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "joli operations insert" ON public.job_order_line_items
  FOR INSERT TO authenticated WITH CHECK (public.can_write_operations(auth.uid()));

CREATE OR REPLACE FUNCTION public.snapshot_job_order_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  INSERT INTO public.job_order_line_items (
    job_order_id,
    quote_line_item_id,
    description,
    pricing_mode,
    unit_of_measure,
    width,
    height,
    quantity,
    rate_per_sqft,
    computed_sqft,
    unit_price,
    line_total,
    sort_order
  )
  SELECT
    NEW.id,
    qli.id,
    qli.description,
    qli.pricing_mode,
    qli.unit_of_measure,
    qli.width,
    qli.height,
    qli.quantity,
    qli.rate_per_sqft,
    qli.computed_sqft,
    qli.unit_price,
    qli.line_total,
    qli.sort_order
  FROM public.quote_line_items qli
  WHERE qli.quotation_id = NEW.quotation_id
  ORDER BY qli.sort_order, qli.created_at;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_snapshot_job_order_lines ON public.job_orders;
CREATE TRIGGER trg_snapshot_job_order_lines
  AFTER INSERT ON public.job_orders
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_job_order_lines();

-- ============================================================
-- Migration: supabase/migrations/20260611154500_expense_validation_guards.sql
-- ============================================================
-- Expense validation guards for Phase 5.

ALTER TABLE public.job_expenses
  ADD CONSTRAINT job_expenses_amount_positive CHECK (amount > 0) NOT VALID,
  ADD CONSTRAINT job_expenses_not_future_dated CHECK (expense_date <= CURRENT_DATE) NOT VALID;

DROP POLICY IF EXISTS "expenses operations insert" ON public.job_expenses;
DROP POLICY IF EXISTS "expenses operations update" ON public.job_expenses;

CREATE POLICY "expenses operations insert" ON public.job_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_write_operations(auth.uid())
    AND amount > 0
    AND expense_date <= CURRENT_DATE
  );

CREATE POLICY "expenses operations update" ON public.job_expenses
  FOR UPDATE TO authenticated
  USING (public.can_write_operations(auth.uid()))
  WITH CHECK (
    public.can_write_operations(auth.uid())
    AND amount > 0
    AND expense_date <= CURRENT_DATE
  );

-- ============================================================
-- Migration: supabase/migrations/20260611161000_invoice_payment_snapshots.sql
-- ============================================================
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_date DATE;

CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices ON DELETE CASCADE,
  job_order_line_item_id UUID REFERENCES public.job_order_line_items ON DELETE SET NULL,
  description TEXT NOT NULL,
  pricing_mode public.pricing_mode NOT NULL,
  width NUMERIC(12,4),
  height NUMERIC(12,4),
  unit_of_measure public.unit_of_measure,
  computed_sqft NUMERIC(14,4),
  rate_per_sqft NUMERIC(14,2),
  quantity NUMERIC(14,4) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  line_total NUMERIC(14,2) NOT NULL,
  sort_order INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.invoice_line_items TO authenticated;
GRANT ALL ON public.invoice_line_items TO service_role;
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice line active read" ON public.invoice_line_items;
CREATE POLICY "invoice line active read" ON public.invoice_line_items
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "invoice line insert from invoice" ON public.invoice_line_items;
CREATE POLICY "invoice line insert from invoice" ON public.invoice_line_items
  FOR INSERT TO authenticated WITH CHECK (
    public.can_write_operations(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_id
    )
  );

ALTER TABLE public.invoice_line_items
  ADD CONSTRAINT invoice_line_items_quantity_positive CHECK (quantity > 0) NOT VALID,
  ADD CONSTRAINT invoice_line_items_unit_price_nonnegative CHECK (unit_price >= 0) NOT VALID,
  ADD CONSTRAINT invoice_line_items_line_total_nonnegative CHECK (line_total >= 0) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice ON public.invoice_line_items(invoice_id);

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
  IF j.status <> 'completed' THEN
    RAISE EXCEPTION 'Complete the Job Order before generating an invoice.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.job_order_line_items WHERE job_order_id = NEW.job_order_id) THEN
    RAISE EXCEPTION 'Invoices require job order line items.';
  END IF;
  NEW.customer_id := j.customer_id;
  NEW.invoice_amount := j.quoted_amount;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.snapshot_invoice_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  INSERT INTO public.invoice_line_items (
    invoice_id,
    job_order_line_item_id,
    description,
    pricing_mode,
    width,
    height,
    unit_of_measure,
    computed_sqft,
    rate_per_sqft,
    quantity,
    unit_price,
    line_total,
    sort_order
  )
  SELECT
    NEW.id,
    jl.id,
    jl.description,
    jl.pricing_mode,
    jl.width,
    jl.height,
    jl.unit_of_measure,
    jl.computed_sqft,
    jl.rate_per_sqft,
    jl.quantity,
    jl.unit_price,
    jl.line_total,
    jl.sort_order
  FROM public.job_order_line_items jl
  WHERE jl.job_order_id = NEW.job_order_id
  ORDER BY COALESCE(jl.sort_order, 0), jl.created_at;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_snapshot_invoice_lines ON public.invoices;
CREATE TRIGGER trg_snapshot_invoice_lines
  AFTER INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_invoice_lines();

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
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.payment_date IS DISTINCT FROM NEW.payment_date OR OLD.payment_remarks IS DISTINCT FROM NEW.payment_remarks)
  EXECUTE FUNCTION public.validate_invoice_payment_update();
