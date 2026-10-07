CREATE TABLE IF NOT EXISTS public.quote_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size bigint NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE public.quote_attachments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_quote_attachments_quotation
  ON public.quote_attachments(quotation_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.quote_attachments
  DROP CONSTRAINT IF EXISTS quote_attachments_file_type_check,
  ADD CONSTRAINT quote_attachments_file_type_check
    CHECK (file_type IN ('image/jpeg', 'image/png', 'image/webp')),
  DROP CONSTRAINT IF EXISTS quote_attachments_file_size_check,
  ADD CONSTRAINT quote_attachments_file_size_check
    CHECK (file_size > 0 AND file_size <= 10485760);

GRANT SELECT, INSERT, UPDATE ON public.quote_attachments TO authenticated;
GRANT ALL ON public.quote_attachments TO service_role;

DROP POLICY IF EXISTS "quote attachments sensitive read" ON public.quote_attachments;
DROP POLICY IF EXISTS "quote attachments sales insert" ON public.quote_attachments;
DROP POLICY IF EXISTS "quote attachments owner admin delete" ON public.quote_attachments;

CREATE POLICY "quote attachments sensitive read"
ON public.quote_attachments FOR SELECT TO authenticated
USING (
  (
    deleted_at IS NULL
    AND app_private.can_view_sensitive_operations(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.quotations q
      WHERE q.id = quote_attachments.quotation_id
    )
  )
  OR (
    app_private.is_active_user(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role::text IN ('owner', 'admin')
    )
  )
);

CREATE POLICY "quote attachments sales insert"
ON public.quote_attachments FOR INSERT TO authenticated
WITH CHECK (
  deleted_at IS NULL
  AND uploaded_by = auth.uid()
  AND app_private.can_sales_work(auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.quotations q
    WHERE q.id = quote_attachments.quotation_id
  )
);

CREATE POLICY "quote attachments owner admin delete"
ON public.quote_attachments FOR UPDATE TO authenticated
USING (
  deleted_at IS NULL
  AND app_private.is_active_user(auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role::text IN ('owner', 'admin')
  )
)
WITH CHECK (
  app_private.is_active_user(auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role::text IN ('owner', 'admin')
  )
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'quote-attachments',
  'quote-attachments',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "quote attachment objects read" ON storage.objects;
DROP POLICY IF EXISTS "quote attachment objects upload" ON storage.objects;
DROP POLICY IF EXISTS "quote attachment objects delete owner admin" ON storage.objects;

CREATE POLICY "quote attachment objects read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'quote-attachments'
  AND app_private.can_view_sensitive_operations(auth.uid())
);

CREATE POLICY "quote attachment objects upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'quote-attachments'
  AND app_private.can_sales_work(auth.uid())
);

CREATE POLICY "quote attachment objects delete owner admin"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'quote-attachments'
  AND app_private.is_active_user(auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role::text IN ('owner', 'admin')
  )
);
