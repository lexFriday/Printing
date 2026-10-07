DO $$
DECLARE
  fn TEXT;
  rewritten TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.production_material_readiness(uuid)',
    'public.production_item_readiness(uuid)',
    'public.request_missing_production_materials(uuid,uuid[],text)'
  ] LOOP
    SELECT pg_get_functiondef(fn::regprocedure) INTO rewritten;
    IF rewritten IS NOT NULL THEN
      rewritten := replace(rewritten, 'SUM(item.planned_quantity)', 'SUM(COALESCE(item.inventory_quantity, item.planned_quantity))');
      rewritten := replace(rewritten, 'SUM(i.planned_quantity)', 'SUM(COALESCE(i.inventory_quantity, i.planned_quantity))');
      rewritten := replace(rewritten, 'SUM(item.planned_quantity)', 'SUM(COALESCE(item.inventory_quantity, item.planned_quantity))');
      EXECUTE rewritten;
    END IF;
  END LOOP;
EXCEPTION WHEN undefined_function THEN
  NULL;
END $$;

DO $$
DECLARE rewritten TEXT;
BEGIN
  SELECT pg_get_functiondef('public.reconcile_production(uuid,text,text)'::regprocedure) INTO rewritten;
  rewritten := replace(rewritten, 'SUM(i.planned_quantity)', 'SUM(COALESCE(i.inventory_quantity,i.planned_quantity))');
  EXECUTE rewritten;
END $$;

DO $$
DECLARE rewritten TEXT;
BEGIN
  SELECT pg_get_functiondef('public.production_material_readiness(uuid)'::regprocedure) INTO rewritten;
  rewritten := replace(rewritten, 'SUM(item.planned_quantity)', 'SUM(COALESCE(item.inventory_quantity,item.planned_quantity))');
  EXECUTE rewritten;
END $$;

DO $$
DECLARE rewritten TEXT;
BEGIN
  SELECT pg_get_functiondef('public.create_shortage_request(uuid,uuid,text)'::regprocedure) INTO rewritten;
  rewritten := replace(rewritten, 'SUM(item.planned_quantity)', 'SUM(COALESCE(item.inventory_quantity,item.planned_quantity))');
  EXECUTE rewritten;
END $$;
