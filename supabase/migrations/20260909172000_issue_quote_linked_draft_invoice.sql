CREATE OR REPLACE FUNCTION public.validate_invoice_payment_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  IF OLD.job_order_id IS DISTINCT FROM NEW.job_order_id
    OR OLD.quotation_id IS DISTINCT FROM NEW.quotation_id
    OR NEW.customer_id <> OLD.customer_id
    OR NEW.invoice_amount <> OLD.invoice_amount
    OR NEW.invoice_date <> OLD.invoice_date
    OR COALESCE(NEW.due_date, DATE '0001-01-01') <> COALESCE(OLD.due_date, DATE '0001-01-01')
    OR NEW.invoice_number <> OLD.invoice_number
    OR NEW.amount_due_snapshot <> OLD.amount_due_snapshot
  THEN
    RAISE EXCEPTION 'Invoice source and amount are immutable.';
  END IF;

  IF OLD.status = 'draft'::public.invoice_status THEN
    IF NEW.status <> 'issued'::public.invoice_status THEN
      RAISE EXCEPTION 'Draft invoices must be issued before recording payment.';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'paid'::public.invoice_status THEN
    RAISE EXCEPTION 'This invoice has already been marked as paid.';
  END IF;
  IF NEW.status <> 'paid'::public.invoice_status THEN
    RAISE EXCEPTION 'Issued invoices can only be updated to record payment.';
  END IF;
  IF NEW.payment_date IS NULL THEN RAISE EXCEPTION 'Payment date is required.'; END IF;
  IF NEW.payment_date > CURRENT_DATE THEN RAISE EXCEPTION 'Future payment dates are not allowed.'; END IF;
  NEW.paid_at := COALESCE(NEW.paid_at, now());
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_draft_invoice(p_invoice_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
BEGIN
  IF NOT app_private.can_write_operations(auth.uid()) THEN
    RAISE EXCEPTION 'You do not have permission to issue invoices.';
  END IF;

  UPDATE public.invoices
  SET status = 'issued'::public.invoice_status
  WHERE id = p_invoice_id AND status = 'draft'::public.invoice_status
  RETURNING * INTO v_invoice;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Only a draft invoice can be issued.';
  END IF;

  INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, new_values)
  VALUES (auth.uid(), 'invoice.issued', 'invoice', v_invoice.id, jsonb_build_object('quotation_id', v_invoice.quotation_id));
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_draft_invoice(UUID) TO authenticated;

