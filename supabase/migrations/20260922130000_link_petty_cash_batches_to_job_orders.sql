-- Explicitly links a cash advance to one Job Order when the entire batch belongs to it.
-- Existing batches remain NULL and are not reclassified.
BEGIN;
ALTER TABLE public.petty_cash_batches
  ADD COLUMN IF NOT EXISTS job_order_id uuid REFERENCES public.job_orders(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS petty_cash_batches_job_order_idx
  ON public.petty_cash_batches(job_order_id);
COMMIT;
