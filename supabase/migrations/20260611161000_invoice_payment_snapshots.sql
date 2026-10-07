ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_date DATE;

CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices ON DELETE CASCADE,
  job_order_line_item_id UUID REFERENCES public.job_order_line_items ON DELETE SET NULL,
  description TEXT NOT NULL,
  pricing_mode public.pricing_mode NOT NULL,
  width NUMERIC(12,4),
  height NUMERIC(12,4),
  unit_of_measure public.unit_of_measure,
  computed_sqft NUMERIC(14,4),
  rate_per_sqft NUMERIC(14,2),
  quantity NUMERIC(14,4) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  line_total NUMERIC(14,2) NOT NULL,
  sort_order INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.invoice_line_items TO authenticated;
GRANT ALL ON public.invoice_line_items TO service_role;
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice line active read" ON public.invoice_line_items;
CREATE POLICY "invoice line active read" ON public.invoice_line_items
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "invoice line insert from invoice" ON public.invoice_line_items;
CREATE POLICY "invoice line insert from invoice" ON public.invoice_line_items
  FOR INSERT TO authenticated WITH CHECK (
    public.can_write_operations(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_id
    )
  );

ALTER TABLE public.invoice_line_items
  ADD CONSTRAINT invoice_line_items_quantity_positive CHECK (quantity > 0) NOT VALID,
  ADD CONSTRAINT invoice_line_items_unit_price_nonnegative CHECK (unit_price >= 0) NOT VALID,
  ADD CONSTRAINT invoice_line_items_line_total_nonnegative CHECK (line_total >= 0) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice ON public.invoice_line_items(invoice_id);

CREATE OR REPLACE FUNCTION public.validate_invoice_from_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE j public.job_orders%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public.job_orders WHERE id = NEW.job_order_id;
  IF j.id IS NULL THEN
    RAISE EXCEPTION 'Invoices must be generated from job orders.';
  END IF;
  IF j.status <> 'completed' THEN
    RAISE EXCEPTION 'Complete the Job Order before generating an invoice.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.job_order_line_items WHERE job_order_id = NEW.job_order_id) THEN
    RAISE EXCEPTION 'Invoices require job order line items.';
  END IF;
  NEW.customer_id := j.customer_id;
  NEW.invoice_amount := j.quoted_amount;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.snapshot_invoice_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  INSERT INTO public.invoice_line_items (
    invoice_id,
    job_order_line_item_id,
    description,
    pricing_mode,
    width,
    height,
    unit_of_measure,
    computed_sqft,
    rate_per_sqft,
    quantity,
    unit_price,
    line_total,
    sort_order
  )
  SELECT
    NEW.id,
    jl.id,
    jl.description,
    jl.pricing_mode,
    jl.width,
    jl.height,
    jl.unit_of_measure,
    jl.computed_sqft,
    jl.rate_per_sqft,
    jl.quantity,
    jl.unit_price,
    jl.line_total,
    jl.sort_order
  FROM public.job_order_line_items jl
  WHERE jl.job_order_id = NEW.job_order_id
  ORDER BY COALESCE(jl.sort_order, 0), jl.created_at;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_snapshot_invoice_lines ON public.invoices;
CREATE TRIGGER trg_snapshot_invoice_lines
  AFTER INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_invoice_lines();

CREATE OR REPLACE FUNCTION public.validate_invoice_payment_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'This invoice has already been marked as paid.';
  END IF;

  IF NEW.job_order_id <> OLD.job_order_id
    OR NEW.customer_id <> OLD.customer_id
    OR NEW.invoice_amount <> OLD.invoice_amount
    OR NEW.invoice_date <> OLD.invoice_date
    OR COALESCE(NEW.due_date, DATE '0001-01-01') <> COALESCE(OLD.due_date, DATE '0001-01-01')
    OR NEW.invoice_number <> OLD.invoice_number
  THEN
    RAISE EXCEPTION 'Invoice source and amount are immutable.';
  END IF;

  IF NEW.status <> 'paid' THEN
    RAISE EXCEPTION 'Invoices can only be updated to record payment.';
  END IF;

  IF NEW.payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required.';
  END IF;

  IF NEW.payment_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Future payment dates are not allowed.';
  END IF;

  IF NEW.paid_at IS NULL THEN
    NEW.paid_at := now();
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_invoice_payment_update ON public.invoices;
CREATE TRIGGER trg_validate_invoice_payment_update
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.payment_date IS DISTINCT FROM NEW.payment_date OR OLD.payment_remarks IS DISTINCT FROM NEW.payment_remarks)
  EXECUTE FUNCTION public.validate_invoice_payment_update();
