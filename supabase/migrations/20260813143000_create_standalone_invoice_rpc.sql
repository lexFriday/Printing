CREATE OR REPLACE FUNCTION public.create_standalone_invoice(invoice_data JSONB, lines JSONB)
RETURNS TABLE(id UUID, invoice_number TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  created_invoice public.invoices%ROWTYPE;
  line_item JSONB;
  line_count INTEGER;
BEGIN
  IF NOT public.can_write_operations(auth.uid()) THEN
    RAISE EXCEPTION 'You do not have permission to create invoices.';
  END IF;

  IF NULLIF(invoice_data->>'job_order_id', '') IS NOT NULL THEN
    RAISE EXCEPTION 'Use Generate invoice from the completed Job Order when linking an invoice to a job.';
  END IF;

  IF jsonb_typeof(lines) <> 'array' THEN
    RAISE EXCEPTION 'Invoice lines are required.';
  END IF;

  SELECT jsonb_array_length(lines) INTO line_count;
  IF line_count <= 0 THEN
    RAISE EXCEPTION 'Add at least one invoice line.';
  END IF;

  INSERT INTO public.invoices (
    job_order_id,
    customer_id,
    customer_contact_id,
    contact_name_snapshot,
    contact_department_snapshot,
    contact_phone_snapshot,
    contact_email_snapshot,
    invoice_date,
    due_date,
    invoice_amount,
    tax_type,
    ewt_enabled,
    ewt_rate,
    ewt_treatment_snapshot
  )
  VALUES (
    NULLIF(invoice_data->>'job_order_id', '')::UUID,
    (invoice_data->>'customer_id')::UUID,
    NULLIF(invoice_data->>'customer_contact_id', '')::UUID,
    NULLIF(invoice_data->>'contact_name_snapshot', ''),
    NULLIF(invoice_data->>'contact_department_snapshot', ''),
    NULLIF(invoice_data->>'contact_phone_snapshot', ''),
    NULLIF(invoice_data->>'contact_email_snapshot', ''),
    COALESCE(NULLIF(invoice_data->>'invoice_date', '')::DATE, CURRENT_DATE),
    NULLIF(invoice_data->>'due_date', '')::DATE,
    (invoice_data->>'invoice_amount')::NUMERIC,
    COALESCE(NULLIF(invoice_data->>'tax_type', ''), 'non_vat')::public.tax_type,
    COALESCE((invoice_data->>'ewt_enabled')::BOOLEAN, false),
    COALESCE((invoice_data->>'ewt_rate')::NUMERIC, 0.02),
    COALESCE(NULLIF(invoice_data->>'ewt_treatment_snapshot', ''), 'reference_only')
  )
  RETURNING * INTO created_invoice;

  FOR line_item IN SELECT * FROM jsonb_array_elements(lines)
  LOOP
    INSERT INTO public.invoice_line_items (
      invoice_id,
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
    VALUES (
      created_invoice.id,
      line_item->>'description',
      (line_item->>'pricing_mode')::public.pricing_mode,
      NULLIF(line_item->>'width', '')::NUMERIC,
      NULLIF(line_item->>'height', '')::NUMERIC,
      NULLIF(line_item->>'unit_of_measure', '')::public.unit_of_measure,
      NULLIF(line_item->>'computed_sqft', '')::NUMERIC,
      NULLIF(line_item->>'rate_per_sqft', '')::NUMERIC,
      (line_item->>'quantity')::NUMERIC,
      (line_item->>'unit_price')::NUMERIC,
      (line_item->>'line_total')::NUMERIC,
      COALESCE((line_item->>'sort_order')::INTEGER, 0)
    );
  END LOOP;

  RETURN QUERY SELECT created_invoice.id, created_invoice.invoice_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_standalone_invoice(JSONB, JSONB) TO authenticated;
