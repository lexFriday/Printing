-- Keep the correction RPC compatible with the live job_order_line_items schema.
-- Depth is not part of that table's canonical contract.
CREATE OR REPLACE FUNCTION public.correct_job_order_before_completion(
  p_job_order_id UUID,
  p_payload JSONB,
  p_reason TEXT
)
RETURNS public.job_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_old public.job_orders%ROWTYPE;
  v_new public.job_orders%ROWTYPE;
  v_line JSONB;
  v_total NUMERIC(14,2) := 0;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_desc TEXT;
BEGIN
  SELECT * INTO v_old FROM public.job_orders WHERE id = p_job_order_id FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Job Order not found.'; END IF;
  IF v_old.status = 'completed' THEN RAISE EXCEPTION 'Completed Job Orders cannot be reopened here.'; END IF;
  IF EXISTS (SELECT 1 FROM public.invoices WHERE job_order_id = p_job_order_id) THEN
    RAISE EXCEPTION 'This Job Order has an invoice. Use the Admin invoice-correction workflow.';
  END IF;

  IF p_payload ? 'lines' THEN
    DELETE FROM public.job_order_line_items WHERE job_order_id = p_job_order_id;
    FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'lines','[]'::jsonb)) LOOP
      v_desc := NULLIF(trim(v_line->>'description'),'');
      v_qty := (v_line->>'quantity')::NUMERIC;
      v_price := (v_line->>'unit_price')::NUMERIC;
      IF v_desc IS NULL OR v_qty IS NULL OR v_qty <= 0 OR v_price IS NULL OR v_price < 0 THEN
        RAISE EXCEPTION 'Each line needs a description, quantity, and valid unit price.';
      END IF;
      INSERT INTO public.job_order_line_items(
        job_order_id, quote_line_item_id, description, pricing_mode, unit_of_measure,
        width, height, quantity, rate_per_sqft, computed_sqft, unit_price, line_total, sort_order
      )
      VALUES (
        p_job_order_id, NULLIF(v_line->>'quote_line_item_id','')::UUID, v_desc,
        (v_line->>'pricing_mode')::public.pricing_mode,
        NULLIF(v_line->>'unit_of_measure','')::public.unit_of_measure,
        NULLIF(v_line->>'width','')::NUMERIC, NULLIF(v_line->>'height','')::NUMERIC,
        v_qty, NULLIF(v_line->>'rate_per_sqft','')::NUMERIC,
        NULLIF(v_line->>'computed_sqft','')::NUMERIC, v_price, ROUND(v_qty*v_price,2),
        COALESCE((v_line->>'sort_order')::INT,0)
      );
      v_total := v_total + ROUND(v_qty*v_price,2);
    END LOOP;
  END IF;

  UPDATE public.job_orders
  SET tax_type = CASE WHEN p_payload ? 'tax_type' THEN (p_payload->>'tax_type')::public.tax_type ELSE tax_type END,
      project_manager = CASE WHEN p_payload ? 'project_manager' THEN NULLIF(trim(p_payload->>'project_manager'),'') ELSE project_manager END,
      approved_by_name = CASE WHEN p_payload ? 'approved_by_name' THEN NULLIF(trim(p_payload->>'approved_by_name'),'') ELSE approved_by_name END,
      quoted_amount = CASE WHEN p_payload ? 'lines' THEN v_total ELSE quoted_amount END,
      updated_at = now()
  WHERE id = p_job_order_id
  RETURNING * INTO v_new;

  INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, old_values, new_values)
  VALUES (
    auth.uid(), 'job_order.corrected_before_completion', 'job_order', p_job_order_id,
    jsonb_build_object('tax_type',v_old.tax_type,'project_manager',v_old.project_manager,'approved_by_name',v_old.approved_by_name,'quoted_amount',v_old.quoted_amount),
    jsonb_build_object('tax_type',v_new.tax_type,'project_manager',v_new.project_manager,'approved_by_name',v_new.approved_by_name,'quoted_amount',v_new.quoted_amount,'reason',trim(p_reason))
  );
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.correct_job_order_before_completion(UUID, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_job_order_before_completion(UUID, JSONB, TEXT) TO authenticated;
