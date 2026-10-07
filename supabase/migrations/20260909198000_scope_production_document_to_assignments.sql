BEGIN;

-- The document shell is operational context, but Production users must still
-- have at least one currently assigned item in the Job Order. Owner, Admin,
-- and Staff access continues through can_access_production_job.
CREATE OR REPLACE FUNCTION public.production_job_document(p_job_order_id UUID)
RETURNS TABLE(id UUID, job_number TEXT, project_name TEXT, status TEXT, customer_id UUID, quotation_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
  SELECT job.id, job.job_number, job.project_name, job.status::TEXT, job.customer_id, job.quotation_id
  FROM public.job_orders AS job
  WHERE job.id = p_job_order_id
    AND public.can_access_production_job(auth.uid(), job.id);
$$;
REVOKE ALL ON FUNCTION public.production_job_document(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_job_document(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
