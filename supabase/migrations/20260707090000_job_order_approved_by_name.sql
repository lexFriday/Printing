ALTER TABLE public.job_orders
  ADD COLUMN IF NOT EXISTS approved_by_name text;

NOTIFY pgrst, 'reload schema';
