ALTER TABLE public.petty_cash_batches
  ADD COLUMN IF NOT EXISTS cash_returned_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS cash_returned_reference text;

CREATE OR REPLACE FUNCTION public.settle_petty_cash_batch(
  p_batch_id uuid,
  p_cash_returned_amount numeric,
  p_cash_returned_reference text
) RETURNS public.petty_cash_batches
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_batch public.petty_cash_batches;
  v_spent numeric;
  v_funded numeric;
BEGIN
  SELECT * INTO v_batch FROM public.petty_cash_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Petty-cash batch not found'; END IF;
  IF v_batch.status <> 'open' THEN RAISE EXCEPTION 'Only open petty-cash batches can be settled'; END IF;
  IF p_cash_returned_amount IS NULL OR p_cash_returned_amount < 0 THEN RAISE EXCEPTION 'Returned cash must be zero or greater'; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_spent FROM public.job_expenses WHERE petty_cash_batch_id = p_batch_id;
  SELECT v_batch.cash_received + COALESCE(SUM(amount), 0) INTO v_funded
  FROM public.petty_cash_funding_events WHERE petty_cash_batch_id = p_batch_id;
  IF p_cash_returned_amount + v_spent <> v_funded THEN
    RAISE EXCEPTION 'Returned cash plus receipts must equal funded cash';
  END IF;
  UPDATE public.petty_cash_batches
  SET status = 'closed', closed_at = now(), closed_by = auth.uid(),
      cash_returned_amount = p_cash_returned_amount,
      cash_returned_reference = NULLIF(trim(p_cash_returned_reference), '')
  WHERE id = p_batch_id
  RETURNING * INTO v_batch;
  RETURN v_batch;
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_petty_cash_batch(uuid, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.settle_and_close_petty_cash_batch(
  p_batch_id uuid,
  p_cash_returned_amount numeric,
  p_cash_returned_reference text
) RETURNS public.petty_cash_batches
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN public.settle_petty_cash_batch(p_batch_id, p_cash_returned_amount, p_cash_returned_reference);
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_and_close_petty_cash_batch(uuid, numeric, text) TO authenticated;
