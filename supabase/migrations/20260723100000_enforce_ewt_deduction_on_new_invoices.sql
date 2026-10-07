-- Enforce the approved EWT treatment for newly generated VATable invoices.
-- Existing invoice snapshots are intentionally not rewritten.

BEGIN;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_amount_due_snapshot_nonnegative,
  ADD CONSTRAINT invoices_amount_due_snapshot_nonnegative
    CHECK (amount_due_snapshot >= 0);

CREATE OR REPLACE FUNCTION public.enforce_new_invoice_ewt_treatment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.tax_type = 'vatable'::public.tax_type AND COALESCE(NEW.ewt_enabled, false) THEN
    NEW.ewt_treatment_snapshot := 'deducted_from_amount_due';
  ELSE
    NEW.ewt_treatment_snapshot := 'reference_only';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_new_invoice_ewt_treatment ON public.invoices;

CREATE TRIGGER trg_enforce_new_invoice_ewt_treatment
BEFORE INSERT ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.enforce_new_invoice_ewt_treatment();

COMMIT;
