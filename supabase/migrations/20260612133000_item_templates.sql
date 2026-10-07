-- Repeatable item templates for faster quotation line entry.
-- Templates copy defaults into quote line items; quote line items remain the pricing source of truth.

CREATE TABLE IF NOT EXISTS public.item_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  pricing_mode public.pricing_mode NOT NULL,
  default_unit public.unit_of_measure,
  default_rate_per_sqft NUMERIC(12,2),
  default_unit_price NUMERIC(14,2),
  default_width NUMERIC(12,4),
  default_height NUMERIC(12,4),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT item_templates_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT item_templates_description_not_blank CHECK (length(trim(description)) > 0),
  CONSTRAINT item_templates_sqft_defaults CHECK (
    (
      pricing_mode = 'sqft'
      AND default_unit IS NOT NULL
      AND default_rate_per_sqft IS NOT NULL
      AND default_rate_per_sqft > 0
      AND default_unit_price IS NULL
    )
    OR (
      pricing_mode = 'fixed'
      AND default_unit IS NULL
      AND default_rate_per_sqft IS NULL
      AND default_unit_price IS NOT NULL
      AND default_unit_price > 0
    )
  ),
  CONSTRAINT item_templates_dimensions_positive CHECK (
    (default_width IS NULL OR default_width > 0)
    AND (default_height IS NULL OR default_height > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS item_templates_name_unique
  ON public.item_templates (lower(name));

CREATE INDEX IF NOT EXISTS idx_item_templates_active_name
  ON public.item_templates(is_active, name);

DROP TRIGGER IF EXISTS trg_item_templates_touch ON public.item_templates;
CREATE TRIGGER trg_item_templates_touch
  BEFORE UPDATE ON public.item_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.item_templates TO authenticated;
GRANT ALL ON public.item_templates TO service_role;

ALTER TABLE public.item_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "item templates active read" ON public.item_templates;
CREATE POLICY "item templates active read" ON public.item_templates
  FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "item templates admin insert" ON public.item_templates;
CREATE POLICY "item templates admin insert" ON public.item_templates
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "item templates admin update" ON public.item_templates;
CREATE POLICY "item templates admin update" ON public.item_templates
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND public.is_active_user(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND public.is_active_user(auth.uid()));

INSERT INTO public.item_templates (
  name,
  description,
  pricing_mode,
  default_unit,
  default_rate_per_sqft,
  default_unit_price,
  default_width,
  default_height
)
VALUES
  ('Tarpaulin Banner', 'Tarpaulin Banner', 'sqft', 'feet', 180, NULL, NULL, NULL),
  ('Sticker', 'Sticker', 'sqft', 'feet', 180, NULL, NULL, NULL),
  ('Sintra Board', 'Sintra Board', 'sqft', 'feet', 250, NULL, NULL, NULL),
  ('Backdrop', 'Backdrop', 'sqft', 'feet', 180, NULL, NULL, NULL),
  ('A4 Menu Board', 'A4 Menu Board', 'fixed', NULL, NULL, 250, 8.2700, 11.6900),
  ('A4 Detailer', 'A4 Detailer', 'fixed', NULL, NULL, 250, 8.2700, 11.6900)
ON CONFLICT DO NOTHING;
