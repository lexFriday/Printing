BEGIN;

ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'cancelled';

CREATE OR REPLACE FUNCTION public.cancel_production(
  p_job_order_id UUID,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, app_private, pg_temp
AS $$
BEGIN
  IF NOT (app_private.has_role(auth.uid(), 'owner') OR app_private.has_role(auth.uid(), 'admin') OR app_private.has_role(auth.uid(), 'staff')) THEN
    RAISE EXCEPTION 'You do not have permission to cancel production.';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'A cancellation reason is required.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.production_jobs WHERE job_order_id = p_job_order_id) THEN RAISE EXCEPTION 'Production job not found.'; END IF;
  IF EXISTS (SELECT 1 FROM public.production_jobs WHERE job_order_id = p_job_order_id AND status = 'completed') THEN RAISE EXCEPTION 'Completed production cannot be cancelled.'; END IF;
  UPDATE public.production_jobs SET status = 'cancelled', notes = concat_ws(E'\n', notes, 'Cancelled: ' || trim(p_reason)), updated_at = now() WHERE job_order_id = p_job_order_id;
  UPDATE public.production_tasks SET status = 'on_hold', hold_reason = 'Production cancelled: ' || trim(p_reason), updated_at = now() WHERE job_order_id = p_job_order_id AND status <> 'done';
  UPDATE public.purchase_requests SET status = 'cancelled', updated_at = now() WHERE job_order_id = p_job_order_id AND status NOT IN ('cancelled', 'received');
  UPDATE public.job_orders SET status = 'cancelled', updated_at = now() WHERE id = p_job_order_id AND status <> 'completed';
  INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, old_values, new_values)
  VALUES (auth.uid(), 'production.cancelled', 'job_order', p_job_order_id, jsonb_build_object('reason', trim(p_reason)), jsonb_build_object('status', 'cancelled', 'reason', trim(p_reason)));
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_production(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_production(UUID, TEXT) TO authenticated;
COMMIT;
