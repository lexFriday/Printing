-- NJL local prototype: operational materials are separate from financial job_expenses.
CREATE TABLE IF NOT EXISTS public.materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  pack_size NUMERIC(14,4),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT materials_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT materials_pack_positive CHECK (pack_size IS NULL OR pack_size > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS materials_name_unique ON public.materials(lower(name));

CREATE TABLE IF NOT EXISTS public.bom_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bom_template_name_not_blank CHECK (length(trim(name)) > 0),
  UNIQUE(name, version)
);
CREATE TABLE IF NOT EXISTS public.bom_template_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_template_id UUID NOT NULL REFERENCES public.bom_templates(id) ON DELETE RESTRICT,
  material_id UUID NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  UNIQUE(bom_template_id, material_id)
);

CREATE OR REPLACE FUNCTION public.prevent_bom_template_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (TG_TABLE_NAME = 'bom_template_components' AND EXISTS (
        SELECT 1 FROM public.job_material_requirements r
        JOIN public.bom_template_components c ON c.bom_template_id = r.source_template_id
        WHERE c.id = OLD.id
      ))
    OR (TG_TABLE_NAME = 'bom_templates' AND EXISTS (
        SELECT 1 FROM public.job_material_requirements WHERE source_template_id = OLD.id
      )) THEN
    RAISE EXCEPTION 'BOM templates used by released jobs are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;
DROP TRIGGER IF EXISTS bom_template_components_immutable ON public.bom_template_components;
CREATE TRIGGER bom_template_components_immutable BEFORE UPDATE OR DELETE ON public.bom_template_components
FOR EACH ROW EXECUTE FUNCTION public.prevent_bom_template_change();
DROP TRIGGER IF EXISTS bom_templates_immutable ON public.bom_templates;
CREATE TRIGGER bom_templates_immutable BEFORE UPDATE OR DELETE ON public.bom_templates
FOR EACH ROW EXECUTE FUNCTION public.prevent_bom_template_change();

CREATE TABLE IF NOT EXISTS public.job_material_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id UUID NOT NULL REFERENCES public.job_orders(id) ON DELETE RESTRICT,
  material_id UUID NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
  source_template_id UUID REFERENCES public.bom_templates(id) ON DELETE RESTRICT,
  planned_quantity NUMERIC(14,4) NOT NULL CHECK (planned_quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_order_id, material_id)
);

DO $$ BEGIN
  CREATE TYPE public.inventory_movement_type AS ENUM ('receipt','reservation','reservation_release','consumption','return','waste','correction');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
  job_order_id UUID REFERENCES public.job_orders(id) ON DELETE RESTRICT,
  movement_type public.inventory_movement_type NOT NULL,
  quantity NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  idempotency_key TEXT UNIQUE,
  notes TEXT,
  created_by UUID REFERENCES auth.users,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(idempotency_key)
);
CREATE INDEX IF NOT EXISTS inventory_movements_material_idx ON public.inventory_movements(material_id, created_at);

CREATE TABLE IF NOT EXISTS public.purchase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id UUID REFERENCES public.job_orders(id) ON DELETE RESTRICT,
  material_id UUID NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
  requested_quantity NUMERIC(14,4) NOT NULL CHECK (requested_quantity > 0),
  received_quantity NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','partially_received','received','cancelled')),
  supplier_name TEXT,
  requested_by UUID REFERENCES auth.users,
  approved_by UUID REFERENCES auth.users,
  created_by UUID REFERENCES auth.users,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.material_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id UUID NOT NULL REFERENCES public.purchase_requests(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  received_by UUID REFERENCES auth.users,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reference_key TEXT UNIQUE
);

-- Posted movements are an audit trail; corrections are compensating rows, never edits.
CREATE OR REPLACE FUNCTION public.prevent_inventory_movement_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'inventory movements are immutable'; END; $$;
DROP TRIGGER IF EXISTS inventory_movement_immutable ON public.inventory_movements;
CREATE TRIGGER inventory_movement_immutable BEFORE UPDATE OR DELETE ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_movement_change();

GRANT SELECT ON public.materials, public.bom_templates, public.bom_template_components,
  public.job_material_requirements, public.inventory_movements, public.purchase_requests, public.material_receipts TO authenticated;
GRANT INSERT, UPDATE ON public.materials, public.bom_templates, public.bom_template_components TO authenticated;
GRANT INSERT ON public.job_material_requirements, public.inventory_movements, public.purchase_requests, public.material_receipts TO authenticated;
GRANT ALL ON public.materials, public.bom_templates, public.bom_template_components,
  public.job_material_requirements, public.inventory_movements, public.purchase_requests, public.material_receipts TO service_role;

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_template_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_material_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY materials_active_read ON public.materials FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY materials_admin_write ON public.materials FOR ALL TO authenticated USING (app_private.has_role(auth.uid(),'admin') AND public.is_active_user(auth.uid())) WITH CHECK (app_private.has_role(auth.uid(),'admin') AND public.is_active_user(auth.uid()));
CREATE POLICY bom_read ON public.bom_templates FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY bom_component_read ON public.bom_template_components FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY bom_admin_write ON public.bom_templates FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') AND public.is_active_user(auth.uid()));
CREATE POLICY bom_component_admin_write ON public.bom_template_components FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') AND public.is_active_user(auth.uid()));
CREATE POLICY material_ops_read ON public.job_material_requirements FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY material_ops_insert ON public.job_material_requirements FOR INSERT TO authenticated WITH CHECK (app_private.has_role(auth.uid(),'admin') OR app_private.has_role(auth.uid(),'staff'));
CREATE POLICY movement_ops_read ON public.inventory_movements FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY movement_ops_insert ON public.inventory_movements FOR INSERT TO authenticated WITH CHECK (app_private.has_role(auth.uid(),'admin') OR app_private.has_role(auth.uid(),'staff'));
CREATE POLICY purchase_ops_read ON public.purchase_requests FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY purchase_ops_insert ON public.purchase_requests FOR INSERT TO authenticated WITH CHECK (app_private.has_role(auth.uid(),'admin') OR app_private.has_role(auth.uid(),'staff'));
CREATE POLICY receipt_ops_read ON public.material_receipts FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY receipt_ops_insert ON public.material_receipts FOR INSERT TO authenticated WITH CHECK (app_private.has_role(auth.uid(),'admin') OR app_private.has_role(auth.uid(),'staff'));

CREATE OR REPLACE FUNCTION public.inventory_balance(p_material_id UUID)
RETURNS TABLE(on_hand NUMERIC, reserved NUMERIC, available NUMERIC)
LANGUAGE SQL STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH totals AS (
    SELECT COALESCE(SUM(CASE WHEN movement_type IN ('receipt','return','correction') THEN quantity WHEN movement_type IN ('consumption','waste') THEN -quantity ELSE 0 END),0) AS on_hand,
           COALESCE(SUM(CASE WHEN movement_type = 'reservation' THEN quantity WHEN movement_type = 'reservation_release' THEN -quantity ELSE 0 END),0) AS reserved
    FROM public.inventory_movements WHERE material_id = p_material_id
  ) SELECT on_hand, reserved, GREATEST(0, on_hand - reserved) FROM totals;
$$;

-- All stock mutations go through these guarded, idempotent functions.  The
-- ledger remains append-only; callers never write movement rows directly.
CREATE OR REPLACE FUNCTION public.reserve_inventory(p_material_id UUID, p_job_order_id UUID, p_quantity NUMERIC, p_idempotency_key TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; v_available NUMERIC;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_quantity <= 0 OR COALESCE(trim(p_idempotency_key),'') = '' THEN RAISE EXCEPTION 'Invalid reservation'; END IF;
  IF EXISTS (SELECT 1 FROM public.job_orders WHERE id = p_job_order_id AND status::text IN ('cancelled','completed')) THEN RAISE EXCEPTION 'Job cannot allocate inventory'; END IF;
  IF EXISTS (SELECT 1 FROM public.production_jobs WHERE job_order_id = p_job_order_id AND status::text IN ('completed','cancelled')) THEN RAISE EXCEPTION 'Production is closed'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_material_id::text));
  SELECT available INTO v_available FROM public.inventory_balance(p_material_id);
  IF COALESCE(v_available,0) < p_quantity THEN RAISE EXCEPTION 'Insufficient available inventory'; END IF;
  INSERT INTO public.inventory_movements(material_id, job_order_id, movement_type, quantity, idempotency_key, created_by)
  VALUES (p_material_id,p_job_order_id,'reservation',p_quantity,p_idempotency_key,auth.uid())
  ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.record_inventory_movement(p_material_id UUID, p_job_order_id UUID, p_movement_type public.inventory_movement_type, p_quantity NUMERIC, p_idempotency_key TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_quantity <= 0 OR COALESCE(trim(p_idempotency_key),'') = '' THEN RAISE EXCEPTION 'Invalid movement'; END IF;
  IF p_movement_type = 'reservation' THEN RAISE EXCEPTION 'Use reserve_inventory for reservations'; END IF;
  IF p_movement_type <> 'receipt' AND p_job_order_id IS NULL THEN RAISE EXCEPTION 'Job is required for this movement'; END IF;
  IF p_job_order_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.job_orders WHERE id = p_job_order_id AND status::text IN ('cancelled','completed')) THEN RAISE EXCEPTION 'Job cannot receive new material activity'; END IF;
  IF p_job_order_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.production_jobs WHERE job_order_id = p_job_order_id AND status::text IN ('completed','cancelled')) THEN RAISE EXCEPTION 'Production is closed'; END IF;
  INSERT INTO public.inventory_movements(material_id,job_order_id,movement_type,quantity,idempotency_key,created_by)
  VALUES (p_material_id,p_job_order_id,p_movement_type,p_quantity,p_idempotency_key,auth.uid())
  ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
