ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS payment_terms TEXT;

NOTIFY pgrst, 'reload schema';
