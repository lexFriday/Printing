ALTER TABLE public.job_orders
  ADD COLUMN IF NOT EXISTS prepared_by_user_id uuid REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_job_orders_prepared_by_user_id
  ON public.job_orders(prepared_by_user_id);

NOTIFY pgrst, 'reload schema';
