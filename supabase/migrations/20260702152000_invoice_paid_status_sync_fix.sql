CREATE OR REPLACE FUNCTION public.validate_invoice_payment_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
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

  IF NEW.status NOT IN ('issued'::public.invoice_status, 'paid'::public.invoice_status) THEN
    RAISE EXCEPTION 'Invoice payment status can only be issued or paid.';
  END IF;

  IF NEW.status = 'paid'::public.invoice_status THEN
    IF NEW.payment_date IS NULL THEN
      RAISE EXCEPTION 'Payment date is required.';
    END IF;

    IF NEW.payment_date > CURRENT_DATE THEN
      RAISE EXCEPTION 'Future payment dates are not allowed.';
    END IF;

    IF NEW.paid_at IS NULL THEN
      NEW.paid_at := now();
    END IF;
  ELSE
    NEW.paid_at := NULL;
    NEW.payment_date := NULL;
  END IF;

  RETURN NEW;
END; $$;
