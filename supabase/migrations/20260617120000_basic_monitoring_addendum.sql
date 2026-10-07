-- Basic monitoring addendum: production status, receivables, and payables.
-- Reports stay derived from operational records; no ledger/accounting tables.

DROP VIEW IF EXISTS public.customer_active_job_summaries;
DROP VIEW IF EXISTS public.customer_operational_summaries;

DROP POLICY IF EXISTS "jo operations insert from approved quote" ON public.job_orders;
DROP POLICY IF EXISTS "jo operations update" ON public.job_orders;
DROP POLICY IF EXISTS "invoices operations insert from job" ON public.invoices;

ALTER TYPE public.job_status RENAME TO job_status_old;
CREATE TYPE public.job_status AS ENUM (
  'pending',
  'in_production',
  'ready',
  'delivered',
  'completed'
);

ALTER TABLE public.job_orders
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public.job_status
    USING CASE
      WHEN status::text = 'completed' THEN 'completed'::public.job_status
      ELSE 'pending'::public.job_status
    END,
  ALTER COLUMN status SET DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS production_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

DROP TYPE public.job_status_old;

CREATE OR REPLACE FUNCTION public.validate_job_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := COALESCE(NEW.status, 'pending');
    RETURN NEW;
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'pending' AND NEW.status = 'in_production') OR
    (OLD.status = 'in_production' AND NEW.status = 'ready') OR
    (OLD.status = 'ready' AND NEW.status = 'delivered') OR
    (OLD.status = 'delivered' AND NEW.status = 'completed')
  ) THEN
    RAISE EXCEPTION 'Invalid job status transition: % to %', OLD.status, NEW.status;
  END IF;

  IF NEW.status = 'in_production' THEN NEW.production_started_at := COALESCE(NEW.production_started_at, now()); END IF;
  IF NEW.status = 'ready' THEN NEW.ready_at := COALESCE(NEW.ready_at, now()); END IF;
  IF NEW.status = 'delivered' THEN NEW.delivered_at := COALESCE(NEW.delivered_at, now()); END IF;
  IF NEW.status = 'completed' THEN NEW.completed_at := COALESCE(NEW.completed_at, now()); END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_job_status_transition ON public.job_orders;
CREATE TRIGGER trg_validate_job_status_transition
  BEFORE INSERT OR UPDATE OF status ON public.job_orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_job_status_transition();

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

CREATE POLICY "jo operations update"
ON public.job_orders FOR UPDATE TO authenticated
USING (app_private.can_write_operations(auth.uid()))
WITH CHECK (app_private.can_write_operations(auth.uid()));

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

CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  remarks TEXT,
  created_by UUID REFERENCES auth.users,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.invoice_payments TO authenticated;
GRANT ALL ON public.invoice_payments TO service_role;
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoice payments active read" ON public.invoice_payments
  FOR SELECT TO authenticated USING (app_private.is_active_user(auth.uid()));
CREATE POLICY "invoice payments operations insert" ON public.invoice_payments
  FOR INSERT TO authenticated
  WITH CHECK (app_private.can_write_operations(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON public.invoice_payments(invoice_id);

INSERT INTO public.invoice_payments (invoice_id, payment_date, amount, remarks, created_at)
SELECT id, COALESCE(payment_date, paid_at::date, invoice_date), invoice_amount, payment_remarks, COALESCE(paid_at, updated_at, created_at)
FROM public.invoices i
WHERE i.status = 'paid'
  AND NOT EXISTS (SELECT 1 FROM public.invoice_payments p WHERE p.invoice_id = i.id);

CREATE OR REPLACE FUNCTION public.validate_invoice_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  invoice_total NUMERIC(14,2);
  paid_total NUMERIC(14,2);
BEGIN
  SELECT invoice_amount INTO invoice_total FROM public.invoices WHERE id = NEW.invoice_id;
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

DROP TRIGGER IF EXISTS trg_validate_invoice_payment ON public.invoice_payments;
CREATE TRIGGER trg_validate_invoice_payment
  BEFORE INSERT OR UPDATE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.validate_invoice_payment();

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
  SELECT invoice_amount INTO invoice_total FROM public.invoices WHERE id = target_invoice;
  SELECT COALESCE(SUM(amount), 0) INTO paid_total FROM public.invoice_payments WHERE invoice_id = target_invoice;

  UPDATE public.invoices
  SET
    status = CASE WHEN paid_total >= invoice_total THEN 'paid'::public.invoice_status ELSE 'issued'::public.invoice_status END,
    paid_at = CASE WHEN paid_total >= invoice_total THEN COALESCE(paid_at, now()) ELSE NULL END,
    payment_date = CASE WHEN paid_total >= invoice_total THEN (SELECT MAX(payment_date) FROM public.invoice_payments WHERE invoice_id = target_invoice) ELSE NULL END
  WHERE id = target_invoice;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_invoice_paid_status ON public.invoice_payments;
CREATE TRIGGER trg_sync_invoice_paid_status
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_invoice_paid_status();

CREATE TYPE public.expense_payment_status AS ENUM ('pending','paid');

ALTER TABLE public.job_expenses
  ADD COLUMN IF NOT EXISTS supplier_name TEXT,
  ADD COLUMN IF NOT EXISTS payment_status public.expense_payment_status NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reference_no TEXT,
  ADD COLUMN IF NOT EXISTS remarks TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.job_expenses
  ALTER COLUMN job_order_id DROP NOT NULL;

ALTER TABLE public.job_expenses
  DROP CONSTRAINT IF EXISTS job_expenses_job_order_id_fkey,
  ADD CONSTRAINT job_expenses_job_order_id_fkey
    FOREIGN KEY (job_order_id) REFERENCES public.job_orders(id) ON DELETE SET NULL;

UPDATE public.job_expenses
SET paid_at = COALESCE(paid_at, expense_date::timestamptz)
WHERE payment_status = 'paid';

DROP TRIGGER IF EXISTS trg_job_expenses_touch ON public.job_expenses;
CREATE TRIGGER trg_job_expenses_touch
  BEFORE UPDATE ON public.job_expenses
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.job_expenses
  ADD CONSTRAINT job_expenses_due_not_before_expense CHECK (due_date IS NULL OR due_date >= expense_date) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_job_expenses_payment_status ON public.job_expenses(payment_status);
CREATE INDEX IF NOT EXISTS idx_job_expenses_due_date ON public.job_expenses(due_date);

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
    SUM(GREATEST(i.invoice_amount - COALESCE(p.amount_paid, 0), 0)) AS outstanding_balance,
    SUM(i.invoice_amount) AS lifetime_revenue
  FROM public.invoices i
  LEFT JOIN (
    SELECT invoice_id, SUM(amount) AS amount_paid
    FROM public.invoice_payments
    GROUP BY invoice_id
  ) p ON p.invoice_id = i.id
  GROUP BY i.customer_id
) i ON i.customer_id = c.id;

GRANT SELECT ON public.customer_operational_summaries TO authenticated;

CREATE OR REPLACE VIEW public.customer_active_job_summaries
WITH (security_invoker = true) AS
SELECT
  j.id,
  j.customer_id,
  j.job_number,
  j.project_name,
  j.quoted_amount,
  j.status,
  COALESCE(e.expenses, 0)::numeric(14, 2) AS expenses,
  (j.quoted_amount - COALESCE(e.expenses, 0))::numeric(14, 2) AS profit,
  j.created_at
FROM public.job_orders j
LEFT JOIN (
  SELECT job_order_id, SUM(amount) AS expenses
  FROM public.job_expenses
  WHERE job_order_id IS NOT NULL
  GROUP BY job_order_id
) e ON e.job_order_id = j.id
WHERE j.status <> 'completed';

GRANT SELECT ON public.customer_active_job_summaries TO authenticated;
