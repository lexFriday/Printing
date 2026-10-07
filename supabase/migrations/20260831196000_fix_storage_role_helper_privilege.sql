-- Storage policies run as the authenticated request role. Keep role checks in
-- the private helper that is already executable by that role; public.has_role
-- is intentionally not a client-callable capability probe.

DROP POLICY IF EXISTS "job order attachment objects delete" ON storage.objects;
DROP POLICY IF EXISTS "job order attachment objects read" ON storage.objects;
DROP POLICY IF EXISTS "job order attachment objects upload" ON storage.objects;

CREATE POLICY "job order attachment objects delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'job-order-attachments'
  AND (
    app_private.has_role(auth.uid(), 'owner')
    OR app_private.has_role(auth.uid(), 'admin')
  )
);

CREATE POLICY "job order attachment objects read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'job-order-attachments'
  AND (
    app_private.has_role(auth.uid(), 'owner')
    OR app_private.has_role(auth.uid(), 'admin')
    OR app_private.has_role(auth.uid(), 'staff')
  )
);

CREATE POLICY "job order attachment objects upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'job-order-attachments'
  AND (
    app_private.has_role(auth.uid(), 'owner')
    OR app_private.has_role(auth.uid(), 'admin')
    OR app_private.has_role(auth.uid(), 'staff')
  )
);
