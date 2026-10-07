-- An approved quotation is the shared source of truth between its invoice and
-- Job Order. Link an invoice created first when the Job Order is created, and
-- repair existing quote-linked records that predate this invariant.

CREATE OR REPLACE FUNCTION public.validate_invoice_payment_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  -- A quote-created invoice legitimately gains its Job Order after conversion.
  -- Permit only that one-time relationship link; commercial and payment data
  -- must remain byte-for-byte unchanged, and both records must share the quote.
  IF OLD.job_order_id IS NULL
    AND NEW.job_order_id IS NOT NULL
    AND OLD.quotation_id IS NOT NULL
    AND OLD.quotation_id IS NOT DISTINCT FROM NEW.quotation_id
    AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
    AND NEW.invoice_amount IS NOT DISTINCT FROM OLD.invoice_amount
    AND NEW.invoice_date IS NOT DISTINCT FROM OLD.invoice_date
    AND NEW.due_date IS NOT DISTINCT FROM OLD.due_date
    AND NEW.invoice_number IS NOT DISTINCT FROM OLD.invoice_number
    AND NEW.amount_due_snapshot IS NOT DISTINCT FROM OLD.amount_due_snapshot
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.payment_date IS NOT DISTINCT FROM OLD.payment_date
    AND NEW.paid_at IS NOT DISTINCT FROM OLD.paid_at
    AND EXISTS (
      SELECT 1 FROM public.job_orders AS job
      WHERE job.id = NEW.job_order_id
        AND job.quotation_id = OLD.quotation_id
    )
  THEN
    RETURN NEW;
  END IF;

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

UPDATE public.invoices AS invoice
SET job_order_id = job.id
FROM public.job_orders AS job
WHERE invoice.quotation_id = job.quotation_id
  AND invoice.quotation_id IS NOT NULL
  AND invoice.job_order_id IS NULL;

CREATE OR REPLACE FUNCTION public.create_job_order_from_approved_quote(
  p_quotation_id UUID,
  p_target_completion_date DATE,
  p_approved_by_user_id UUID,
  p_client_po_number TEXT DEFAULT NULL,
  p_dr_number TEXT DEFAULT NULL,
  p_installation_date DATE DEFAULT NULL,
  p_internal_notes TEXT DEFAULT NULL
)
RETURNS TABLE(id UUID, job_number TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
DECLARE
  v_quote public.quotations%ROWTYPE;
  v_job public.job_orders%ROWTYPE;
  v_approver_name TEXT;
BEGIN
  IF NOT app_private.can_write_operations(auth.uid()) THEN
    RAISE EXCEPTION 'You do not have permission to create Job Orders.';
  END IF;
  IF p_target_completion_date IS NULL THEN RAISE EXCEPTION 'Date Requested is required.'; END IF;

  SELECT * INTO v_quote FROM public.quotations
  WHERE quotations.id = p_quotation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quotation not found.'; END IF;
  IF v_quote.status::TEXT <> 'approved' THEN
    RAISE EXCEPTION 'Only approved quotations can create a Job Order.';
  END IF;

  SELECT COALESCE(NULLIF(trim(display_name), ''), email)
  INTO v_approver_name FROM public.profiles
  WHERE profiles.id = p_approved_by_user_id AND profiles.status = 'active';
  IF v_approver_name IS NULL THEN RAISE EXCEPTION 'Approver must be an active user.'; END IF;

  SELECT job.* INTO v_job FROM public.job_orders AS job
  WHERE job.quotation_id = p_quotation_id;

  IF NOT FOUND THEN
    INSERT INTO public.job_orders (
      quotation_id, customer_id, customer_contact_id,
      contact_name_snapshot, contact_department_snapshot, contact_phone_snapshot,
      contact_email_snapshot, project_name, quoted_amount, tax_type, status,
      target_completion_date, client_po_number, project_manager,
      approved_by_name, approved_by_user_id, prepared_by_user_id,
      dr_number, installation_date, internal_notes
    ) VALUES (
      v_quote.id, v_quote.customer_id, v_quote.customer_contact_id,
      v_quote.contact_name_snapshot, v_quote.contact_department_snapshot,
      v_quote.contact_phone_snapshot, v_quote.contact_email_snapshot,
      v_quote.project_name, v_quote.total_amount, v_quote.tax_type, 'pending',
      p_target_completion_date, NULLIF(trim(p_client_po_number), ''), NULL,
      v_approver_name, p_approved_by_user_id, v_quote.sales_agent_user_id,
      NULLIF(trim(p_dr_number), ''), p_installation_date,
      NULLIF(trim(p_internal_notes), '')
    ) RETURNING * INTO v_job;

    INSERT INTO public.production_jobs (job_order_id, job_type, responsible_user_id, status)
    VALUES (v_job.id, 'general', NULL, 'preparing');
  END IF;

  UPDATE public.invoices
  SET job_order_id = v_job.id
  WHERE quotation_id = p_quotation_id
    AND job_order_id IS NULL;

  RETURN QUERY SELECT v_job.id, v_job.job_number;
END;
$$;

REVOKE ALL ON FUNCTION public.create_job_order_from_approved_quote(UUID,DATE,UUID,TEXT,TEXT,DATE,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_job_order_from_approved_quote(UUID,DATE,UUID,TEXT,TEXT,DATE,TEXT) TO authenticated;
