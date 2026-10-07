BEGIN;

-- invoice_status only supports issued/paid. Keep already-billed allocation
-- checks inclusive of both valid invoice states instead of referencing a
-- non-existent legacy `void` value.
CREATE OR REPLACE FUNCTION public.create_job_invoice(
  invoice_data JSONB,
  lines JSONB
)
RETURNS TABLE(id UUID, invoice_number TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created_invoice public.invoices%ROWTYPE;
  requested JSONB;
  source_line public.job_order_line_items%ROWTYPE;
  requested_quantity NUMERIC(14,2);
  billed_quantity NUMERIC(14,2);
  line_count INTEGER;
  total_base NUMERIC(14,2) := 0;
BEGIN
  IF NOT public.can_write_operations(auth.uid()) THEN RAISE EXCEPTION 'You do not have permission to create invoices.'; END IF;
  IF NULLIF(invoice_data->>'job_order_id', '') IS NULL THEN RAISE EXCEPTION 'A Job Order is required for a linked invoice.'; END IF;
  IF jsonb_typeof(lines) <> 'array' THEN RAISE EXCEPTION 'Invoice lines are required.'; END IF;
  SELECT jsonb_array_length(lines) INTO line_count;
  IF line_count <= 0 THEN RAISE EXCEPTION 'Select at least one invoice line.'; END IF;
  FOR requested IN SELECT * FROM jsonb_array_elements(lines) LOOP
    SELECT * INTO source_line FROM public.job_order_line_items WHERE id = (requested->>'job_order_line_item_id')::UUID AND job_order_id = (invoice_data->>'job_order_id')::UUID;
    IF source_line.id IS NULL THEN RAISE EXCEPTION 'One selected line does not belong to this Job Order.'; END IF;
    requested_quantity := ROUND((requested->>'quantity')::NUMERIC, 2);
    IF requested_quantity <= 0 OR requested_quantity > source_line.quantity THEN RAISE EXCEPTION 'Invoice quantity must be greater than zero and cannot exceed the Job Order quantity.'; END IF;
    SELECT COALESCE(SUM(ili.quantity), 0) INTO billed_quantity FROM public.invoice_line_items ili JOIN public.invoices i ON i.id = ili.invoice_id WHERE i.job_order_id = source_line.job_order_id AND ili.job_order_line_item_id = source_line.id;
    IF billed_quantity + requested_quantity > source_line.quantity THEN RAISE EXCEPTION 'This Job Order line is already fully or partially billed beyond the remaining quantity.'; END IF;
    total_base := total_base + ROUND(CASE WHEN source_line.quantity = 0 THEN 0 ELSE source_line.line_total * requested_quantity / source_line.quantity END, 2);
  END LOOP;
  invoice_data := jsonb_set(invoice_data, '{invoice_amount}', to_jsonb(ROUND(total_base, 2)), true);
  INSERT INTO public.invoices (job_order_id, customer_id, customer_contact_id, contact_name_snapshot, contact_department_snapshot, contact_phone_snapshot, contact_email_snapshot, invoice_date, due_date, invoice_amount, tax_type, ewt_enabled, ewt_rate, ewt_treatment_snapshot)
  VALUES ((invoice_data->>'job_order_id')::UUID, (invoice_data->>'customer_id')::UUID, NULLIF(invoice_data->>'customer_contact_id', '')::UUID, NULLIF(invoice_data->>'contact_name_snapshot', ''), NULLIF(invoice_data->>'contact_department_snapshot', ''), NULLIF(invoice_data->>'contact_phone_snapshot', ''), NULLIF(invoice_data->>'contact_email_snapshot', ''), COALESCE(NULLIF(invoice_data->>'invoice_date', '')::DATE, CURRENT_DATE), NULLIF(invoice_data->>'due_date', '')::DATE, total_base, COALESCE(NULLIF(invoice_data->>'tax_type', ''), 'non_vat')::public.tax_type, COALESCE((invoice_data->>'ewt_enabled')::BOOLEAN, false), COALESCE((invoice_data->>'ewt_rate')::NUMERIC, 0.02), COALESCE(NULLIF(invoice_data->>'ewt_treatment_snapshot', ''), 'reference_only')) RETURNING * INTO created_invoice;
  DELETE FROM public.invoice_line_items WHERE invoice_id = created_invoice.id;
  FOR requested IN SELECT * FROM jsonb_array_elements(lines) LOOP
    SELECT * INTO source_line FROM public.job_order_line_items WHERE id = (requested->>'job_order_line_item_id')::UUID;
    requested_quantity := ROUND((requested->>'quantity')::NUMERIC, 2);
    INSERT INTO public.invoice_line_items (invoice_id, job_order_line_item_id, description, pricing_mode, width, height, unit_of_measure, computed_sqft, rate_per_sqft, quantity, unit_price, line_total, sort_order)
    VALUES (created_invoice.id, source_line.id, source_line.description, source_line.pricing_mode, source_line.width, source_line.height, source_line.unit_of_measure, source_line.computed_sqft, source_line.rate_per_sqft, requested_quantity, source_line.unit_price, ROUND(source_line.line_total * requested_quantity / source_line.quantity, 2), source_line.sort_order);
  END LOOP;
  RETURN QUERY SELECT created_invoice.id, created_invoice.invoice_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_job_invoice(JSONB, JSONB) TO authenticated;
COMMIT;
