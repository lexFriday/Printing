BEGIN;

-- Keep purchasing, finance, plan release, and final approval unchanged. Only
-- extend the existing production execution RPCs to the dedicated role.
DO $$
DECLARE
  v_signature regprocedure;
  v_definition text;
  v_updated text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.reserve_inventory(uuid,uuid,numeric,text)'::regprocedure,
    'public.record_inventory_movement(uuid,uuid,public.inventory_movement_type,numeric,text)'::regprocedure,
    'public.start_production(uuid,text)'::regprocedure,
    'public.update_production_task(uuid,text,text)'::regprocedure,
    'public.create_shortage_request(uuid,uuid,text)'::regprocedure
  ] LOOP
    SELECT pg_get_functiondef(v_signature) INTO v_definition;
    IF position('has_role(auth.uid(), ''production'')' in v_definition) > 0 THEN
      CONTINUE;
    END IF;
    v_updated := regexp_replace(
      v_definition,
      '(OR\s+public\.has_role\(auth\.uid\(\),\s*''staff''\))',
      E'\\1 OR public.has_role(auth.uid(), ''production'')',
      'g'
    );
    IF v_updated = v_definition THEN
      RAISE EXCEPTION 'Production permission marker not found in %', v_signature;
    END IF;
    EXECUTE v_updated;
  END LOOP;
END $$;

-- Production may record only job-linked execution movements. Inventory
-- receipts and corrections remain Purchasing/Owner/Admin responsibilities.
DO $$
DECLARE
  v_signature regprocedure := 'public.record_inventory_movement(uuid,uuid,public.inventory_movement_type,numeric,text)'::regprocedure;
  v_definition text;
  v_updated text;
BEGIN
  SELECT pg_get_functiondef(v_signature) INTO v_definition;
  IF position('Production can only record job material usage' in v_definition) > 0 THEN
    RETURN;
  END IF;
  v_updated := replace(
    v_definition,
    'IF p_quantity <= 0',
    E'IF public.has_role(auth.uid(), ''production'')\n    AND (p_job_order_id IS NULL OR p_movement_type NOT IN (''consumption'', ''return'', ''waste'')) THEN\n    RAISE EXCEPTION ''Production can only record job material usage'';\n  END IF;\n  IF p_quantity <= 0'
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'Production movement boundary marker not found';
  END IF;
  EXECUTE v_updated;
END $$;

DROP POLICY IF EXISTS production_tasks_update ON public.production_tasks;
CREATE POLICY production_tasks_update ON public.production_tasks
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'admin')
  OR ((public.has_role(auth.uid(), 'staff') OR public.has_role(auth.uid(), 'production'))
      AND (assignee_id = auth.uid() OR assignee_id IS NULL))
)
WITH CHECK (
  public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'admin')
  OR ((public.has_role(auth.uid(), 'staff') OR public.has_role(auth.uid(), 'production'))
      AND (assignee_id = auth.uid() OR assignee_id IS NULL))
);

NOTIFY pgrst, 'reload schema';
COMMIT;
