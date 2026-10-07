-- Preserve the historical Job Order workflow for jobs without a production
-- record. Once a Production document exists, only complete_production may
-- hand the Job Order from in_production to ready.

CREATE OR REPLACE FUNCTION public.validate_job_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.job_order_reopen', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'pending' AND NEW.status = 'in_production')
    OR (OLD.status = 'in_production' AND NEW.status = 'ready')
    OR (OLD.status = 'ready' AND NEW.status = 'delivered')
    OR (OLD.status = 'delivered' AND NEW.status = 'completed')
  ) THEN
    RAISE EXCEPTION 'Invalid job status transition: % to %', OLD.status, NEW.status;
  END IF;

  IF OLD.status = 'in_production' AND NEW.status = 'ready' AND EXISTS (
    SELECT 1
    FROM public.production_jobs
    WHERE job_order_id = NEW.id
      AND status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'production must be completed before the Job Order can be marked ready';
  END IF;

  IF NEW.status = 'in_production' THEN
    NEW.production_started_at := COALESCE(NEW.production_started_at, now());
  END IF;
  IF NEW.status = 'ready' THEN
    NEW.ready_at := COALESCE(NEW.ready_at, now());
  END IF;
  IF NEW.status = 'delivered' THEN
    NEW.delivered_at := COALESCE(NEW.delivered_at, now());
  END IF;
  IF NEW.status = 'completed' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  END IF;
  RETURN NEW;
END;
$$;
