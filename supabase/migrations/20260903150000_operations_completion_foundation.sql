-- Local-first completion foundation: locations, count sessions, and actionable notifications.
-- These are additive and keep the movement ledger as the stock SSOT.

CREATE TABLE IF NOT EXISTS public.stock_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_locations_code_unique ON public.stock_locations(lower(code));

INSERT INTO public.stock_locations (name, code)
VALUES ('Main stockroom', 'MAIN')
ON CONFLICT (lower(code)) DO NOTHING;

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.stock_locations(id) ON DELETE RESTRICT;
ALTER TABLE public.inventory_movements DISABLE TRIGGER inventory_movement_immutable;
UPDATE public.inventory_movements
SET location_id = (SELECT id FROM public.stock_locations WHERE code = 'MAIN')
WHERE location_id IS NULL;
ALTER TABLE public.inventory_movements ENABLE TRIGGER inventory_movement_immutable;
CREATE OR REPLACE FUNCTION public.set_default_stock_location() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.location_id IS NULL THEN NEW.location_id := (SELECT id FROM public.stock_locations WHERE code = 'MAIN' LIMIT 1); END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS inventory_movement_default_location ON public.inventory_movements;
CREATE TRIGGER inventory_movement_default_location BEFORE INSERT ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.set_default_stock_location();

CREATE INDEX IF NOT EXISTS inventory_movements_location_idx
  ON public.inventory_movements(location_id, material_id, created_at);

CREATE TABLE IF NOT EXISTS public.inventory_count_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.stock_locations(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','approved','cancelled')),
  counted_by UUID NOT NULL REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS public.inventory_count_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.inventory_count_sessions(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
  system_quantity NUMERIC NOT NULL,
  counted_quantity NUMERIC NOT NULL CHECK (counted_quantity >= 0),
  correction_movement_id UUID REFERENCES public.inventory_movements(id),
  UNIQUE(session_id, material_id)
);

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('needs_action','waiting','update')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  dedupe_key TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS user_notifications_inbox_idx
  ON public.user_notifications(user_id, archived_at, read_at, created_at DESC);

ALTER TABLE public.stock_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_locations_read ON public.stock_locations;
CREATE POLICY stock_locations_read ON public.stock_locations FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
DROP POLICY IF EXISTS inventory_count_read ON public.inventory_count_sessions;
CREATE POLICY inventory_count_read ON public.inventory_count_sessions FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
DROP POLICY IF EXISTS inventory_count_lines_read ON public.inventory_count_lines;
CREATE POLICY inventory_count_lines_read ON public.inventory_count_lines FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
DROP POLICY IF EXISTS notifications_own_read ON public.user_notifications;
CREATE POLICY notifications_own_read ON public.user_notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS notifications_own_update ON public.user_notifications;
CREATE POLICY notifications_own_update ON public.user_notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT SELECT ON public.stock_locations, public.inventory_count_sessions, public.inventory_count_lines, public.user_notifications TO authenticated;
GRANT UPDATE ON public.user_notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.create_inventory_transfer(
  p_material_id UUID, p_from_location UUID, p_to_location UUID, p_quantity NUMERIC, p_idempotency_key TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'owner or admin required'; END IF;
  IF p_from_location = p_to_location OR p_quantity <= 0 OR nullif(trim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'invalid transfer'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_material_id::text));
  IF (SELECT available FROM public.inventory_balance(p_material_id)) < p_quantity THEN RAISE EXCEPTION 'insufficient available inventory'; END IF;
  INSERT INTO public.inventory_movements(material_id, location_id, movement_type, quantity, idempotency_key, created_by, notes)
  VALUES (p_material_id, p_from_location, 'consumption', p_quantity, p_idempotency_key || ':out', auth.uid(), 'Transfer to ' || p_to_location)
  RETURNING id INTO v_id;
  INSERT INTO public.inventory_movements(material_id, location_id, movement_type, quantity, idempotency_key, created_by, notes)
  VALUES (p_material_id, p_to_location, 'receipt', p_quantity, p_idempotency_key || ':in', auth.uid(), 'Transfer from ' || p_from_location);
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_inventory_transfer(UUID,UUID,UUID,NUMERIC,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_reorder_notification(
  p_material_id UUID, p_title TEXT, p_body TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; u UUID;
BEGIN
  SELECT id, name INTO r FROM public.materials WHERE id = p_material_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'material not found'; END IF;
  FOR u IN SELECT id FROM auth.users WHERE deleted_at IS NULL LOOP
    INSERT INTO public.user_notifications(user_id, kind, title, body, source_type, source_id, dedupe_key)
    VALUES (u, 'needs_action', p_title, p_body, 'material', p_material_id, 'reorder:' || p_material_id)
    ON CONFLICT (user_id, dedupe_key) DO UPDATE SET body = EXCLUDED.body, archived_at = NULL;
  END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_reorder_notification(UUID,TEXT,TEXT) TO authenticated;
