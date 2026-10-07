BEGIN;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS official_receipt_number TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_official_receipt_number_key
  ON public.invoices(official_receipt_number)
  WHERE official_receipt_number IS NOT NULL;

COMMENT ON COLUMN public.invoices.official_receipt_number IS
  'Official Receipt number recorded when the customer collection requires one.';

COMMIT;
