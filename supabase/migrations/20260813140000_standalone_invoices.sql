BEGIN;

ALTER TABLE public.invoices
  ALTER COLUMN job_order_id DROP NOT NULL;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_job_order_id_key,
  DROP CONSTRAINT IF EXISTS invoices_job_order_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_job_order_id_unique
  ON public.invoices(job_order_id)
  WHERE job_order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_invoice_from_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE
  j public.job_orders%ROWTYPE;
  line_base NUMERIC(14,2);
  quote_base NUMERIC(14,2);
  standalone_base NUMERIC(14,2);
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
    standalone_base := COALESCE(NULLIF(quote_base, 0), line_base, j.quoted_amount);
  ELSE
    IF NEW.customer_id IS NULL THEN
      RAISE EXCEPTION 'Pick a customer before creating a standalone invoice.';
    END IF;
    IF NEW.invoice_amount IS NULL OR NEW.invoice_amount <= 0 THEN
      RAISE EXCEPTION 'Standalone invoices require an amount greater than zero.';
    END IF;
    NEW.tax_type := COALESCE(NEW.tax_type, 'non_vat'::public.tax_type);
    standalone_base := ROUND(NEW.invoice_amount, 2);
  END IF;

  IF NEW.tax_type = 'vatable' THEN
    vatable_sales := ROUND(standalone_base, 2);
    vat_amount := ROUND(vatable_sales * 0.12, 2);
    gross_total := ROUND(vatable_sales + vat_amount, 2);

    NEW.invoice_amount := gross_total;
    NEW.ewt_enabled := COALESCE(NEW.ewt_enabled, false);
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
      WHEN NEW.ewt_treatment_snapshot = 'deducted_from_amount_due'
        THEN ROUND(gross_total - ewt_amount, 2)
      ELSE gross_total
    END;
  ELSE
    NEW.invoice_amount := ROUND(standalone_base, 2);
    NEW.vat_rate_snapshot := 0;
    NEW.vatable_sales_snapshot := ROUND(NEW.invoice_amount, 2);
    NEW.vat_amount_snapshot := 0;
    ewt_amount := CASE
      WHEN COALESCE(NEW.ewt_enabled, false) THEN ROUND(standalone_base * NEW.ewt_rate, 2)
      ELSE 0
    END;
    NEW.ewt_enabled := COALESCE(NEW.ewt_enabled, false);
    NEW.ewt_amount_snapshot := ewt_amount;
    NEW.gross_total_snapshot := ROUND(NEW.invoice_amount, 2);
    NEW.amount_due_snapshot := CASE
      WHEN NEW.ewt_treatment_snapshot = 'deducted_from_amount_due'
        THEN ROUND(NEW.invoice_amount - ewt_amount, 2)
      ELSE ROUND(NEW.invoice_amount, 2)
    END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.snapshot_invoice_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  IF NEW.job_order_id IS NULL THEN
    RETURN NEW;
  END IF;

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

  IF OLD.job_order_id IS DISTINCT FROM NEW.job_order_id
    OR NEW.customer_id <> OLD.customer_id
    OR NEW.invoice_amount <> OLD.invoice_amount
    OR NEW.invoice_date <> OLD.invoice_date
    OR COALESCE(NEW.due_date, DATE '0001-01-01') <> COALESCE(OLD.due_date, DATE '0001-01-01')
    OR NEW.invoice_number <> OLD.invoice_number
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
END;
$$;

COMMIT;
