\set ON_ERROR_STOP on

DO $test$
DECLARE
  v_bom UUID;
  v_material UUID;
BEGIN
  SELECT item.job_bom_id, item.material_id
  INTO v_bom, v_material
  FROM public.job_bom_items AS item
  LIMIT 1;

  BEGIN
    INSERT INTO public.job_bom_items(
      job_bom_id,
      material_id,
      planned_quantity,
      unit,
      job_order_line_item_id
    ) VALUES (v_bom, v_material, 1, 'test', NULL);

    RAISE EXCEPTION 'ownerless BOM material was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END
$test$;

DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_bom_items_require_line_owner'
      AND convalidated = FALSE
  ) THEN
    RAISE EXCEPTION 'item ownership constraint is missing or unexpectedly validated';
  END IF;
END
$test$;
