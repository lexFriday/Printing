-- Backfill existing VATable records after switching quotations to VAT-exclusive totals.
--
-- Preview before running in Lovable SQL editor if desired:
-- SELECT quote_number, subtotal, adjustment_amount, total_amount AS old_total,
--        ROUND((subtotal + adjustment_amount) * 1.12, 2) AS corrected_total
-- FROM public.quotations
-- WHERE tax_type = 'vatable'
--   AND total_amount IS DISTINCT FROM ROUND((subtotal + adjustment_amount) * 1.12, 2);

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

WITH corrected_quotes AS (
  SELECT
    id,
    ROUND((COALESCE(subtotal, 0) + COALESCE(adjustment_amount, 0)) * 1.12, 2) AS corrected_total
  FROM public.quotations
  WHERE tax_type = 'vatable'
)
UPDATE public.quotations q
SET total_amount = cq.corrected_total
FROM corrected_quotes cq
WHERE q.id = cq.id
  AND q.total_amount IS DISTINCT FROM cq.corrected_total;

WITH corrected_jobs AS (
  SELECT
    jo.id,
    q.total_amount AS corrected_total
  FROM public.job_orders jo
  JOIN public.quotations q ON q.id = jo.quotation_id
  WHERE q.tax_type = 'vatable'
)
UPDATE public.job_orders jo
SET quoted_amount = cj.corrected_total
FROM corrected_jobs cj
WHERE jo.id = cj.id
  AND jo.quoted_amount IS DISTINCT FROM cj.corrected_total;

WITH corrected_invoices AS (
  SELECT
    i.id,
    ROUND(j.quoted_amount, 2) AS gross_total,
    ROUND(j.quoted_amount / 1.12, 2) AS vatable_sales,
    ROUND(j.quoted_amount - ROUND(j.quoted_amount / 1.12, 2), 2) AS vat_amount,
    COALESCE(i.ewt_enabled, false) AS ewt_enabled,
    COALESCE(i.ewt_rate, 0.02) AS ewt_rate,
    COALESCE(i.ewt_treatment_snapshot, 'reference_only') AS ewt_treatment
  FROM public.invoices i
  JOIN public.job_orders j ON j.id = i.job_order_id
  WHERE COALESCE(i.tax_type, j.tax_type) = 'vatable'
)
UPDATE public.invoices i
SET
  invoice_amount = ci.gross_total,
  tax_type = 'vatable',
  vat_rate_snapshot = 0.12,
  vatable_sales_snapshot = ci.vatable_sales,
  vat_amount_snapshot = ci.vat_amount,
  ewt_rate = ci.ewt_rate,
  ewt_amount_snapshot = CASE
    WHEN ci.ewt_enabled THEN ROUND(ci.vatable_sales * ci.ewt_rate, 2)
    ELSE 0
  END,
  gross_total_snapshot = ci.gross_total,
  ewt_treatment_snapshot = ci.ewt_treatment,
  amount_due_snapshot = CASE
    WHEN ci.ewt_enabled AND ci.ewt_treatment = 'deducted_from_amount_due'
      THEN ROUND(ci.gross_total - ROUND(ci.vatable_sales * ci.ewt_rate, 2), 2)
    ELSE ci.gross_total
  END
FROM corrected_invoices ci
WHERE i.id = ci.id;

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

UPDATE public.invoices i
SET
  status = 'issued'::public.invoice_status,
  paid_at = NULL,
  payment_date = NULL
WHERE i.tax_type = 'vatable'
  AND NOT EXISTS (
    SELECT 1
    FROM public.invoice_payments ip
    WHERE ip.invoice_id = i.id
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.invoices'::regclass
      AND tgname = 'trg_validate_invoice_payment_update'
  ) THEN
    ALTER TABLE public.invoices ENABLE TRIGGER trg_validate_invoice_payment_update;
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
    WHERE tgrelid = 'public.quotations'::regclass
      AND tgname = 'trg_validate_quote_update'
  ) THEN
    ALTER TABLE public.quotations ENABLE TRIGGER trg_validate_quote_update;
  END IF;
END $$;

COMMIT;
