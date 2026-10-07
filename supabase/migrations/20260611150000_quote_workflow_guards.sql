-- Quote workflow guards: draft is editable, sent/approved/rejected are historical.

ALTER TABLE public.quote_line_items
  ADD CONSTRAINT quote_line_items_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT quote_line_items_unit_price_nonnegative CHECK (unit_price >= 0),
  ADD CONSTRAINT quote_line_items_line_total_nonnegative CHECK (line_total >= 0),
  ADD CONSTRAINT quote_line_items_sqft_values_valid CHECK (
    (
      pricing_mode = 'sqft'
      AND unit_of_measure IS NOT NULL
      AND width > 0
      AND height > 0
      AND rate_per_sqft > 0
      AND computed_sqft > 0
    )
    OR (
      pricing_mode = 'fixed'
      AND unit_of_measure IS NULL
      AND width IS NULL
      AND height IS NULL
      AND rate_per_sqft IS NULL
      AND computed_sqft IS NULL
    )
  );

CREATE OR REPLACE FUNCTION public.validate_quote_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF NEW.customer_id <> OLD.customer_id
      OR NEW.project_name <> OLD.project_name
      OR NEW.quote_date <> OLD.quote_date
      OR COALESCE(NEW.remarks, '') <> COALESCE(OLD.remarks, '')
      OR NEW.subtotal <> OLD.subtotal
      OR NEW.total_amount <> OLD.total_amount THEN
      RAISE EXCEPTION 'Only draft quotations can be edited.';
    END IF;
  END IF;

  IF NEW.status <> OLD.status THEN
    IF OLD.status = 'draft' AND NEW.status <> 'sent' THEN
      RAISE EXCEPTION 'Draft quotations must be sent before approval or rejection.';
    END IF;
    IF OLD.status = 'sent' AND NEW.status NOT IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Sent quotations can only be approved or rejected.';
    END IF;
    IF OLD.status IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Final quotation statuses cannot be changed.';
    END IF;
    IF NEW.status IN ('sent', 'approved') AND NEW.total_amount <= 0 THEN
      RAISE EXCEPTION 'Quote total must be greater than zero.';
    END IF;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_quote_update ON public.quotations;
CREATE TRIGGER trg_validate_quote_update
  BEFORE UPDATE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.validate_quote_update();
