-- Preserve real imported transactions whose source workbook has no date.
-- Reports can still group these rows by source_sheet without inventing a date.
ALTER TABLE public.legacy_accounting_entries
  ALTER COLUMN entry_date DROP NOT NULL;
