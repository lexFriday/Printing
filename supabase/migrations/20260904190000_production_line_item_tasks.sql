CREATE TABLE IF NOT EXISTS public.production_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id UUID NOT NULL REFERENCES public.job_orders(id) ON DELETE RESTRICT,
  job_order_line_item_id UUID NOT NULL REFERENCES public.job_order_line_items(id) ON DELETE RESTRICT,
  task_type TEXT NOT NULL,
  task_order INTEGER NOT NULL,
  department TEXT,
  assignee_id UUID REFERENCES public.profiles(id),
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','done','on_hold')),
  hold_reason TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_order_line_item_id, task_type)
);
ALTER TABLE public.production_tasks ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.production_tasks TO authenticated;
GRANT INSERT, UPDATE ON public.production_tasks TO authenticated;
DROP POLICY IF EXISTS production_tasks_read ON public.production_tasks;
DROP POLICY IF EXISTS production_tasks_write ON public.production_tasks;
CREATE POLICY production_tasks_read ON public.production_tasks FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY production_tasks_write ON public.production_tasks FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));
CREATE POLICY production_tasks_update ON public.production_tasks FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin') OR (public.has_role(auth.uid(),'staff') AND (assignee_id = auth.uid() OR assignee_id IS NULL))) WITH CHECK (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin') OR (public.has_role(auth.uid(),'staff') AND (assignee_id = auth.uid() OR assignee_id IS NULL)));

CREATE OR REPLACE FUNCTION public.ensure_production_tasks(p_job_order_id UUID)
RETURNS SETOF public.production_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l RECORD; steps TEXT[] := ARRAY['Artwork / Export','Production / Printing','Cutting / Finishing','Quality Check']; i INTEGER;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  FOR l IN SELECT id FROM public.job_order_line_items WHERE job_order_id=p_job_order_id ORDER BY sort_order,id LOOP
    FOR i IN 1..array_length(steps,1) LOOP
      INSERT INTO public.production_tasks(job_order_id,job_order_line_item_id,task_type,task_order)
      VALUES(p_job_order_id,l.id,steps[i],i) ON CONFLICT (job_order_line_item_id,task_type) DO NOTHING;
    END LOOP;
  END LOOP;
  RETURN QUERY SELECT * FROM public.production_tasks WHERE job_order_id=p_job_order_id ORDER BY job_order_line_item_id,task_order;
END; $$;
GRANT EXECUTE ON FUNCTION public.ensure_production_tasks(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_production_task(p_task_id UUID,p_status TEXT,p_hold_reason TEXT DEFAULT NULL)
RETURNS public.production_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.production_tasks%ROWTYPE;
BEGIN
  IF p_status NOT IN ('not_started','in_progress','done','on_hold') THEN RAISE EXCEPTION 'invalid task status'; END IF;
  IF p_status='on_hold' AND COALESCE(trim(p_hold_reason),'')='' THEN RAISE EXCEPTION 'hold reason is required'; END IF;
  UPDATE public.production_tasks SET status=p_status,hold_reason=CASE WHEN p_status='on_hold' THEN trim(p_hold_reason) ELSE NULL END,started_at=CASE WHEN p_status='in_progress' THEN COALESCE(started_at,now()) ELSE started_at END,completed_at=CASE WHEN p_status='done' THEN COALESCE(completed_at,now()) ELSE NULL END,updated_at=now() WHERE id=p_task_id RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  RETURN r;
END; $$;
GRANT EXECUTE ON FUNCTION public.update_production_task(UUID,TEXT,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_production_task(p_task_id UUID,p_assignee_id UUID,p_department TEXT DEFAULT NULL)
RETURNS public.production_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.production_tasks%ROWTYPE;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin')) THEN RAISE EXCEPTION 'supervisor assignment required'; END IF;
  UPDATE public.production_tasks SET assignee_id=p_assignee_id,department=NULLIF(trim(p_department),''),updated_at=now() WHERE id=p_task_id RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  RETURN r;
END; $$;
GRANT EXECUTE ON FUNCTION public.assign_production_task(UUID,UUID,TEXT) TO authenticated;
