ALTER TABLE public.invoice_payments
  ADD COLUMN IF NOT EXISTS proof_storage_path text,
  ADD COLUMN IF NOT EXISTS proof_file_name text,
  ADD COLUMN IF NOT EXISTS proof_file_type text,
  ADD COLUMN IF NOT EXISTS proof_file_size bigint;

ALTER TABLE public.invoice_payments
  DROP CONSTRAINT IF EXISTS invoice_payments_proof_file_type_check,
  ADD CONSTRAINT invoice_payments_proof_file_type_check
    CHECK (proof_file_type IS NULL OR proof_file_type IN ('image/jpeg', 'image/png', 'image/webp')),
  DROP CONSTRAINT IF EXISTS invoice_payments_proof_file_size_check,
  ADD CONSTRAINT invoice_payments_proof_file_size_check
    CHECK (proof_file_size IS NULL OR (proof_file_size > 0 AND proof_file_size <= 10485760));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invoice-payment-proofs',
  'invoice-payment-proofs',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "invoice payment proof objects read" ON storage.objects;
DROP POLICY IF EXISTS "invoice payment proof objects upload" ON storage.objects;
DROP POLICY IF EXISTS "invoice payment proof objects delete" ON storage.objects;

CREATE POLICY "invoice payment proof objects read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'invoice-payment-proofs'
  AND app_private.can_view_sensitive_operations(auth.uid())
);

CREATE POLICY "invoice payment proof objects upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'invoice-payment-proofs'
  AND app_private.can_write_operations(auth.uid())
);

CREATE POLICY "invoice payment proof objects delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'invoice-payment-proofs'
  AND app_private.can_write_operations(auth.uid())
);

GRANT UPDATE (proof_storage_path, proof_file_name, proof_file_type, proof_file_size)
ON public.invoice_payments TO authenticated;

DROP POLICY IF EXISTS "invoice payments accounting proof update" ON public.invoice_payments;

CREATE POLICY "invoice payments accounting proof update"
ON public.invoice_payments FOR UPDATE TO authenticated
USING (app_private.can_accounting_work(auth.uid()))
WITH CHECK (app_private.can_accounting_work(auth.uid()));
