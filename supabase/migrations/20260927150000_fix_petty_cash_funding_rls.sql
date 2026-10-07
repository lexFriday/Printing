-- Allow authorized accounting users to append petty-cash top-ups.
-- Keep the audit owner check and the append-only trigger intact.
DROP POLICY IF EXISTS petty_cash_funding_insert ON public.petty_cash_funding_events;

CREATE POLICY petty_cash_funding_insert
ON public.petty_cash_funding_events
FOR INSERT TO authenticated
WITH CHECK (
  app_private.can_accounting_work(auth.uid())
  AND created_by = auth.uid()
);

GRANT INSERT ON public.petty_cash_funding_events TO authenticated;
