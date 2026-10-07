BEGIN;

CREATE OR REPLACE FUNCTION public.update_production_task(p_task_id UUID,p_status TEXT,p_hold_reason TEXT DEFAULT NULL)
RETURNS public.production_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.production_tasks%ROWTYPE; item_status TEXT;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_status NOT IN ('not_started','in_progress','done','on_hold') THEN RAISE EXCEPTION 'invalid task status'; END IF;
  IF p_status='on_hold' AND COALESCE(trim(p_hold_reason),'')='' THEN RAISE EXCEPTION 'hold reason is required'; END IF;
  SELECT * INTO r FROM public.production_tasks WHERE id=p_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  IF p_status='in_progress' THEN
    SELECT status INTO item_status FROM public.production_item_readiness(r.job_order_id) WHERE job_order_line_item_id=r.job_order_line_item_id;
    IF item_status='blocked' THEN RAISE EXCEPTION 'item materials are not ready'; END IF;
    IF EXISTS (SELECT 1 FROM public.production_tasks t WHERE t.job_order_line_item_id=r.job_order_line_item_id AND t.task_order<r.task_order AND t.status<>'done') THEN RAISE EXCEPTION 'complete the previous production step first'; END IF;
  END IF;
  UPDATE public.production_tasks SET status=p_status,hold_reason=CASE WHEN p_status='on_hold' THEN trim(p_hold_reason) ELSE NULL END,started_at=CASE WHEN p_status='in_progress' THEN COALESCE(started_at,now()) ELSE started_at END,completed_at=CASE WHEN p_status='done' THEN COALESCE(completed_at,now()) ELSE NULL END,updated_at=now() WHERE id=p_task_id RETURNING * INTO r;
  UPDATE public.production_jobs pj SET status=CASE WHEN EXISTS (SELECT 1 FROM public.production_tasks t WHERE t.job_order_id=r.job_order_id AND t.status IN ('in_progress','on_hold')) THEN 'in_progress'::production_status WHEN EXISTS (SELECT 1 FROM public.production_tasks t WHERE t.job_order_id=r.job_order_id AND t.status='done') AND NOT EXISTS (SELECT 1 FROM public.production_tasks t WHERE t.job_order_id=r.job_order_id AND t.status<>'done') THEN 'for_reconciliation'::production_status ELSE 'preparing'::production_status END,updated_at=now() WHERE pj.job_order_id=r.job_order_id AND pj.status NOT IN ('completed','cancelled');
  RETURN r;
END; $$;

COMMIT;
