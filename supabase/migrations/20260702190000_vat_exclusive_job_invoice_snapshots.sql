-- Treat VATable quote/job line totals as VAT-exclusive amounts.
-- VAT is added on top, while EWT is computed from VATable sales.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.quotations'::regclass
      AND tgname = 'trg_validate_quote_update'
  ) THEN
    ALTER TABLE public.quotations DISABLE TRIGGER trg_validate_quote_update;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.job_orders'::regclass
      AND tgname = 'trg_validate_job_status_transition'
  ) THEN
    ALTER TABLE public.job_orders DISABLE TRIGGER trg_validate_job_status_transition;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.invoices'::regclass
      AND tgname = 'trg_validate_invoice_payment_update'
  ) THEN
    ALTER TABLE public.invoices DISABLE TRIGGER trg_validate_invoice_payment_update;
  END IF;
END $$;

WITH quote_bases AS (
  SELECT
    q.id,
    ROUND(COALESCE(SUM(qli.line_total), q.subtotal, 0) + COALESCE(q.adjustment_amount, 0), 2) AS base_total
  FROM public.quotations q
  LEFT JOIN public.quote_line_items qli ON qli.quotation_id = q.id
  WHERE q.tax_type = 'vatable'
  GROUP BY q.id, q.subtotal, q.adjustment_amount
)
UPDATE public.quotations q
SET
  subtotal = qb.base_total - COALESCE(q.adjustment_amount, 0),
  total_amount = ROUND(qb.base_total * 1.12, 2)
FROM quote_bases qb
WHERE q.id = qb.id
  AND q.total_amount IS DISTINCT FROM ROUND(qb.base_total * 1.12, 2);

WITH job_bases AS (
  SELECT
    jo.id,
    ROUND(
      COALESCE(
        q.subtotal + COALESCE(q.adjustment_amount, 0),
        SUM(joli.line_total),
        jo.quoted_amount
      ),
      2
    ) AS base_total
  FROM public.job_orders jo
  LEFT JOIN public.quotations q ON q.id = jo.quotation_id
  LEFT JOIN public.job_order_line_items joli ON joli.job_order_id = jo.id
  WHERE jo.tax_type = 'vatable'
  GROUP BY jo.id, jo.quoted_amount, q.subtotal, q.adjustment_amount
)
UPDATE public.job_orders jo
SET quoted_amount = ROUND(jb.base_total * 1.12, 2)
FROM job_bases jb
WHERE jo.id = jb.id
  AND jo.quoted_amount IS DISTINCT FROM ROUND(jb.base_total * 1.12, 2);

CREATE OR REPLACE FUNCTION public.validate_invoice_from_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE
  j public.job_orders%ROWTYPE;
  line_base NUMERIC(14,2);
  quote_base NUMERIC(14,2);
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

  SELECT ROUND(COALESCE(SUM(line_total), 0), 2)
  INTO line_base
  FROM public.job_order_line_items
  WHERE job_order_id = NEW.job_order_id;

  IF COALESCE(line_base, 0) <= 0 THEN
    RAISE EXCEPTION 'Invoices require job order line items.';
  END IF;

  SELECT ROUND(COALESCE(subtotal, 0) + COALESCE(adjustment_amount, 0), 2)
  INTO quote_base
  FROM public.quotations
  WHERE id = j.quotation_id;

  NEW.customer_id := j.customer_id;
  NEW.tax_type := COALESCE(j.tax_type, 'non_vat'::public.tax_type);
  NEW.ewt_treatment_snapshot := COALESCE(NEW.ewt_treatment_snapshot, 'reference_only');

  IF NEW.tax_type = 'vatable' THEN
    vatable_sales := COALESCE(NULLIF(quote_base, 0), line_base);
    vat_amount := ROUND(vatable_sales * 0.12, 2);
    gross_total := ROUND(vatable_sales + vat_amount, 2);

    NEW.invoice_amount := gross_total;
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
    NEW.invoice_amount := ROUND(j.quoted_amount, 2);
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

WITH invoice_bases AS (
  SELECT
    i.id,
    ROUND(
      COALESCE(
        q.subtotal + COALESCE(q.adjustment_amount, 0),
        SUM(joli.line_total),
        j.quoted_amount
      ),
      2
    ) AS base_total,
    COALESCE(i.ewt_enabled, false) AS ewt_enabled,
    COALESCE(i.ewt_rate, 0.02) AS ewt_rate,
    COALESCE(i.ewt_treatment_snapshot, 'reference_only') AS ewt_treatment
  FROM public.invoices i
  JOIN public.job_orders j ON j.id = i.job_order_id
  LEFT JOIN public.quotations q ON q.id = j.quotation_id
  LEFT JOIN public.job_order_line_items joli ON joli.job_order_id = j.id
  WHERE COALESCE(i.tax_type, j.tax_type) = 'vatable'
  GROUP BY i.id, i.ewt_enabled, i.ewt_rate, i.ewt_treatment_snapshot, j.quoted_amount, q.subtotal, q.adjustment_amount
)
UPDATE public.invoices i
SET
  invoice_amount = ROUND(ib.base_total * 1.12, 2),
  tax_type = 'vatable',
  vat_rate_snapshot = 0.12,
  vatable_sales_snapshot = ib.base_total,
  vat_amount_snapshot = ROUND(ib.base_total * 0.12, 2),
  ewt_rate = ib.ewt_rate,
  ewt_amount_snapshot = CASE
    WHEN ib.ewt_enabled THEN ROUND(ib.base_total * ib.ewt_rate, 2)
    ELSE 0
  END,
  gross_total_snapshot = ROUND(ib.base_total * 1.12, 2),
  ewt_treatment_snapshot = ib.ewt_treatment,
  amount_due_snapshot = CASE
    WHEN ib.ewt_enabled AND ib.ewt_treatment = 'deducted_from_amount_due'
      THEN ROUND(ROUND(ib.base_total * 1.12, 2) - ROUND(ib.base_total * ib.ewt_rate, 2), 2)
    ELSE ROUND(ib.base_total * 1.12, 2)
  END
FROM invoice_bases ib
WHERE i.id = ib.id;

WITH paid_totals AS (
  SELECT invoice_id, COALESCE(SUM(amount), 0) AS paid_total
  FROM public.invoice_payments
  GROUP BY invoice_id
)
UPDATE public.invoices i
SET
  status = CASE
    WHEN COALESCE(pt.paid_total, 0) >= COALESCE(i.amount_due_snapshot, i.invoice_amount)
      THEN 'paid'::public.invoice_status
    ELSE 'issued'::public.invoice_status
  END,
  paid_at = CASE
    WHEN COALESCE(pt.paid_total, 0) >= COALESCE(i.amount_due_snapshot, i.invoice_amount)
      THEN COALESCE(i.paid_at, now())
    ELSE NULL
  END,
  payment_date = CASE
    WHEN COALESCE(pt.paid_total, 0) >= COALESCE(i.amount_due_snapshot, i.invoice_amount)
      THEN (
        SELECT MAX(ip.payment_date)
        FROM public.invoice_payments ip
        WHERE ip.invoice_id = i.id
      )
    ELSE NULL
  END
FROM paid_totals pt
WHERE i.id = pt.invoice_id
  AND i.tax_type = 'vatable';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.quotations'::regclass
      AND tgname = 'trg_validate_quote_update'
  ) THEN
    ALTER TABLE public.quotations ENABLE TRIGGER trg_validate_quote_update;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.job_orders'::regclass
      AND tgname = 'trg_validate_job_status_transition'
  ) THEN
    ALTER TABLE public.job_orders ENABLE TRIGGER trg_validate_job_status_transition;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.invoices'::regclass
      AND tgname = 'trg_validate_invoice_payment_update'
  ) THEN
    ALTER TABLE public.invoices ENABLE TRIGGER trg_validate_invoice_payment_update;
  END IF;
END $$;

COMMIT;
