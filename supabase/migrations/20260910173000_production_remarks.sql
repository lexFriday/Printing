BEGIN;

ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS remarks TEXT;

CREATE OR REPLACE FUNCTION public.update_production_remarks(
  p_job_order_id UUID,
  p_remarks TEXT
)
RETURNS public.production_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_remarks TEXT := NULLIF(trim(p_remarks), '');
  v_job public.production_jobs;
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Production workers can only update assigned Job Orders.';
  END IF;

  IF char_length(v_remarks) > 2000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22001',
      MESSAGE = 'Production remarks must be 2,000 characters or fewer.';
  END IF;

  UPDATE public.production_jobs
  SET remarks = v_remarks,
      updated_at = now()
  WHERE job_order_id = p_job_order_id
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Production job not found.';
  END IF;

  -- The existing capture_audit_log trigger records old/new production_jobs rows.
  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.update_production_remarks(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_production_remarks(UUID, TEXT) TO authenticated;

COMMIT;
