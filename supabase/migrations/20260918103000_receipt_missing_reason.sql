-- Records the review reason when a petty-cash receipt is unavailable.
-- Additive only; the UI requires this value only for no-proof receipts.
ALTER TABLE public.job_expenses
  ADD COLUMN IF NOT EXISTS receipt_missing_reason text;

COMMENT ON COLUMN public.job_expenses.receipt_missing_reason
  IS 'Short explanation required when receipt proof is unavailable.';
