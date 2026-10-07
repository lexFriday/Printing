ALTER TABLE public.quote_attachments
  ADD COLUMN IF NOT EXISTS quote_line_item_id uuid;

ALTER TABLE public.quote_attachments
  DROP CONSTRAINT IF EXISTS quote_attachments_quote_line_item_id_fkey,
  ADD CONSTRAINT quote_attachments_quote_line_item_id_fkey
  FOREIGN KEY (quote_line_item_id)
  REFERENCES public.quote_line_items(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quote_attachments_line_item
  ON public.quote_attachments(quote_line_item_id)
  WHERE deleted_at IS NULL;
