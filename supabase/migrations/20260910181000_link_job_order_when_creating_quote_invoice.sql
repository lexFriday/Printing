-- Preserve the quotation as SSOT regardless of whether Accounting creates the
-- invoice before or after Operations converts the quotation to a Job Order.

CREATE OR REPLACE FUNCTION public.create_invoice_from_approved_quote(p_quotation_id UUID)
RETURNS TABLE(id UUID, invoice_number TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private AS $$
DECLARE
  v_quote public.quotations%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_job_order_id UUID;
BEGIN
  IF NOT app_private.can_write_operations(auth.uid()) THEN
    RAISE EXCEPTION 'You do not have permission to create invoices.';
  END IF;

  SELECT * INTO v_quote FROM public.quotations
  WHERE quotations.id = p_quotation_id FOR UPDATE;
  IF v_quote.id IS NULL THEN RAISE EXCEPTION 'Quotation not found.'; END IF;
  IF v_quote.status::TEXT <> 'approved' THEN
    RAISE EXCEPTION 'Only approved quotations can create an invoice.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.quote_line_items WHERE quotation_id = p_quotation_id) THEN
    RAISE EXCEPTION 'The approved quotation has no billable items.';
  END IF;

  SELECT job.id INTO v_job_order_id
  FROM public.job_orders AS job
  WHERE job.quotation_id = p_quotation_id;

  INSERT INTO public.invoices (
    quotation_id, job_order_id, customer_id, customer_contact_id,
    contact_name_snapshot, contact_department_snapshot, contact_phone_snapshot,
    contact_email_snapshot, invoice_date, invoice_amount, status, tax_type,
    ewt_enabled, ewt_rate, ewt_treatment_snapshot
  ) VALUES (
    v_quote.id, NULL, v_quote.customer_id, v_quote.customer_contact_id,
    v_quote.contact_name_snapshot, v_quote.contact_department_snapshot,
    v_quote.contact_phone_snapshot, v_quote.contact_email_snapshot,
    CURRENT_DATE, v_quote.total_amount, 'draft'::public.invoice_status,
    COALESCE(v_quote.tax_type, 'non_vat'::public.tax_type),
    false, 0.02, 'reference_only'
  )
  ON CONFLICT (quotation_id) WHERE quotation_id IS NOT NULL DO NOTHING
  RETURNING * INTO v_invoice;

  IF v_invoice.id IS NULL THEN
    SELECT * INTO v_invoice FROM public.invoices WHERE quotation_id = p_quotation_id;
    IF v_invoice.job_order_id IS NULL AND v_job_order_id IS NOT NULL THEN
      UPDATE public.invoices SET job_order_id = v_job_order_id
      WHERE invoices.id = v_invoice.id
      RETURNING * INTO v_invoice;
    END IF;
    RETURN QUERY SELECT v_invoice.id, v_invoice.invoice_number;
    RETURN;
  END IF;

  -- The insert validator deliberately permits pre-production quotation invoices
  -- only without a Job Order. Attach the matching Job Order afterward through
  -- the guarded link-only update introduced by the preceding migration.
  IF v_job_order_id IS NOT NULL THEN
    UPDATE public.invoices SET job_order_id = v_job_order_id
    WHERE invoices.id = v_invoice.id
      AND job_order_id IS NULL
    RETURNING * INTO v_invoice;
  END IF;

  INSERT INTO public.invoice_line_items (
    invoice_id, description, pricing_mode, width, height, unit_of_measure,
    computed_sqft, rate_per_sqft, quantity, unit_price, line_total, sort_order
  )
  SELECT v_invoice.id, line.description, line.pricing_mode, line.width, line.height,
    line.unit_of_measure, line.computed_sqft, line.rate_per_sqft, line.quantity,
    line.unit_price, line.line_total, line.sort_order
  FROM public.quote_line_items AS line
  WHERE line.quotation_id = p_quotation_id
  ORDER BY COALESCE(line.sort_order, 0), line.created_at;

  INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, new_values)
  VALUES (auth.uid(), 'invoice.draft_created_from_quote', 'invoice', v_invoice.id,
    jsonb_build_object('quotation_id', v_quote.id, 'quote_number', v_quote.quote_number,
      'job_order_id', v_job_order_id));

  RETURN QUERY SELECT v_invoice.id, v_invoice.invoice_number;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_from_approved_quote(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_approved_quote(UUID) TO authenticated;
