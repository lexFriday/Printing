-- Payment proof files use the same authorization boundary as invoice payments.
-- Owner, admin, accounting, and staff may record payments and attach proofs.
DROP POLICY IF EXISTS "invoice payment proof objects upload" ON storage.objects;
CREATE POLICY "invoice payment proof objects upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'invoice-payment-proofs'
  AND app_private.can_accounting_work(auth.uid())
);

DROP POLICY IF EXISTS "invoice payment proof objects delete" ON storage.objects;
CREATE POLICY "invoice payment proof objects delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'invoice-payment-proofs'
  AND app_private.can_accounting_work(auth.uid())
);
