-- The Mitzy workflow advances Job Orders by explicit status actions.
-- Do not block the status flow on a separate Production record.
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
  IF NEW.status = 'in_production' THEN
    NEW.production_started_at := COALESCE(NEW.production_started_at, now());
  ELSIF NEW.status = 'ready' THEN
    NEW.ready_at := COALESCE(NEW.ready_at, now());
  ELSIF NEW.status = 'delivered' THEN
    NEW.delivered_at := COALESCE(NEW.delivered_at, now());
  ELSIF NEW.status = 'completed' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  END IF;
  RETURN NEW;
END;
$$;
