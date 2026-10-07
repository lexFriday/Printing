ALTER TABLE public.job_expenses
  ADD COLUMN IF NOT EXISTS tax_type public.tax_type NOT NULL DEFAULT 'non_vat';

COMMENT ON COLUMN public.job_expenses.tax_type IS
  'VAT classification for the expense; tax_amount remains the recorded tax value.';
