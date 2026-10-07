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
