-- Finance workflow foundation for operational disbursements, voucher history,
-- and manual OR-based cash sales. Reports and exports derive from these rows.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'disbursement_category') THEN
    CREATE TYPE public.disbursement_category AS ENUM (
      'direct_materials',
      'petty_cash',
      'communication',
      'representation',
      'commission',
      'utilities',
      'salary_and_wages',
      'security_expenses',
      'efps',
      'egov',
      'other'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'disbursement_subcategory') THEN
    CREATE TYPE public.disbursement_subcategory AS ENUM (
      'direct_materials',
      'transportation',
      'gas',
      'meals',
      'load',
      'garbage_collection',
      'extra_salary',
      'parking',
      'globe',
      'smart',
      'meralco',
      'manila_water',
      'apeiros',
      '1601c',
      '2550q',
      'sss',
      'phic',
      'hdmf',
      'other'
    );
  END IF;
END $$;

ALTER TABLE public.job_expenses
  ADD COLUMN IF NOT EXISTS disbursement_category public.disbursement_category,
  ADD COLUMN IF NOT EXISTS disbursement_subcategory public.disbursement_subcategory,
  ADD COLUMN IF NOT EXISTS supplier_tin text,
  ADD COLUMN IF NOT EXISTS supplier_address text,
  ADD COLUMN IF NOT EXISTS tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS check_date date,
  ADD COLUMN IF NOT EXISTS voucher_printed_at timestamptz,
  ADD COLUMN IF NOT EXISTS voucher_print_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.job_expenses
  DROP CONSTRAINT IF EXISTS job_expenses_tax_amount_nonnegative,
  ADD CONSTRAINT job_expenses_tax_amount_nonnegative CHECK (tax_amount >= 0),
  DROP CONSTRAINT IF EXISTS job_expenses_voucher_print_count_nonnegative,
  ADD CONSTRAINT job_expenses_voucher_print_count_nonnegative CHECK (voucher_print_count >= 0);

CREATE INDEX IF NOT EXISTS idx_job_expenses_disbursement_category
  ON public.job_expenses(disbursement_category);

CREATE INDEX IF NOT EXISTS idx_job_expenses_check_date
  ON public.job_expenses(check_date);

CREATE TABLE IF NOT EXISTS public.check_voucher_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_expense_id uuid NOT NULL REFERENCES public.job_expenses(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES auth.users,
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  previous_values jsonb NOT NULL,
  new_values jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_check_voucher_revisions_expense
  ON public.check_voucher_revisions(job_expense_id, changed_at DESC);

ALTER TABLE public.check_voucher_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "check voucher revisions accounting read" ON public.check_voucher_revisions;
DROP POLICY IF EXISTS "check voucher revisions accounting insert" ON public.check_voucher_revisions;

CREATE POLICY "check voucher revisions accounting read"
  ON public.check_voucher_revisions
  FOR SELECT TO authenticated
  USING (app_private.can_view_sensitive_operations(auth.uid()));

CREATE POLICY "check voucher revisions accounting insert"
  ON public.check_voucher_revisions
  FOR INSERT TO authenticated
  WITH CHECK (app_private.can_accounting_work(auth.uid()));

GRANT SELECT, INSERT ON public.check_voucher_revisions TO authenticated;
GRANT ALL ON public.check_voucher_revisions TO service_role;

CREATE TABLE IF NOT EXISTS public.cash_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  or_number text NOT NULL,
  collection_date date NOT NULL DEFAULT CURRENT_DATE,
  customer_name text,
  invoice_reference text,
  description text NOT NULL,
  gross_amount numeric(14,2) NOT NULL CHECK (gross_amount > 0),
  vat_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  created_by uuid REFERENCES auth.users,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_sales_or_number_key
  ON public.cash_sales(or_number);

CREATE INDEX IF NOT EXISTS idx_cash_sales_collection_date
  ON public.cash_sales(collection_date DESC);

DROP TRIGGER IF EXISTS trg_cash_sales_touch ON public.cash_sales;
CREATE TRIGGER trg_cash_sales_touch
  BEFORE UPDATE ON public.cash_sales
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.cash_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cash sales accounting read" ON public.cash_sales;
DROP POLICY IF EXISTS "cash sales accounting insert" ON public.cash_sales;
DROP POLICY IF EXISTS "cash sales accounting update" ON public.cash_sales;
DROP POLICY IF EXISTS "cash sales admin delete" ON public.cash_sales;

CREATE POLICY "cash sales accounting read"
  ON public.cash_sales
  FOR SELECT TO authenticated
  USING (
    app_private.can_view_sensitive_operations(auth.uid())
    OR app_private.can_accounting_work(auth.uid())
  );

CREATE POLICY "cash sales accounting insert"
  ON public.cash_sales
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.can_accounting_work(auth.uid())
    AND gross_amount > 0
    AND vat_amount >= 0
  );

CREATE POLICY "cash sales accounting update"
  ON public.cash_sales
  FOR UPDATE TO authenticated
  USING (app_private.can_accounting_work(auth.uid()))
  WITH CHECK (
    app_private.can_accounting_work(auth.uid())
    AND gross_amount > 0
    AND vat_amount >= 0
  );

CREATE POLICY "cash sales admin delete"
  ON public.cash_sales
  FOR DELETE TO authenticated
  USING (app_private.can_manage_users(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_sales TO authenticated;
GRANT ALL ON public.cash_sales TO service_role;

COMMENT ON COLUMN public.job_expenses.disbursement_category IS
  'Client accounting category for cash disbursement export and review.';
COMMENT ON COLUMN public.job_expenses.disbursement_subcategory IS
  'Client accounting subcategory, used when the selected disbursement category has a known breakdown.';
COMMENT ON COLUMN public.job_expenses.supplier_tin IS
  'Supplier TIN captured for direct materials and taxable disbursements.';
COMMENT ON COLUMN public.job_expenses.supplier_address IS
  'Supplier address captured for direct materials and taxable disbursements.';
COMMENT ON COLUMN public.job_expenses.tax_amount IS
  'Tax amount from the supplier document; reports derive totals from operational rows.';
COMMENT ON COLUMN public.job_expenses.check_date IS
  'Date on the cheque attached to the check voucher.';
COMMENT ON COLUMN public.job_expenses.voucher_printed_at IS
  'First confirmed check voucher print timestamp.';
COMMENT ON COLUMN public.job_expenses.voucher_print_count IS
  'Number of confirmed check voucher prints/reprints.';
COMMENT ON TABLE public.check_voucher_revisions IS
  'Append-only history for voucher field corrections after a voucher has been printed.';
COMMENT ON TABLE public.cash_sales IS
  'Manual OR-based cash-sale collections entered by Finance.';
