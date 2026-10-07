ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'draft' BEFORE 'issued';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS quotation_id UUID REFERENCES public.quotations(id) ON DELETE RESTRICT;

UPDATE public.invoices AS invoice
SET quotation_id = job.quotation_id
FROM public.job_orders AS job
WHERE invoice.job_order_id = job.id
  AND invoice.quotation_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_quotation_id_unique
  ON public.invoices(quotation_id)
  WHERE quotation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_quotation_id_idx
  ON public.invoices(quotation_id);

