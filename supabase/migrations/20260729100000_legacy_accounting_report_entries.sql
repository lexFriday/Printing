-- Historical accounting imports stay separate from live workflow records.
CREATE TABLE IF NOT EXISTS public.legacy_accounting_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type text NOT NULL CHECK (entry_type IN ('revenue', 'expense')),
  entry_date date NOT NULL,
  reference_no text,
  document_no text,
  counterparty_name text NOT NULL,
  description text,
  expense_type public.expense_type,
  gross_amount numeric(14,2) NOT NULL CHECK (gross_amount >= 0),
  vat_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  ewt_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (ewt_amount >= 0),
  tin text,
  address text,
  source_workbook text NOT NULL,
  source_sheet text NOT NULL,
  source_row integer NOT NULL CHECK (source_row > 0),
  import_batch text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS legacy_accounting_entries_source_row_key
  ON public.legacy_accounting_entries (source_workbook, source_sheet, source_row, import_batch);

CREATE INDEX IF NOT EXISTS legacy_accounting_entries_type_date_idx
  ON public.legacy_accounting_entries (entry_type, entry_date DESC);

ALTER TABLE public.legacy_accounting_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "legacy accounting read" ON public.legacy_accounting_entries;
CREATE POLICY "legacy accounting read"
  ON public.legacy_accounting_entries FOR SELECT TO authenticated
  USING (app_private.can_view_sensitive_operations(auth.uid()));

GRANT SELECT ON public.legacy_accounting_entries TO authenticated;
GRANT ALL ON public.legacy_accounting_entries TO service_role;

COMMENT ON TABLE public.legacy_accounting_entries IS
  'Read-only reporting source for imported historical accounting records; never treated as live workflow data.';
