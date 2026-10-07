ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS inventory_unit TEXT,
  ADD COLUMN IF NOT EXISTS roll_width_ft NUMERIC,
  ADD COLUMN IF NOT EXISTS roll_length_ft NUMERIC;

ALTER TABLE public.materials
  DROP CONSTRAINT IF EXISTS materials_roll_dimensions_positive;

ALTER TABLE public.materials
  ADD CONSTRAINT materials_roll_dimensions_positive
  CHECK (roll_width_ft IS NULL OR roll_width_ft > 0)
  NOT VALID;

ALTER TABLE public.materials
  DROP CONSTRAINT IF EXISTS materials_roll_length_positive;

ALTER TABLE public.materials
  ADD CONSTRAINT materials_roll_length_positive
  CHECK (roll_length_ft IS NULL OR roll_length_ft > 0)
  NOT VALID;

CREATE OR REPLACE FUNCTION public.convert_material_quantity(
  p_material_id UUID,
  p_quantity NUMERIC,
  p_input_unit TEXT
)
RETURNS TABLE(
  entered_quantity NUMERIC,
  entered_unit TEXT,
  inventory_quantity NUMERIC,
  inventory_unit TEXT,
  conversion_factor NUMERIC,
  capacity_description TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  m RECORD;
  u TEXT := lower(trim(coalesce(p_input_unit, '')));
  area_sqft NUMERIC;
  capacity NUMERIC;
  area_to_sqft_factor NUMERIC;
  input_to_ml_factor NUMERIC;
  inventory_to_ml_factor NUMERIC;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero.' USING ERRCODE = '22023';
  END IF;
  SELECT mat.unit, COALESCE(mat.inventory_unit, mat.unit) AS inventory_unit, mat.roll_width_ft, mat.roll_length_ft
    INTO m FROM public.materials AS mat WHERE mat.id = p_material_id AND mat.is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material is unavailable.' USING ERRCODE = '22023'; END IF;
  IF u = '' THEN RAISE EXCEPTION 'Unit is required.' USING ERRCODE = '22023'; END IF;
  IF u = lower(m.inventory_unit) THEN
    RETURN QUERY SELECT p_quantity, p_input_unit, p_quantity, m.inventory_unit, 1::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;
  input_to_ml_factor := CASE
    WHEN u IN ('ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres') THEN 1
    WHEN u IN ('l', 'liter', 'liters', 'litre', 'litres') THEN 1000
    WHEN u IN ('gal', 'gallon', 'gallons', 'us gallon', 'us gallons') THEN 3785.411784
    ELSE NULL
  END;
  inventory_to_ml_factor := CASE lower(m.inventory_unit)
    WHEN 'ml' THEN 1
    WHEN 'liter' THEN 1000
    WHEN 'litre' THEN 1000
    WHEN 'gallon' THEN 3785.411784
    ELSE NULL
  END;
  IF input_to_ml_factor IS NOT NULL AND inventory_to_ml_factor IS NOT NULL THEN
    RETURN QUERY SELECT p_quantity, p_input_unit,
      p_quantity * input_to_ml_factor / inventory_to_ml_factor,
      m.inventory_unit,
      input_to_ml_factor / inventory_to_ml_factor,
      NULL::TEXT;
    RETURN;
  END IF;
  IF lower(m.inventory_unit) <> 'roll' OR m.roll_width_ft IS NULL OR m.roll_length_ft IS NULL THEN
    RAISE EXCEPTION 'Conversion is unavailable for this material.' USING ERRCODE = '22023';
  END IF;
  capacity := m.roll_width_ft * m.roll_length_ft;
  area_to_sqft_factor := CASE
    WHEN u IN ('sqft', 'ft2', 'square feet', 'square foot', 'feet', 'foot') THEN 1
    WHEN u IN ('sqin', 'in2', 'square inches', 'square inch', 'inches', 'inch') THEN 1::NUMERIC / 144
    WHEN u IN ('sqcm', 'cm2', 'square centimeters', 'square centimeter', 'square centimetres', 'square centimetre', 'centimeters', 'centimeter', 'centimetres', 'centimetre', 'cm') THEN 1::NUMERIC / 929.0304
    WHEN u IN ('sqm', 'm2', 'square metres', 'square meters', 'square metre', 'square meter') THEN 10.7639104167
    ELSE NULL
  END;
  IF area_to_sqft_factor IS NULL THEN RAISE EXCEPTION 'Unsupported unit for roll conversion: %.', p_input_unit USING ERRCODE = '22023'; END IF;
  area_sqft := p_quantity * area_to_sqft_factor;
  RETURN QUERY SELECT p_quantity, p_input_unit, area_sqft / capacity, m.inventory_unit,
    area_to_sqft_factor / capacity, format('%s ft × %s ft = %s sq ft per roll', m.roll_width_ft, m.roll_length_ft, round(capacity, 2));
END;
$$;

REVOKE ALL ON FUNCTION public.convert_material_quantity(UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_material_quantity(UUID, NUMERIC, TEXT) TO authenticated;
