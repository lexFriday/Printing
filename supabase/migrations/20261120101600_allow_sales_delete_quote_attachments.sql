-- Allow sales and staff users (in addition to owner/admin) to soft-delete
-- quote reference images they can upload.
BEGIN;

DROP POLICY IF EXISTS "quote attachments owner admin delete" ON public.quote_attachments;
DROP POLICY IF EXISTS "quote attachments sales delete" ON public.quote_attachments;

CREATE POLICY "quote attachments sales delete"
ON public.quote_attachments FOR UPDATE TO authenticated
USING (
  deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.id = auth.uid()
      AND p.status = 'active'
      AND ur.role::text IN ('owner', 'admin', 'sales', 'staff')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.id = auth.uid()
      AND p.status = 'active'
      AND ur.role::text IN ('owner', 'admin', 'sales', 'staff')
  )
);

COMMIT;
