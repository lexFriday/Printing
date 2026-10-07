BEGIN;

CREATE TABLE IF NOT EXISTS public.production_task_plans (
  job_order_line_item_id UUID PRIMARY KEY REFERENCES public.job_order_line_items(id) ON DELETE RESTRICT,
  customized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  customized_by UUID NOT NULL REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.production_task_plans ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.production_task_plans TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.production_task_plans FROM authenticated;

DROP POLICY IF EXISTS production_task_plans_read ON public.production_task_plans;
CREATE POLICY production_task_plans_read ON public.production_task_plans
  FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));

CREATE OR REPLACE FUNCTION public.ensure_production_tasks(p_job_order_id UUID)
RETURNS SETOF public.production_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public AS $$
DECLARE
  l RECORD;
  steps TEXT[] := ARRAY['Artwork / Export','Production / Printing','Cutting / Finishing','Quality Check'];
  i INTEGER;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  FOR l IN
    SELECT id
    FROM public.job_order_line_items
    WHERE job_order_id=p_job_order_id
    ORDER BY sort_order,id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.production_task_plans AS plan
      WHERE plan.job_order_line_item_id=l.id
    ) THEN
      FOR i IN 1..array_length(steps,1) LOOP
        INSERT INTO public.production_tasks(job_order_id,job_order_line_item_id,task_type,task_order)
        VALUES(p_job_order_id,l.id,steps[i],i)
        ON CONFLICT (job_order_line_item_id,task_type) DO NOTHING;
      END LOOP;
    END IF;
  END LOOP;

  RETURN QUERY
    SELECT * FROM public.production_tasks
    WHERE job_order_id=p_job_order_id
    ORDER BY job_order_line_item_id,task_order;
END; $$;

CREATE OR REPLACE FUNCTION public.save_custom_item_production_steps(
  p_job_order_line_item_id UUID,
  p_steps JSONB
)
RETURNS SETOF public.production_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public AS $$
DECLARE
  v_line public.job_order_line_items%ROWTYPE;
  v_old_steps JSONB;
  v_step_count INTEGER;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Owner or Admin access is required to customize production steps';
  END IF;

  SELECT * INTO v_line
  FROM public.job_order_line_items
  WHERE id=p_job_order_line_item_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Job Order item not found'; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.quote_line_items AS quote_line
    WHERE quote_line.id=v_line.quote_line_item_id
      AND quote_line.item_template_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Only custom items can customize production steps';
  END IF;

  IF jsonb_typeof(p_steps) <> 'array' THEN
    RAISE EXCEPTION 'Production steps must be a list';
  END IF;

  v_step_count := jsonb_array_length(p_steps);
  IF v_step_count < 1 THEN RAISE EXCEPTION 'Add at least one production step'; END IF;
  IF v_step_count > 12 THEN RAISE EXCEPTION 'Use up to 12 production steps'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_steps) AS step(name)
    WHERE length(trim(step.name))=0 OR length(trim(step.name))>80
  ) THEN
    RAISE EXCEPTION 'Every production step needs a name of 80 characters or fewer';
  END IF;

  IF (
    SELECT count(*) FROM (
      SELECT DISTINCT lower(trim(step.name))
      FROM jsonb_array_elements_text(p_steps) AS step(name)
    ) AS unique_steps
  ) <> v_step_count THEN
    RAISE EXCEPTION 'Give every production step a different name';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.production_tasks
    WHERE job_order_line_item_id=p_job_order_line_item_id
      AND status <> 'not_started'
  ) THEN
    RAISE EXCEPTION 'Production steps cannot be changed after work has started';
  END IF;

  SELECT COALESCE(jsonb_agg(task_type ORDER BY task_order), '[]'::jsonb)
  INTO v_old_steps
  FROM public.production_tasks
  WHERE job_order_line_item_id=p_job_order_line_item_id;

  INSERT INTO public.production_task_plans(job_order_line_item_id,customized_by)
  VALUES(p_job_order_line_item_id,auth.uid())
  ON CONFLICT (job_order_line_item_id) DO UPDATE
    SET customized_at=now(), customized_by=auth.uid(), updated_at=now();

  DELETE FROM public.production_tasks
  WHERE job_order_line_item_id=p_job_order_line_item_id;

  INSERT INTO public.production_tasks(job_order_id,job_order_line_item_id,task_type,task_order)
  SELECT v_line.job_order_id,p_job_order_line_item_id,trim(step.name),step.ordinality::INTEGER
  FROM jsonb_array_elements_text(p_steps) WITH ORDINALITY AS step(name, ordinality);

  INSERT INTO public.audit_logs(user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(
    auth.uid(),
    'production_steps.customized',
    'job_order_line_item',
    p_job_order_line_item_id,
    jsonb_build_object('steps',v_old_steps),
    jsonb_build_object('steps',p_steps)
  );

  RETURN QUERY
    SELECT * FROM public.production_tasks
    WHERE job_order_line_item_id=p_job_order_line_item_id
    ORDER BY task_order;
END; $$;

GRANT EXECUTE ON FUNCTION public.save_custom_item_production_steps(UUID,JSONB) TO authenticated;

COMMIT;
