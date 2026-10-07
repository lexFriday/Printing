BEGIN;

DO $$
DECLARE
  v_customer_id UUID;
  v_quote_id UUID;
  v_job_id UUID;
  v_invoice RECORD;
  v_payment_blocked BOOLEAN := false;
BEGIN
  INSERT INTO public.customers (customer_name, contact_person, contact_number)
  VALUES ('Goal 6 EWT Customer', 'QA', '000')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.quotations (customer_id, project_name, tax_type, status)
  VALUES (v_customer_id, 'Goal 6 Reference EWT', 'vatable', 'draft')
  RETURNING id INTO v_quote_id;

  INSERT INTO public.quote_line_items (
    quotation_id,
    description,
    pricing_mode,
    quantity,
    unit_price,
    line_total
  )
  VALUES (v_quote_id, 'VATable item', 'fixed', 1, 1120, 1120);

  UPDATE public.quotations SET status = 'sent', sent_at = now() WHERE id = v_quote_id;
  UPDATE public.quotations SET status = 'approved', approved_at = now() WHERE id = v_quote_id;

  INSERT INTO public.job_orders (
    quotation_id,
    customer_id,
    project_name,
    quoted_amount,
    status,
    tax_type
  )
  VALUES (v_quote_id, v_customer_id, 'Goal 6 Reference EWT', 1120, 'pending', 'vatable')
  RETURNING id INTO v_job_id;

  UPDATE public.job_orders SET status = 'in_production' WHERE id = v_job_id;
  UPDATE public.job_orders SET status = 'ready' WHERE id = v_job_id;
  UPDATE public.job_orders SET status = 'delivered' WHERE id = v_job_id;
  UPDATE public.job_orders SET status = 'completed' WHERE id = v_job_id;

  INSERT INTO public.invoices (
    job_order_id,
    customer_id,
    invoice_amount,
    tax_type,
    ewt_enabled,
    ewt_rate
  )
  VALUES (v_job_id, v_customer_id, 1120, 'vatable', true, 0.02)
  RETURNING * INTO v_invoice;

  IF v_invoice.vatable_sales_snapshot <> 1000
    OR v_invoice.vat_amount_snapshot <> 120
    OR v_invoice.ewt_amount_snapshot <> 20
    OR v_invoice.gross_total_snapshot <> 1120
    OR v_invoice.amount_due_snapshot <> 1120
    OR v_invoice.ewt_treatment_snapshot <> 'reference_only'
  THEN
    RAISE EXCEPTION 'Reference-only EWT snapshot failed: %', row_to_json(v_invoice);
  END IF;

  INSERT INTO public.quotations (customer_id, project_name, tax_type, status)
  VALUES (v_customer_id, 'Goal 6 Deducted EWT', 'vatable', 'draft')
  RETURNING id INTO v_quote_id;

  INSERT INTO public.quote_line_items (
    quotation_id,
    description,
    pricing_mode,
    quantity,
    unit_price,
    line_total
  )
  VALUES (v_quote_id, 'Deducted VATable item', 'fixed', 1, 1120, 1120);

  UPDATE public.quotations SET status = 'sent', sent_at = now() WHERE id = v_quote_id;
  UPDATE public.quotations SET status = 'approved', approved_at = now() WHERE id = v_quote_id;

  INSERT INTO public.job_orders (
    quotation_id,
    customer_id,
    project_name,
    quoted_amount,
    status,
    tax_type
  )
  VALUES (v_quote_id, v_customer_id, 'Goal 6 Deducted EWT', 1120, 'pending', 'vatable')
  RETURNING id INTO v_job_id;

  UPDATE public.job_orders SET status = 'in_production' WHERE id = v_job_id;
  UPDATE public.job_orders SET status = 'ready' WHERE id = v_job_id;
  UPDATE public.job_orders SET status = 'delivered' WHERE id = v_job_id;
  UPDATE public.job_orders SET status = 'completed' WHERE id = v_job_id;

  INSERT INTO public.invoices (
    job_order_id,
    customer_id,
    invoice_amount,
    tax_type,
    ewt_enabled,
    ewt_rate,
    ewt_treatment_snapshot
  )
  VALUES (v_job_id, v_customer_id, 1120, 'vatable', true, 0.02, 'deducted_from_amount_due')
  RETURNING * INTO v_invoice;

  IF v_invoice.amount_due_snapshot <> 1100
    OR v_invoice.ewt_amount_snapshot <> 20
    OR v_invoice.ewt_treatment_snapshot <> 'deducted_from_amount_due'
  THEN
    RAISE EXCEPTION 'Deducted EWT snapshot failed: %', row_to_json(v_invoice);
  END IF;

  INSERT INTO public.invoice_payments (invoice_id, payment_date, amount)
  VALUES (v_invoice.id, CURRENT_DATE, 1100);

  BEGIN
    INSERT INTO public.invoice_payments (invoice_id, payment_date, amount)
    VALUES (v_invoice.id, CURRENT_DATE, 1);
  EXCEPTION WHEN others THEN
    v_payment_blocked := true;
  END;

  IF NOT v_payment_blocked THEN
    RAISE EXCEPTION 'Payment validation did not use amount_due_snapshot.';
  END IF;

  INSERT INTO public.quotations (customer_id, project_name, tax_type, status)
  VALUES (v_customer_id, 'Goal 6 Non VAT', 'non_vat', 'draft')
  RETURNING id INTO v_quote_id;

  INSERT INTO public.quote_line_items (
    quotation_id,
    description,
    pricing_mode,
    quantity,
    unit_price,
    line_total
  )
  VALUES (v_quote_id, 'Non-VAT item', 'fixed', 1, 500, 500);

  UPDATE public.quotations SET status = 'sent', sent_at = now() WHERE id = v_quote_id;
  UPDATE public.quotations SET status = 'approved', approved_at = now() WHERE id = v_quote_id;

  INSERT INTO public.job_orders (
    quotation_id,
    customer_id,
    project_name,
    quoted_amount,
    status,
    tax_type
  )
  VALUES (v_quote_id, v_customer_id, 'Goal 6 Non VAT', 500, 'pending', 'non_vat')
  RETURNING id INTO v_job_id;

  UPDATE public.job_orders SET status = 'in_production' WHERE id = v_job_id;
  UPDATE public.job_orders SET status = 'ready' WHERE id = v_job_id;
  UPDATE public.job_orders SET status = 'delivered' WHERE id = v_job_id;
  UPDATE public.job_orders SET status = 'completed' WHERE id = v_job_id;

  INSERT INTO public.invoices (
    job_order_id,
    customer_id,
    invoice_amount,
    tax_type,
    ewt_enabled
  )
  VALUES (v_job_id, v_customer_id, 500, 'non_vat', true)
  RETURNING * INTO v_invoice;

  IF v_invoice.ewt_enabled IS DISTINCT FROM false
    OR v_invoice.vat_amount_snapshot <> 0
    OR v_invoice.ewt_amount_snapshot <> 0
    OR v_invoice.amount_due_snapshot <> 500
  THEN
    RAISE EXCEPTION 'Non-VAT snapshot failed: %', row_to_json(v_invoice);
  END IF;
END $$;

ROLLBACK;
