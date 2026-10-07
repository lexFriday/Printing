-- Material metadata and opening stock must succeed or fail together. Stock remains
-- derived exclusively from the immutable inventory movement ledger.
CREATE OR REPLACE FUNCTION public.import_materials_with_opening_stock(
  p_rows JSONB,
  p_import_key TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  material RECORD;
  material_id UUID;
  imported_count INTEGER := 0;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Owner or Admin access is required to import materials';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) < 1
    OR jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'Import must contain between 1 and 5000 materials';
  END IF;
  IF nullif(trim(p_import_key), '') IS NULL THEN
    RAISE EXCEPTION 'Import key is required';
  END IF;

  FOR material IN
    SELECT *
    FROM jsonb_to_recordset(p_rows) AS row(
      name TEXT,
      unit TEXT,
      category TEXT,
      reorder_threshold NUMERIC,
      pack_size NUMERIC,
      starting_quantity NUMERIC
    )
  LOOP
    IF nullif(trim(material.name), '') IS NULL
      OR nullif(trim(material.unit), '') IS NULL
      OR nullif(trim(material.category), '') IS NULL THEN
      RAISE EXCEPTION 'Material name, unit, and category are required';
    END IF;
    IF material.reorder_threshold IS NULL OR material.reorder_threshold < 0
      OR material.pack_size IS NULL OR material.pack_size <= 0 THEN
      RAISE EXCEPTION 'Invalid reorder threshold or units per pack';
    END IF;
    IF material.starting_quantity IS NULL THEN
      RAISE EXCEPTION 'Starting quantity is required';
    END IF;
    IF material.starting_quantity < 0 THEN
      RAISE EXCEPTION 'Starting quantity must be zero or greater';
    END IF;

    INSERT INTO public.materials(
      name, unit, category, reorder_threshold, pack_size, is_active
    ) VALUES (
      trim(material.name), trim(material.unit), trim(material.category),
      material.reorder_threshold, material.pack_size, true
    )
    RETURNING id INTO material_id;

    IF material.starting_quantity > 0 THEN
      INSERT INTO public.inventory_movements(
        material_id, movement_type, quantity, idempotency_key, notes, created_by
      ) VALUES (
        material_id, 'receipt', material.starting_quantity,
        p_import_key || ':' || imported_count,
        'Starting stock from material import', auth.uid()
      );
    END IF;
    imported_count := imported_count + 1;
  END LOOP;

  RETURN imported_count;
END;
$$;

REVOKE ALL ON FUNCTION public.import_materials_with_opening_stock(JSONB, TEXT)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_materials_with_opening_stock(JSONB, TEXT)
TO authenticated;

NOTIFY pgrst, 'reload schema';
