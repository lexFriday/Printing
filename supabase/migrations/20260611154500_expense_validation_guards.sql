-- Expense validation guards for Phase 5.

ALTER TABLE public.job_expenses
  ADD CONSTRAINT job_expenses_amount_positive CHECK (amount > 0) NOT VALID,
  ADD CONSTRAINT job_expenses_not_future_dated CHECK (expense_date <= CURRENT_DATE) NOT VALID;

DROP POLICY IF EXISTS "expenses operations insert" ON public.job_expenses;
DROP POLICY IF EXISTS "expenses operations update" ON public.job_expenses;

CREATE POLICY "expenses operations insert" ON public.job_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_write_operations(auth.uid())
    AND amount > 0
    AND expense_date <= CURRENT_DATE
  );

CREATE POLICY "expenses operations update" ON public.job_expenses
  FOR UPDATE TO authenticated
  USING (public.can_write_operations(auth.uid()))
  WITH CHECK (
    public.can_write_operations(auth.uid())
    AND amount > 0
    AND expense_date <= CURRENT_DATE
  );
