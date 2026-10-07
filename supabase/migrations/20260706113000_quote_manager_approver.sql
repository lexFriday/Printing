ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS manager_approved_by_user_id uuid REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_quotations_manager_approved_by_user_id
  ON public.quotations(manager_approved_by_user_id);

NOTIFY pgrst, 'reload schema';
