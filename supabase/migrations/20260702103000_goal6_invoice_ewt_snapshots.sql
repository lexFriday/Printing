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
