BEGIN;

-- Some existing JOs were moved to the commercial in_production state before
-- their production plan was created. Permit safe plan recovery for that state.
CREATE OR REPLACE FUNCTION public.create_production_plan(p_job_order_id UUID, p_job_type TEXT, p_responsible_user_id UUID DEFAULT NULL)
RETURNS public.production_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.job_orders%ROWTYPE; v_result public.production_jobs%ROWTYPE;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')) THEN RAISE EXCEPTION 'owner or admin plan creation required'; END IF;
  SELECT * INTO v_job FROM public.job_orders WHERE job_orders.id = p_job_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job order not found'; END IF;
  IF v_job.status::TEXT NOT IN ('pending','open','in_production') THEN RAISE EXCEPTION 'only open, pending, or recoverable in-production job orders can enter production'; END IF;
  INSERT INTO public.production_jobs(job_order_id, job_type, responsible_user_id, status) VALUES (p_job_order_id, COALESCE(NULLIF(trim(p_job_type), ''), 'general'), p_responsible_user_id, 'preparing') ON CONFLICT (job_order_id) DO UPDATE SET job_type = EXCLUDED.job_type, responsible_user_id = COALESCE(EXCLUDED.responsible_user_id, production_jobs.responsible_user_id), updated_at = now() RETURNING * INTO v_result;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_production_plan(UUID,TEXT,UUID) TO authenticated;
COMMIT;
