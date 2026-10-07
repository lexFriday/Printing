-- Restore the no-charge quotation contract expected by the current UI.
-- This is forward-only because the original migration is absent from NJL main.
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS is_no_charge BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_charge_reason TEXT;

ALTER TABLE public.quotations
  DROP CONSTRAINT IF EXISTS quotations_no_charge_reason_check;

ALTER TABLE public.quotations
  ADD CONSTRAINT quotations_no_charge_reason_check
  CHECK (NOT is_no_charge OR length(trim(coalesce(no_charge_reason, ''))) > 0);

ALTER TABLE public.quote_line_items
  ADD COLUMN IF NOT EXISTS no_charge BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
