CREATE OR REPLACE FUNCTION public.apply_quote_derived_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  base_total NUMERIC(14,2);
BEGIN
  NEW.adjustment_label := COALESCE(NULLIF(trim(NEW.adjustment_label), ''), 'Adjustment');
  NEW.adjustment_amount := COALESCE(NEW.adjustment_amount, 0);
  base_total := ROUND(COALESCE(NEW.subtotal, 0) + NEW.adjustment_amount, 2);

  NEW.total_amount := CASE
    WHEN NEW.tax_type = 'vatable' THEN ROUND(base_total * 1.12, 2)
    ELSE base_total
  END;

  RETURN NEW;
END;
$$;
