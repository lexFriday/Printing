-- Job order snapshots preserve quote line details at conversion time.

CREATE TABLE public.job_order_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id UUID NOT NULL REFERENCES public.job_orders ON DELETE CASCADE,
  quote_line_item_id UUID REFERENCES public.quote_line_items ON DELETE SET NULL,
  description TEXT NOT NULL,
  pricing_mode public.pricing_mode NOT NULL,
  unit_of_measure public.unit_of_measure,
  width NUMERIC(12,4),
  height NUMERIC(12,4),
  quantity NUMERIC(12,2) NOT NULL,
  rate_per_sqft NUMERIC(12,2),
  computed_sqft NUMERIC(14,4),
  unit_price NUMERIC(14,2) NOT NULL,
  line_total NUMERIC(14,2) NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.job_order_line_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.job_order_line_items TO authenticated;
GRANT ALL ON public.job_order_line_items TO service_role;

CREATE INDEX idx_joli_job ON public.job_order_line_items(job_order_id);

CREATE POLICY "joli active read" ON public.job_order_line_items
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "joli operations insert" ON public.job_order_line_items
  FOR INSERT TO authenticated WITH CHECK (public.can_write_operations(auth.uid()));

CREATE OR REPLACE FUNCTION public.snapshot_job_order_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  INSERT INTO public.job_order_line_items (
    job_order_id,
    quote_line_item_id,
    description,
    pricing_mode,
    unit_of_measure,
    width,
    height,
    quantity,
    rate_per_sqft,
    computed_sqft,
    unit_price,
    line_total,
    sort_order
  )
  SELECT
    NEW.id,
    qli.id,
    qli.description,
    qli.pricing_mode,
    qli.unit_of_measure,
    qli.width,
    qli.height,
    qli.quantity,
    qli.rate_per_sqft,
    qli.computed_sqft,
    qli.unit_price,
    qli.line_total,
    qli.sort_order
  FROM public.quote_line_items qli
  WHERE qli.quotation_id = NEW.quotation_id
  ORDER BY qli.sort_order, qli.created_at;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_snapshot_job_order_lines ON public.job_orders;
CREATE TRIGGER trg_snapshot_job_order_lines
  AFTER INSERT ON public.job_orders
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_job_order_lines();
