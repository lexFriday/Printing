ALTER TABLE public.job_expenses
  ADD COLUMN IF NOT EXISTS supplier_document_no TEXT,
  ADD COLUMN IF NOT EXISTS check_number TEXT;

COMMENT ON COLUMN public.job_expenses.supplier_document_no IS
  'Supplier DR/invoice number attached to this payable.';

COMMENT ON COLUMN public.job_expenses.check_number IS
  'Bank check number used to pay this payable.';
