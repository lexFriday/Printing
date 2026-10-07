
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

