BEGIN;

-- Completed work means production has started even between sequential steps.
CREATE OR REPLACE FUNCTION public.update_production_task(
  p_task_id UUID, p_status TEXT, p_hold_reason TEXT DEFAULT NULL
)
RETURNS public.production_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
DECLARE r public.production_tasks%ROWTYPE; item_status TEXT;
BEGIN
  SELECT * INTO r FROM public.production_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production task not found.'; END IF;
  IF NOT public.can_access_production_item(auth.uid(), r.job_order_line_item_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned items.';
  END IF;
  IF p_status NOT IN ('not_started','in_progress','done','on_hold') THEN RAISE EXCEPTION 'Invalid task status.'; END IF;
  IF p_status = 'on_hold' AND COALESCE(trim(p_hold_reason), '') = '' THEN RAISE EXCEPTION 'Hold reason is required.'; END IF;
  IF p_status = 'in_progress' THEN
    SELECT status INTO item_status FROM app_private.production_item_readiness(r.job_order_id)
      WHERE job_order_line_item_id = r.job_order_line_item_id;
    IF item_status = 'blocked' THEN RAISE EXCEPTION 'Item materials are not ready.'; END IF;
    IF EXISTS (SELECT 1 FROM public.production_tasks task
      WHERE task.job_order_line_item_id = r.job_order_line_item_id
        AND task.task_order < r.task_order AND task.status <> 'done') THEN
      RAISE EXCEPTION 'Complete the previous production step first.';
    END IF;
  END IF;

  UPDATE public.production_tasks SET status = p_status,
    hold_reason = CASE WHEN p_status = 'on_hold' THEN trim(p_hold_reason) ELSE NULL END,
    started_at = CASE WHEN p_status = 'in_progress' THEN COALESCE(started_at, now()) ELSE started_at END,
    completed_at = CASE WHEN p_status = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END,
    updated_at = now()
  WHERE id = p_task_id RETURNING * INTO r;

  UPDATE public.production_jobs SET status = CASE
      WHEN NOT EXISTS (SELECT 1 FROM public.production_tasks task
        WHERE task.job_order_id = r.job_order_id AND task.status <> 'done')
        THEN 'for_reconciliation'::public.production_status
      WHEN EXISTS (SELECT 1 FROM public.production_tasks task
        WHERE task.job_order_id = r.job_order_id AND task.status IN ('in_progress','on_hold','done'))
        THEN 'in_progress'::public.production_status
      ELSE 'preparing'::public.production_status END,
    started_at = CASE WHEN EXISTS (SELECT 1 FROM public.production_tasks task
      WHERE task.job_order_id = r.job_order_id AND task.status IN ('in_progress','on_hold','done'))
      THEN COALESCE(started_at, now()) ELSE started_at END,
    updated_at = now()
  WHERE job_order_id = r.job_order_id AND status NOT IN ('completed','cancelled');

  IF p_status IN ('in_progress','done','on_hold') THEN
    UPDATE public.job_orders SET status = 'in_production',
      production_started_at = COALESCE(production_started_at, now()), updated_at = now()
    WHERE id = r.job_order_id AND status = 'pending';
  END IF;
  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.update_production_task(UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_production_task(UUID,TEXT,TEXT) TO authenticated;

-- Repair records created by the previous parent-state derivation.
UPDATE public.job_orders job SET status = 'in_production',
  production_started_at = COALESCE(job.production_started_at, started.first_started_at, now()), updated_at = now()
FROM (
  SELECT task.job_order_id, MIN(COALESCE(task.started_at, task.completed_at, task.updated_at)) AS first_started_at
  FROM public.production_tasks task WHERE task.status IN ('in_progress','on_hold','done') GROUP BY task.job_order_id
) started
WHERE job.id = started.job_order_id AND job.status = 'pending';

UPDATE public.production_jobs production SET status = CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.production_tasks task
      WHERE task.job_order_id = production.job_order_id AND task.status <> 'done')
      THEN 'for_reconciliation'::public.production_status
    ELSE 'in_progress'::public.production_status END,
  started_at = COALESCE(production.started_at, now()), updated_at = now()
WHERE production.status IN ('preparing','partially_reserved','ready_to_start')
  AND EXISTS (SELECT 1 FROM public.production_tasks task
    WHERE task.job_order_id = production.job_order_id AND task.status IN ('in_progress','on_hold','done'));

NOTIFY pgrst, 'reload schema';
COMMIT;
