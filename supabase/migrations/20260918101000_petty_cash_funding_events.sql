-- Restores append-only petty-cash funding history for the local Mitzy reports workflow.
BEGIN;

CREATE TABLE IF NOT EXISTS public.petty_cash_funding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  petty_cash_batch_id uuid NOT NULL REFERENCES public.petty_cash_batches(id) ON DELETE RESTRICT,
  funding_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  funding_source text NOT NULL CHECK (btrim(funding_source) <> ''),
  funding_reference text NOT NULL CHECK (btrim(funding_reference) <> ''),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS petty_cash_funding_events_batch_order_idx
  ON public.petty_cash_funding_events(petty_cash_batch_id, funding_date, created_at, id);

ALTER TABLE public.petty_cash_funding_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.petty_cash_funding_events TO authenticated;

DROP POLICY IF EXISTS petty_cash_funding_read ON public.petty_cash_funding_events;
DROP POLICY IF EXISTS petty_cash_funding_insert ON public.petty_cash_funding_events;
CREATE POLICY petty_cash_funding_read ON public.petty_cash_funding_events
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY petty_cash_funding_insert ON public.petty_cash_funding_events
  FOR INSERT TO authenticated WITH CHECK (public.can_write_operations(auth.uid()) AND created_by = auth.uid());

CREATE OR REPLACE FUNCTION public.guard_petty_cash_funding_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Petty cash funding history cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.petty_cash_batches
    WHERE id = NEW.petty_cash_batch_id AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'Cash can only be added to an open petty cash batch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_petty_cash_funding_event ON public.petty_cash_funding_events;
CREATE TRIGGER guard_petty_cash_funding_event
  BEFORE INSERT OR UPDATE OR DELETE ON public.petty_cash_funding_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_petty_cash_funding_event();

DROP TRIGGER IF EXISTS capture_audit_log ON public.petty_cash_funding_events;
CREATE TRIGGER capture_audit_log
  AFTER INSERT ON public.petty_cash_funding_events
  FOR EACH ROW EXECUTE FUNCTION app_private.capture_audit_log();

COMMIT;


