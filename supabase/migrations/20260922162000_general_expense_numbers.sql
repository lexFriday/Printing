-- Stable, database-generated reference for every General Expense.
BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.general_expense_number_seq;

ALTER TABLE public.job_expenses
  ADD COLUMN IF NOT EXISTS general_expense_number text,
  ADD COLUMN IF NOT EXISTS tax_type public.tax_type NOT NULL DEFAULT 'non_vat'::public.tax_type;

ALTER TABLE public.job_expenses
  ALTER COLUMN general_expense_number SET DEFAULT (
    'GE-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.general_expense_number_seq')::text, 6, '0')
  );

UPDATE public.job_expenses
SET general_expense_number = 'GE-' || to_char(COALESCE(expense_date, current_date), 'YYYY') || '-' || lpad(nextval('public.general_expense_number_seq')::text, 6, '0')
WHERE general_expense_number IS NULL;

ALTER TABLE public.job_expenses
  ALTER COLUMN general_expense_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS job_expenses_general_expense_number_key
  ON public.job_expenses(general_expense_number);

COMMIT;
