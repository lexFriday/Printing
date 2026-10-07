BEGIN;

-- Keep the mature workflow implementations intact, but put them behind one
-- project-assignment boundary. The implementation functions are private and
-- cannot be called through PostgREST.
ALTER FUNCTION public.get_production_job(UUID) SET SCHEMA app_private;
ALTER FUNCTION public.production_material_readiness(UUID) SET SCHEMA app_private;
ALTER FUNCTION public.production_item_readiness(UUID) SET SCHEMA app_private;
ALTER FUNCTION public.reserve_inventory(UUID, UUID, NUMERIC, TEXT) SET SCHEMA app_private;
ALTER FUNCTION public.record_inventory_movement(UUID, UUID, public.inventory_movement_type, NUMERIC, TEXT) SET SCHEMA app_private;
ALTER FUNCTION public.record_production_material_activity(UUID, UUID, public.inventory_movement_type, NUMERIC, TEXT) SET SCHEMA app_private;
ALTER FUNCTION public.start_production(UUID, TEXT) SET SCHEMA app_private;
ALTER FUNCTION public.create_shortage_request(UUID, UUID, TEXT) SET SCHEMA app_private;
ALTER FUNCTION public.reconcile_production(UUID, TEXT, TEXT) SET SCHEMA app_private;
ALTER FUNCTION public.complete_production(UUID, TEXT) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.get_production_job(UUID) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.production_material_readiness(UUID) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.production_item_readiness(UUID) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.reserve_inventory(UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.record_inventory_movement(UUID, UUID, public.inventory_movement_type, NUMERIC, TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.record_production_material_activity(UUID, UUID, public.inventory_movement_type, NUMERIC, TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.start_production(UUID, TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.create_shortage_request(UUID, UUID, TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.reconcile_production(UUID, TEXT, TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION app_private.complete_production(UUID, TEXT) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.get_production_job(p_job_order_id UUID)
RETURNS public.production_jobs
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN RETURN NULL; END IF;
  RETURN app_private.get_production_job(p_job_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.production_material_readiness(p_job_order_id UUID)
RETURNS TABLE(material_id UUID, planned_quantity NUMERIC, reserved_quantity NUMERIC, shortage_quantity NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM app_private.production_material_readiness(p_job_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.production_item_readiness(p_job_order_id UUID)
RETURNS TABLE(
  job_order_line_item_id UUID, description TEXT, quantity NUMERIC, status TEXT,
  required_materials JSONB, shortage_materials JSONB, next_action TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM app_private.production_item_readiness(p_job_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_inventory(
  p_material_id UUID, p_job_order_id UUID, p_quantity NUMERIC, p_idempotency_key TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  RETURN app_private.reserve_inventory(p_material_id, p_job_order_id, p_quantity, p_idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_inventory_movement(
  p_material_id UUID, p_job_order_id UUID, p_movement_type public.inventory_movement_type,
  p_quantity NUMERIC, p_idempotency_key TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF p_job_order_id IS NOT NULL AND NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  RETURN app_private.record_inventory_movement(p_material_id, p_job_order_id, p_movement_type, p_quantity, p_idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_production_material_activity(
  p_material_id UUID, p_job_order_id UUID, p_movement_type public.inventory_movement_type,
  p_quantity NUMERIC, p_idempotency_key TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  RETURN app_private.record_production_material_activity(p_material_id, p_job_order_id, p_movement_type, p_quantity, p_idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_production(p_job_order_id UUID, p_idempotency_key TEXT)
RETURNS public.production_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  RETURN app_private.start_production(p_job_order_id, p_idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_shortage_request(
  p_job_order_id UUID, p_material_id UUID, p_idempotency_key TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  RETURN app_private.create_shortage_request(p_job_order_id, p_material_id, p_idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_production(
  p_job_order_id UUID, p_decision TEXT, p_reason TEXT DEFAULT NULL
)
RETURNS public.production_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  IF public.has_role(auth.uid(), 'production') AND p_decision = 'accept'
    AND EXISTS (
      SELECT 1 FROM public.production_material_exceptions
      WHERE job_order_id = p_job_order_id AND status = 'pending'
    ) THEN
    RAISE EXCEPTION 'Production workers cannot approve protected exceptions.';
  END IF;
  RETURN app_private.reconcile_production(p_job_order_id, p_decision, p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_production(p_job_order_id UUID, p_idempotency_key TEXT)
RETURNS public.production_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
BEGIN
  IF NOT public.can_access_production_job(auth.uid(), p_job_order_id) THEN
    RAISE EXCEPTION 'Production workers can only update assigned Job Orders.';
  END IF;
  RETURN app_private.complete_production(p_job_order_id, p_idempotency_key);
END;
$$;

-- Workers may execute a normal close-out, but an exception still requires an
-- Owner/Admin decision. These private implementations preserve existing status
-- transitions while aligning ordinary execution with assigned worker access.
CREATE OR REPLACE FUNCTION app_private.reconcile_production(
  p_job_order_id UUID, p_decision TEXT, p_reason TEXT DEFAULT NULL
)
RETURNS public.production_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
DECLARE v_result public.production_jobs%ROWTYPE; v_planned NUMERIC; v_consumed NUMERIC;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff') OR public.has_role(auth.uid(),'production')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_decision NOT IN ('accept','request_approval') THEN RAISE EXCEPTION 'invalid reconciliation decision'; END IF;
  SELECT COALESCE(SUM(i.planned_quantity),0) INTO v_planned FROM public.job_bom_items i JOIN public.job_boms b ON b.id=i.job_bom_id WHERE b.job_order_id=p_job_order_id;
  SELECT COALESCE(SUM(CASE WHEN movement_type IN ('consumption','waste') THEN quantity WHEN movement_type='return' THEN -quantity ELSE 0 END),0) INTO v_consumed FROM public.inventory_movements WHERE job_order_id=p_job_order_id;
  IF v_consumed > v_planned AND p_decision <> 'request_approval' AND NOT public.has_role(auth.uid(),'admin') AND NOT public.has_role(auth.uid(),'owner') THEN
    RAISE EXCEPTION 'over-consumption requires Owner or Admin approval';
  END IF;
  UPDATE public.production_jobs SET status=(CASE WHEN p_decision='request_approval' OR v_consumed>v_planned THEN 'awaiting_approval' ELSE 'for_reconciliation' END)::public.production_status, notes=COALESCE(NULLIF(trim(p_reason),''),notes), updated_at=now() WHERE job_order_id=p_job_order_id RETURNING * INTO v_result;
  IF NOT FOUND THEN RAISE EXCEPTION 'production plan not found'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.complete_production(p_job_order_id UUID, p_idempotency_key TEXT)
RETURNS public.production_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp AS $$
DECLARE v_result public.production_jobs%ROWTYPE;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff') OR public.has_role(auth.uid(),'production')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key='' THEN RAISE EXCEPTION 'idempotency key required'; END IF;
  UPDATE public.production_jobs SET status='completed',completed_at=COALESCE(completed_at,now()),updated_at=now()
    WHERE job_order_id=p_job_order_id AND status='for_reconciliation' RETURNING * INTO v_result;
  IF NOT FOUND THEN RAISE EXCEPTION 'production must be reconciled before completion'; END IF;
  UPDATE public.job_orders SET status='in_production', updated_at=now() WHERE id=p_job_order_id AND status='pending';
  UPDATE public.job_orders SET status='ready', ready_at=COALESCE(ready_at,now()), updated_at=now() WHERE id=p_job_order_id AND status='in_production';
  IF NOT FOUND THEN RAISE EXCEPTION 'job order is not ready for completion'; END IF;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_production_job(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.production_material_readiness(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.production_item_readiness(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_inventory(UUID, UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_inventory_movement(UUID, UUID, public.inventory_movement_type, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_production_material_activity(UUID, UUID, public.inventory_movement_type, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_production(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_shortage_request(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_production(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_production(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_current_production_user()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.is_active_user(auth.uid()) AND public.has_role(auth.uid(), 'production');
$$;
REVOKE ALL ON FUNCTION public.is_current_production_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_current_production_user() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_assign_production(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.is_active_user(p_user_id)
    AND (public.has_role(p_user_id, 'owner') OR public.has_role(p_user_id, 'admin'));
$$;
REVOKE ALL ON FUNCTION public.can_assign_production(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_assign_production(UUID) TO authenticated;

-- Direct table policies keep non-Production operational roles unchanged while
-- restricting Production accounts to project assignments.
DROP POLICY IF EXISTS production_jobs_read ON public.production_jobs;
CREATE POLICY production_jobs_read ON public.production_jobs FOR SELECT TO authenticated USING (
  (public.is_current_production_user() AND public.can_access_production_job(auth.uid(), job_order_id))
  OR (NOT public.is_current_production_user() AND app_private.can_read_operations(auth.uid()))
);
DROP POLICY IF EXISTS job_boms_read ON public.job_boms;
CREATE POLICY job_boms_read ON public.job_boms FOR SELECT TO authenticated USING (
  (public.is_current_production_user() AND public.can_access_production_job(auth.uid(), job_order_id))
  OR (NOT public.is_current_production_user() AND app_private.can_read_operations(auth.uid()))
);
DROP POLICY IF EXISTS job_bom_items_read ON public.job_bom_items;
CREATE POLICY job_bom_items_read ON public.job_bom_items FOR SELECT TO authenticated USING (
  (public.is_current_production_user() AND EXISTS (
      SELECT 1 FROM public.job_boms bom
      WHERE bom.id = job_bom_id AND public.can_access_production_job(auth.uid(), bom.job_order_id)
  )) OR (NOT public.is_current_production_user() AND app_private.can_read_operations(auth.uid()))
);
DROP POLICY IF EXISTS production_exception_read ON public.production_material_exceptions;
CREATE POLICY production_exception_read ON public.production_material_exceptions FOR SELECT TO authenticated USING (
  (public.is_current_production_user() AND public.can_access_production_job(auth.uid(), job_order_id))
  OR (NOT public.is_current_production_user() AND app_private.can_read_operations(auth.uid()))
);
DROP POLICY IF EXISTS purchase_ops_read ON public.purchase_requests;
CREATE POLICY purchase_ops_read ON public.purchase_requests FOR SELECT TO authenticated USING (
  (public.is_current_production_user() AND job_order_id IS NOT NULL AND public.can_access_production_job(auth.uid(), job_order_id))
  OR (NOT public.is_current_production_user() AND app_private.can_read_operations(auth.uid()))
);

DROP POLICY IF EXISTS production_job_assignments_read ON public.production_job_assignments;
CREATE POLICY production_job_assignments_read ON public.production_job_assignments FOR SELECT TO authenticated USING (
  public.is_active_user(auth.uid()) AND (
    user_id = auth.uid()
    OR public.can_assign_production(auth.uid())
  )
);

DROP POLICY IF EXISTS production_tasks_read ON public.production_tasks;
CREATE POLICY production_tasks_read ON public.production_tasks FOR SELECT TO authenticated
USING (public.can_access_production_job(auth.uid(), job_order_id));
DROP POLICY IF EXISTS production_tasks_update ON public.production_tasks;
CREATE POLICY production_tasks_update ON public.production_tasks FOR UPDATE TO authenticated
USING (
  public.can_access_production_job(auth.uid(), job_order_id)
  AND (NOT public.is_current_production_user() OR assignee_id IS NULL OR assignee_id = auth.uid())
)
WITH CHECK (
  public.can_access_production_job(auth.uid(), job_order_id)
  AND (NOT public.is_current_production_user() OR assignee_id IS NULL OR assignee_id = auth.uid())
);

NOTIFY pgrst, 'reload schema';
COMMIT;
