BEGIN;

CREATE TABLE IF NOT EXISTS public.petty_cash_batch_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  petty_cash_batch_id uuid NOT NULL REFERENCES public.petty_cash_batches(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size >= 0),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS petty_cash_batch_attachments_batch_idx
  ON public.petty_cash_batch_attachments(petty_cash_batch_id, created_at DESC);

ALTER TABLE public.petty_cash_batch_attachments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.petty_cash_batch_attachments TO authenticated;

DROP POLICY IF EXISTS petty_cash_batch_attachments_read ON public.petty_cash_batch_attachments;
CREATE POLICY petty_cash_batch_attachments_read ON public.petty_cash_batch_attachments
  FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS petty_cash_batch_attachments_write ON public.petty_cash_batch_attachments;
CREATE POLICY petty_cash_batch_attachments_write ON public.petty_cash_batch_attachments
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_operations(auth.uid()) AND created_by = auth.uid());

DROP POLICY IF EXISTS petty_cash_batch_attachments_delete ON public.petty_cash_batch_attachments;
CREATE POLICY petty_cash_batch_attachments_delete ON public.petty_cash_batch_attachments
  FOR DELETE TO authenticated
  USING (public.can_write_operations(auth.uid()));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('petty-cash-batch-attachments', 'petty-cash-batch-attachments', false, 0, ARRAY['image/*']::text[])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 0, allowed_mime_types = ARRAY['image/*']::text[];

DROP POLICY IF EXISTS petty_cash_batch_attachment_objects_read ON storage.objects;
CREATE POLICY petty_cash_batch_attachment_objects_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'petty-cash-batch-attachments' AND public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS petty_cash_batch_attachment_objects_upload ON storage.objects;
CREATE POLICY petty_cash_batch_attachment_objects_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'petty-cash-batch-attachments' AND public.can_write_operations(auth.uid()));

DROP POLICY IF EXISTS petty_cash_batch_attachment_objects_delete ON storage.objects;
CREATE POLICY petty_cash_batch_attachment_objects_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'petty-cash-batch-attachments' AND public.can_write_operations(auth.uid()));

COMMIT;
