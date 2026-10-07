-- Keep existing operational RPC contracts; replace their raw BOM quantity
-- comparisons with the canonical inventory snapshot at the data boundary.
DO $$
DECLARE r RECORD;
DECLARE d TEXT;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure AS signature, pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND (pg_get_functiondef(p.oid) LIKE '%item.planned_quantity%'
        OR pg_get_functiondef(p.oid) LIKE '%i.planned_quantity%')
      AND p.proname IN ('production_material_readiness','production_item_readiness','create_shortage_request','request_missing_production_materials','reserve_production_item_inventory')
  LOOP
    d := regexp_replace(r.definition, 'item\.planned_quantity', 'COALESCE(item.inventory_quantity, item.planned_quantity)', 'g');
    d := replace(d, 'SUM(i.planned_quantity)', 'SUM(COALESCE(i.inventory_quantity, i.planned_quantity))');
    IF d <> r.definition THEN EXECUTE d; END IF;
  END LOOP;
END $$;

DO $$
DECLARE r RECORD; d TEXT;
BEGIN
  FOR r IN
    SELECT p.oid, pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='create_shortage_request'
  LOOP
    d := replace(r.definition, 'SUM(item.planned_quantity)', 'SUM(COALESCE(item.inventory_quantity, item.planned_quantity))');
    IF d <> r.definition THEN EXECUTE d; END IF;
  END LOOP;
END $$;
