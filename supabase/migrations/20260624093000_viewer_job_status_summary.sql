CREATE OR REPLACE VIEW public.viewer_job_status_summary AS
SELECT
  status,
  COUNT(*)::integer AS job_count
FROM public.job_orders
GROUP BY status;

GRANT SELECT ON public.viewer_job_status_summary TO authenticated;
