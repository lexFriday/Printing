-- Quote material forecasts are internal snapshots. Job Order BOMs are the
-- operational snapshot; inventory_movements remains stock truth.
ALTER TABLE public.quote_line_items
  ADD COLUMN IF NOT EXISTS item_template_id UUID REFERENCES public.item_templates(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS item_template_version INTEGER DEFAULT 1;

DO $$ BEGIN
  CREATE TYPE public.material_component_basis AS ENUM ('per_item','per_sqft','fixed_per_line');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.item_template_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_template_id UUID NOT NULL REFERENCES public.item_templates(id) ON DELETE RESTRICT,
  material_id UUID NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  basis public.material_component_basis NOT NULL DEFAULT 'per_item',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(item_template_id, material_id, basis)
);
CREATE INDEX IF NOT EXISTS item_template_materials_template_idx ON public.item_template_materials(item_template_id);
ALTER TABLE public.item_template_materials ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.item_template_materials TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.item_template_materials TO authenticated;
DROP POLICY IF EXISTS item_template_materials_read ON public.item_template_materials;
DROP POLICY IF EXISTS item_template_materials_admin_write ON public.item_template_materials;
CREATE POLICY item_template_materials_read ON public.item_template_materials FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY item_template_materials_admin_write ON public.item_template_materials FOR ALL TO authenticated USING (app_private.has_role(auth.uid(),'admin') OR app_private.has_role(auth.uid(),'owner')) WITH CHECK (app_private.has_role(auth.uid(),'admin') OR app_private.has_role(auth.uid(),'owner'));

CREATE TABLE IF NOT EXISTS public.quote_material_estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  quote_line_item_id UUID NOT NULL REFERENCES public.quote_line_items(id) ON DELETE CASCADE,
  item_template_id UUID REFERENCES public.item_templates(id) ON DELETE RESTRICT,
  item_template_version INTEGER NOT NULL DEFAULT 1,
  material_id UUID NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
  material_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  basis public.material_component_basis NOT NULL,
  component_quantity NUMERIC NOT NULL CHECK (component_quantity > 0),
  estimated_quantity NUMERIC NOT NULL CHECK (estimated_quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quote_material_estimates_quote_idx ON public.quote_material_estimates(quotation_id);
ALTER TABLE public.quote_material_estimates ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.quote_material_estimates TO authenticated;
CREATE POLICY quote_material_estimates_read ON public.quote_material_estimates FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

-- Preserve the existing commercial snapshot trigger and add material snapshots
-- after line insertion. The application supplies the calculated estimate rows.
COMMENT ON TABLE public.quote_material_estimates IS 'Internal staff-only material forecast; immutable after quote submission.';

CREATE OR REPLACE FUNCTION public.snapshot_quote_materials(p_quotation_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF EXISTS (SELECT 1 FROM public.quotations WHERE id=p_quotation_id AND status::text NOT IN ('draft','pending_manager_approval','pending_customer_approval')) THEN RAISE EXCEPTION 'quote materials are locked'; END IF;
  DELETE FROM public.quote_material_estimates WHERE quotation_id=p_quotation_id;
  INSERT INTO public.quote_material_estimates (quotation_id,quote_line_item_id,item_template_id,item_template_version,material_id,material_name,unit,basis,component_quantity,estimated_quantity)
  SELECT q.id,l.id,l.item_template_id,COALESCE(l.item_template_version,1),m.id,m.name,m.unit,tm.basis,tm.quantity,
    CASE tm.basis WHEN 'per_item' THEN tm.quantity*l.quantity WHEN 'per_sqft' THEN tm.quantity*COALESCE(l.computed_sqft,0)*l.quantity ELSE tm.quantity END
  FROM public.quote_line_items l JOIN public.quotations q ON q.id=l.quotation_id
  JOIN public.item_template_materials tm ON tm.item_template_id=l.item_template_id
  JOIN public.materials m ON m.id=tm.material_id
  WHERE q.id=p_quotation_id AND (
    (tm.basis <> 'per_sqft') OR COALESCE(l.computed_sqft,0) > 0
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.snapshot_quote_materials(UUID) TO authenticated;
