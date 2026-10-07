-- Imported/local invoices can advance the visible number without advancing
-- the sequence. Keep the next generated invoice number collision-free.
WITH invoice_max AS (
  SELECT COALESCE(
    MAX(NULLIF(regexp_replace(invoice_number, '^INV-[0-9]{4}-', ''), '')::BIGINT),
    0
  ) AS value
  FROM public.invoices
)
SELECT setval(
  'public.seq_invoice_no',
  GREATEST(invoice_max.value, 1),
  invoice_max.value > 0
)
FROM invoice_max;
