-- Minimal replenishment and supplier foundation. Alerts are derived from
-- inventory_balance; no notification rows are stored.
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS reorder_threshold NUMERIC NOT NULL DEFAULT 0
    CHECK (reorder_threshold >= 0);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.suppliers TO authenticated;
DROP POLICY IF EXISTS suppliers_read ON public.suppliers;
DROP POLICY IF EXISTS suppliers_write ON public.suppliers;
CREATE POLICY suppliers_read ON public.suppliers FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY suppliers_write ON public.suppliers FOR INSERT TO authenticated WITH CHECK (public.can_write_operations(auth.uid()));
CREATE POLICY suppliers_update ON public.suppliers FOR UPDATE TO authenticated USING (public.can_write_operations(auth.uid())) WITH CHECK (public.can_write_operations(auth.uid()));

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS ordered_quantity NUMERIC CHECK (ordered_quantity IS NULL OR ordered_quantity > 0),
  ADD COLUMN IF NOT EXISTS ordered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS supplier_reference TEXT;

CREATE OR REPLACE VIEW public.inventory_reorder_attention AS
SELECT m.id AS material_id, m.name, m.unit, m.reorder_threshold,
       b.on_hand, b.reserved, b.available,
       (b.available <= m.reorder_threshold) AS reorder_needed
FROM public.materials m
JOIN LATERAL public.inventory_balance(m.id) b ON true
WHERE m.is_active = true;
GRANT SELECT ON public.inventory_reorder_attention TO authenticated;
