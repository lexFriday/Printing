BEGIN;

CREATE OR REPLACE FUNCTION public.complete_production(p_job_order_id UUID,p_idempotency_key TEXT)
RETURNS public.production_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result public.production_jobs%ROWTYPE;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'owner or admin approval required'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key='' THEN RAISE EXCEPTION 'idempotency key required'; END IF;
  UPDATE public.production_jobs SET status='completed',completed_at=COALESCE(completed_at,now()),updated_at=now()
    WHERE job_order_id=p_job_order_id AND status='for_reconciliation' RETURNING * INTO v_result;
  IF NOT FOUND THEN RAISE EXCEPTION 'production must be reconciled before completion'; END IF;
  UPDATE public.job_orders SET status='ready', ready_at=COALESCE(ready_at,now()), updated_at=now()
    WHERE id=p_job_order_id AND status IN ('pending','in_production');
  IF NOT FOUND THEN RAISE EXCEPTION 'job order is not ready for completion'; END IF;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.complete_production(UUID,TEXT) TO authenticated;

COMMIT;
