-- Compatibility layer for the legacy Lovable Cloud schema.
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS tin_number text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suppliers' AND column_name='supplier_name') THEN
    EXECUTE 'UPDATE public.suppliers SET name = COALESCE(name, supplier_name) WHERE name IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suppliers' AND column_name='tin') THEN
    EXECUTE 'UPDATE public.suppliers SET tin_number = COALESCE(tin_number, tin) WHERE tin_number IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suppliers' AND column_name='is_active') THEN
    EXECUTE 'UPDATE public.suppliers SET active = COALESCE(active, is_active, true) WHERE active IS NULL';
  END IF;
END $$;

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
