-- Restores the transactional Money Out write functions for the local Mitzy workflow.
BEGIN;

-- Money Out is accounting work. Keep its table policies and allocation RPC aligned
-- with the same least-privilege rule as job_expenses: owner, admin, or accounting.
DROP POLICY IF EXISTS petty_cash_write ON public.petty_cash_batches;
CREATE POLICY petty_cash_write ON public.petty_cash_batches
  FOR ALL TO authenticated
  USING (app_private.can_accounting_work(auth.uid()))
  WITH CHECK (app_private.can_accounting_work(auth.uid()));

DROP POLICY IF EXISTS expense_allocations_write ON public.job_expense_allocations;
CREATE POLICY expense_allocations_write ON public.job_expense_allocations
  FOR ALL TO authenticated
  USING (app_private.can_accounting_work(auth.uid()))
  WITH CHECK (app_private.can_accounting_work(auth.uid()));

DROP POLICY IF EXISTS petty_cash_funding_insert ON public.petty_cash_funding_events;
CREATE POLICY petty_cash_funding_insert ON public.petty_cash_funding_events
  FOR INSERT TO authenticated
  WITH CHECK (app_private.can_accounting_work(auth.uid()) AND created_by = auth.uid());

CREATE OR REPLACE FUNCTION public.replace_job_expense_allocations(
  p_expense_id uuid,
  p_allocations jsonb DEFAULT '[]'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
  source_amount numeric;
  direct_job_order_id uuid;
  allocation_total numeric;
BEGIN
  IF NOT app_private.can_accounting_work(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'Allocations must be a list.' USING ERRCODE = '22023';
  END IF;

  SELECT amount, job_order_id
    INTO source_amount, direct_job_order_id
  FROM public.job_expenses
  WHERE id = p_expense_id
  FOR UPDATE;

  IF source_amount IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  SELECT COALESCE(SUM((value->>'allocated_amount')::numeric), 0)
    INTO allocation_total
  FROM jsonb_array_elements(p_allocations) AS values(value);

  IF allocation_total > source_amount THEN
    RAISE EXCEPTION 'Allocation total cannot exceed the expense amount.' USING ERRCODE = '23514';
  END IF;

  IF allocation_total > 0 AND direct_job_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'Job Order allocations cannot be added to a directly linked expense.' USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.job_expense_allocations WHERE job_expense_id = p_expense_id;

  INSERT INTO public.job_expense_allocations(job_expense_id, job_order_id, allocated_amount, created_by)
    SELECT p_expense_id, (value->>'job_order_id')::uuid, (value->>'allocated_amount')::numeric, auth.uid()
    FROM jsonb_array_elements(p_allocations) AS values(value);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_job_expense_with_allocations(
  p_expense jsonb,
  p_allocations jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
  v_expense_id uuid := COALESCE(NULLIF(p_expense->>'id', '')::uuid, gen_random_uuid());
  v_amount numeric := NULLIF(p_expense->>'amount', '')::numeric;
  v_job_order_id uuid := NULLIF(p_expense->>'job_order_id', '')::uuid;
  v_allocation_total numeric;
BEGIN
  IF NOT app_private.can_accounting_work(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_expense) <> 'object' OR jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'Invalid expense request.' USING ERRCODE = '22023';
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero.' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM((value->>'allocated_amount')::numeric), 0)
    INTO v_allocation_total
  FROM jsonb_array_elements(p_allocations) AS values(value);

  IF v_allocation_total > v_amount THEN
    RAISE EXCEPTION 'Allocation total cannot exceed the expense amount.' USING ERRCODE = '23514';
  END IF;

  IF v_allocation_total > 0 AND v_job_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'An expense cannot be directly linked and allocated across Job Orders.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.job_expenses (
    id, job_order_id, petty_cash_batch_id, supplier_id, expense_date, expense_type,
    disbursement_category, disbursement_subcategory, supplier_name, description,
    quantity, unit_of_measure, unit_cost, amount, tax_amount, tax_type, payment_status,
    payment_method, payment_state, payment_source, payment_source_reference,
    payment_proof_storage_path, payment_proof_file_name, payment_proof_file_type,
    payment_proof_file_size, receipt_missing_reason, payment_released_at, due_date,
    paid_at, reference_no, supplier_document_no, supplier_tin, supplier_address,
    check_date, check_number, remarks, created_by
  ) VALUES (
    v_expense_id,
    v_job_order_id,
    NULLIF(p_expense->>'petty_cash_batch_id', '')::uuid,
    NULLIF(p_expense->>'supplier_id', '')::uuid,
    COALESCE(NULLIF(p_expense->>'expense_date', '')::date, CURRENT_DATE),
    NULLIF(p_expense->>'expense_type', '')::public.expense_type,
    NULLIF(p_expense->>'disbursement_category', '')::public.disbursement_category,
    NULLIF(p_expense->>'disbursement_subcategory', '')::public.disbursement_subcategory,
    NULLIF(p_expense->>'supplier_name', ''),
    NULLIF(p_expense->>'description', ''),
    NULLIF(p_expense->>'quantity', '')::numeric,
    NULLIF(p_expense->>'unit_of_measure', ''),
    NULLIF(p_expense->>'unit_cost', '')::numeric,
    v_amount,
    COALESCE(NULLIF(p_expense->>'tax_amount', '')::numeric, 0),
    COALESCE(NULLIF(p_expense->>'tax_type', '')::public.tax_type, 'non_vat'::public.tax_type),
    COALESCE(NULLIF(p_expense->>'payment_status', '')::public.expense_payment_status, 'pending'),
    NULLIF(p_expense->>'payment_method', '')::public.disbursement_payment_method,
    COALESCE(NULLIF(p_expense->>'payment_state', '')::public.disbursement_payment_state, 'pending'),
    NULLIF(p_expense->>'payment_source', ''),
    NULLIF(p_expense->>'payment_source_reference', ''),
    NULLIF(p_expense->>'payment_proof_storage_path', ''),
    NULLIF(p_expense->>'payment_proof_file_name', ''),
    NULLIF(p_expense->>'payment_proof_file_type', ''),
    NULLIF(p_expense->>'payment_proof_file_size', '')::bigint,
    NULLIF(p_expense->>'receipt_missing_reason', ''),
    NULLIF(p_expense->>'payment_released_at', '')::timestamptz,
    NULLIF(p_expense->>'due_date', '')::date,
    NULLIF(p_expense->>'paid_at', '')::timestamptz,
    NULLIF(p_expense->>'reference_no', ''),
    NULLIF(p_expense->>'supplier_document_no', ''),
    NULLIF(p_expense->>'supplier_tin', ''),
    NULLIF(p_expense->>'supplier_address', ''),
    NULLIF(p_expense->>'check_date', '')::date,
    NULLIF(p_expense->>'check_number', ''),
    NULLIF(p_expense->>'remarks', ''),
    auth.uid()
  );

  IF v_allocation_total > 0 THEN
    INSERT INTO public.job_expense_allocations(job_expense_id, job_order_id, allocated_amount, created_by)
      SELECT v_expense_id, (value->>'job_order_id')::uuid, (value->>'allocated_amount')::numeric, auth.uid()
      FROM jsonb_array_elements(p_allocations) AS values(value);
  END IF;

  RETURN v_expense_id;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_job_expense_allocations(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_job_expense_allocations(uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.create_job_expense_with_allocations(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_job_expense_with_allocations(jsonb, jsonb) TO authenticated;

COMMIT;

