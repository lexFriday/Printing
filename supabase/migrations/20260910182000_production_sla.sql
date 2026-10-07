-- One production commitment per Job Order. SLA state remains derived from the
-- deadline, completion timestamp, and existing material-readiness records.

CREATE OR REPLACE FUNCTION app_private.add_working_days(p_start TIMESTAMPTZ, p_days INTEGER)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  v_result TIMESTAMPTZ := p_start;
  v_added INTEGER := 0;
BEGIN
  WHILE v_added < p_days LOOP
    v_result := v_result + INTERVAL '1 day';
    IF EXTRACT(ISODOW FROM v_result) < 6 THEN v_added := v_added + 1; END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_set_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT;

UPDATE public.production_jobs
SET sla_due_at = app_private.add_working_days(created_at, 3),
    sla_set_at = created_at
WHERE sla_due_at IS NULL;

CREATE OR REPLACE FUNCTION app_private.default_production_sla()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, app_private AS $$
BEGIN
  NEW.sla_due_at := COALESCE(NEW.sla_due_at, app_private.add_working_days(COALESCE(NEW.created_at, now()), 3));
  NEW.sla_set_at := COALESCE(NEW.sla_set_at, COALESCE(NEW.created_at, now()));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_default_production_sla ON public.production_jobs;
CREATE TRIGGER trg_default_production_sla
BEFORE INSERT ON public.production_jobs
FOR EACH ROW EXECUTE FUNCTION app_private.default_production_sla();

CREATE OR REPLACE FUNCTION public.set_production_sla(
  p_job_order_id UUID,
  p_sla_due_at TIMESTAMPTZ,
  p_reason TEXT
)
RETURNS public.production_jobs
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, app_private, pg_temp AS $$
DECLARE
  v_old public.production_jobs%ROWTYPE;
  v_new public.production_jobs%ROWTYPE;
  v_can_set BOOLEAN;
BEGIN
  IF p_sla_due_at IS NULL OR p_sla_due_at <= now() THEN
    RAISE EXCEPTION 'Production SLA must be a future date and time.';
  END IF;
  IF COALESCE(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Production SLA change reason is required.';
  END IF;

  v_can_set := public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.production_item_assignments assignment
      JOIN public.job_order_line_items line ON line.id = assignment.job_order_line_item_id
      WHERE line.job_order_id = p_job_order_id
        AND assignment.user_id = auth.uid()
        AND assignment.removed_at IS NULL
    );
  IF NOT public.is_active_user(auth.uid()) OR NOT v_can_set THEN
    RAISE EXCEPTION 'You do not have permission to set this Production SLA.';
  END IF;

  SELECT * INTO v_old FROM public.production_jobs
  WHERE job_order_id = p_job_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production job not found.'; END IF;
  IF v_old.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'A closed Production SLA cannot be revised.';
  END IF;

  UPDATE public.production_jobs
  SET sla_due_at = p_sla_due_at, sla_set_at = now(), sla_set_by = auth.uid(), updated_at = now()
  WHERE job_order_id = p_job_order_id RETURNING * INTO v_new;

  INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, old_values, new_values)
  VALUES (auth.uid(), 'production.sla_revised', 'production_job', p_job_order_id,
    jsonb_build_object('sla_due_at', v_old.sla_due_at),
    jsonb_build_object('sla_due_at', v_new.sla_due_at, 'reason', trim(p_reason)));
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.set_production_sla(UUID,TIMESTAMPTZ,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_production_sla(UUID,TIMESTAMPTZ,TEXT) TO authenticated;
