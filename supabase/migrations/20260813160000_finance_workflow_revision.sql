BEGIN;

-- A job order may be billed through multiple customer invoices.
DROP INDEX IF EXISTS public.invoices_job_order_id_unique;
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_job_order_id_key,
  DROP CONSTRAINT IF EXISTS invoices_job_order_id_unique;

-- EWT is only valid on VATable customer invoices.
CREATE OR REPLACE FUNCTION public.validate_invoice_from_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE
  j public.job_orders%ROWTYPE;
  line_base NUMERIC(14,2);
  quote_base NUMERIC(14,2);
  invoice_base NUMERIC(14,2);
  vatable_sales NUMERIC(14,2);
  vat_amount NUMERIC(14,2);
  ewt_amount NUMERIC(14,2);
  gross_total NUMERIC(14,2);
BEGIN
  NEW.ewt_rate := COALESCE(NEW.ewt_rate, 0.02);
  NEW.ewt_treatment_snapshot := COALESCE(NEW.ewt_treatment_snapshot, 'reference_only');

  IF NEW.job_order_id IS NOT NULL THEN
    SELECT * INTO j FROM public.job_orders WHERE id = NEW.job_order_id;
    IF j.id IS NULL THEN
      RAISE EXCEPTION 'Invoices must reference an existing job order.';
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
    invoice_base := COALESCE(NULLIF(NEW.invoice_amount, 0), NULLIF(quote_base, 0), line_base, j.quoted_amount);
  ELSE
    IF NEW.customer_id IS NULL THEN
      RAISE EXCEPTION 'Pick a customer before creating an invoice.';
    END IF;
    IF NEW.invoice_amount IS NULL OR NEW.invoice_amount <= 0 THEN
      RAISE EXCEPTION 'Invoices require an amount greater than zero.';
    END IF;
    NEW.tax_type := COALESCE(NEW.tax_type, 'non_vat'::public.tax_type);
    invoice_base := ROUND(NEW.invoice_amount, 2);
  END IF;

  IF NEW.tax_type = 'vatable' THEN
    vatable_sales := ROUND(invoice_base, 2);
    vat_amount := ROUND(vatable_sales * 0.12, 2);
    gross_total := ROUND(vatable_sales + vat_amount, 2);
    NEW.invoice_amount := gross_total;
    NEW.ewt_enabled := COALESCE(NEW.ewt_enabled, false);
    ewt_amount := CASE WHEN NEW.ewt_enabled THEN ROUND(vatable_sales * NEW.ewt_rate, 2) ELSE 0 END;
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
    NEW.invoice_amount := ROUND(invoice_base, 2);
    NEW.ewt_enabled := false;
    NEW.vat_rate_snapshot := 0;
    NEW.vatable_sales_snapshot := ROUND(NEW.invoice_amount, 2);
    NEW.vat_amount_snapshot := 0;
    NEW.ewt_amount_snapshot := 0;
    NEW.gross_total_snapshot := ROUND(NEW.invoice_amount, 2);
    NEW.amount_due_snapshot := ROUND(NEW.invoice_amount, 2);
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'disbursement_payment_method') THEN
    CREATE TYPE public.disbursement_payment_method AS ENUM ('check', 'bank_transfer', 'gcash', 'petty_cash');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'disbursement_payment_state') THEN
    CREATE TYPE public.disbursement_payment_state AS ENUM ('pending', 'scheduled', 'released', 'cleared', 'held', 'cancelled');
  END IF;
END $$;

ALTER TABLE public.job_expenses
  ADD COLUMN IF NOT EXISTS payment_method public.disbursement_payment_method,
  ADD COLUMN IF NOT EXISTS payment_state public.disbursement_payment_state,
  ADD COLUMN IF NOT EXISTS payment_source text,
  ADD COLUMN IF NOT EXISTS payment_source_reference text,
  ADD COLUMN IF NOT EXISTS payment_proof_storage_path text,
  ADD COLUMN IF NOT EXISTS payment_proof_file_name text,
  ADD COLUMN IF NOT EXISTS payment_proof_file_type text,
  ADD COLUMN IF NOT EXISTS payment_proof_file_size bigint,
  ADD COLUMN IF NOT EXISTS payment_released_at timestamptz;

UPDATE public.job_expenses
SET payment_state = CASE WHEN payment_status::text = 'paid' THEN 'cleared'::public.disbursement_payment_state ELSE 'pending'::public.disbursement_payment_state END
WHERE payment_state IS NULL;

ALTER TABLE public.job_expenses
  ALTER COLUMN payment_state SET DEFAULT 'pending'::public.disbursement_payment_state,
  ALTER COLUMN payment_state SET NOT NULL,
  DROP CONSTRAINT IF EXISTS job_expenses_payment_proof_file_type_check,
  ADD CONSTRAINT job_expenses_payment_proof_file_type_check CHECK (payment_proof_file_type IS NULL OR payment_proof_file_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  DROP CONSTRAINT IF EXISTS job_expenses_payment_proof_file_size_check,
  ADD CONSTRAINT job_expenses_payment_proof_file_size_check CHECK (payment_proof_file_size IS NULL OR (payment_proof_file_size > 0 AND payment_proof_file_size <= 10485760));

CREATE INDEX IF NOT EXISTS idx_job_expenses_payment_state ON public.job_expenses(payment_state);
CREATE INDEX IF NOT EXISTS idx_job_expenses_payment_method ON public.job_expenses(payment_method);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('disbursement-payment-proofs', 'disbursement-payment-proofs', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

DROP POLICY IF EXISTS "disbursement payment proof read" ON storage.objects;
DROP POLICY IF EXISTS "disbursement payment proof upload" ON storage.objects;
DROP POLICY IF EXISTS "disbursement payment proof delete" ON storage.objects;
CREATE POLICY "disbursement payment proof read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'disbursement-payment-proofs' AND app_private.can_view_sensitive_operations(auth.uid()));
CREATE POLICY "disbursement payment proof upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'disbursement-payment-proofs' AND app_private.can_write_operations(auth.uid()));
CREATE POLICY "disbursement payment proof delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'disbursement-payment-proofs' AND app_private.can_write_operations(auth.uid()));

COMMENT ON COLUMN public.job_expenses.payment_source IS 'Bank, cash account, or wallet source used for the disbursement.';
COMMENT ON COLUMN public.job_expenses.payment_source_reference IS 'Human-readable source account or transaction reference.';
COMMENT ON COLUMN public.job_expenses.payment_state IS 'Manual payment state; check dates never clear a payment automatically.';

COMMIT;
