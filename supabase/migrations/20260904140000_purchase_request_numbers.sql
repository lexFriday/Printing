CREATE SEQUENCE IF NOT EXISTS public.purchase_request_number_seq;

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS purchase_number TEXT;

UPDATE public.purchase_requests
SET purchase_number = 'PR-' || to_char(created_at, 'YYYY') || '-' || lpad(nextval('public.purchase_request_number_seq')::text, 4, '0')
WHERE purchase_number IS NULL;

ALTER TABLE public.purchase_requests
  ALTER COLUMN purchase_number SET NOT NULL,
  ALTER COLUMN purchase_number SET DEFAULT ('PR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.purchase_request_number_seq')::text, 4, '0'));

CREATE UNIQUE INDEX IF NOT EXISTS purchase_requests_purchase_number_idx
  ON public.purchase_requests(purchase_number);
