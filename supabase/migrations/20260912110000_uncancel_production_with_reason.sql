BEGIN;

CREATE OR REPLACE FUNCTION public.uncancel_production(
  p_job_order_id UUID,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, app_private, pg_temp
AS $$
BEGIN
  IF NOT (app_private.has_role(auth.uid(), 'owner') OR app_private.has_role(auth.uid(), 'admin') OR app_private.has_role(auth.uid(), 'staff')) THEN
    RAISE EXCEPTION 'You do not have permission to restore production.';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'A reason is required to restore production.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.production_jobs WHERE job_order_id = p_job_order_id AND status = 'cancelled') THEN RAISE EXCEPTION 'Production is not cancelled.'; END IF;
  UPDATE public.production_jobs SET status = 'preparing', notes = concat_ws(E'\n', notes, 'Restored: ' || trim(p_reason)), updated_at = now() WHERE job_order_id = p_job_order_id;
  UPDATE public.production_tasks SET status = 'not_started', hold_reason = NULL, updated_at = now() WHERE job_order_id = p_job_order_id AND status = 'on_hold' AND hold_reason LIKE 'Production cancelled:%';
  INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, old_values, new_values)
  VALUES (auth.uid(), 'production.uncancelled', 'job_order', p_job_order_id, jsonb_build_object('production_status', 'cancelled'), jsonb_build_object('production_status', 'preparing', 'reason', trim(p_reason)));
END;
$$;

REVOKE ALL ON FUNCTION public.uncancel_production(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.uncancel_production(UUID, TEXT) TO authenticated;
COMMIT;
