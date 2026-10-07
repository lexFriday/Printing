ALTER TABLE public.quote_line_items
  ADD COLUMN IF NOT EXISTS adjustment_label TEXT NOT NULL DEFAULT 'Adjustment',
  ADD COLUMN IF NOT EXISTS adjustment_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

UPDATE public.quote_line_items
SET adjustment_label = 'Adjustment'
WHERE adjustment_label IS NULL OR trim(adjustment_label) = '';

ALTER TABLE public.quote_line_items
  DROP CONSTRAINT IF EXISTS quote_line_items_adjustment_label_not_blank,
  ADD CONSTRAINT quote_line_items_adjustment_label_not_blank
  CHECK (trim(adjustment_label) <> '');
