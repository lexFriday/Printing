-- Guided operations role boundary. Keep UI capability names and database
-- authorization aligned without restoring access to deprecated public helpers.
CREATE OR REPLACE FUNCTION app_private.can_operate_inventory(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_private.is_active_user(_user_id) AND (
    app_private.has_role(_user_id, 'owner') OR
    app_private.has_role(_user_id, 'admin') OR
    app_private.has_role(_user_id, 'staff')
  );
$$;

CREATE OR REPLACE FUNCTION app_private.can_operate_purchasing(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_private.can_operate_inventory(_user_id);
$$;

CREATE OR REPLACE FUNCTION app_private.can_read_operations(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_private.can_operate_inventory(_user_id)
    OR (app_private.is_active_user(_user_id) AND app_private.has_role(_user_id, 'accounting'));
$$;

CREATE OR REPLACE FUNCTION app_private.can_approve_operational_exception(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_private.is_active_user(_user_id) AND (
    app_private.has_role(_user_id, 'owner') OR
    app_private.has_role(_user_id, 'admin')
  );
$$;

REVOKE ALL ON FUNCTION app_private.can_operate_inventory(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.can_operate_purchasing(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.can_read_operations(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.can_approve_operational_exception(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.can_operate_inventory(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_operate_purchasing(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_read_operations(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_approve_operational_exception(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS movement_ops_read ON public.inventory_movements;
CREATE POLICY movement_ops_read ON public.inventory_movements FOR SELECT TO authenticated
USING (app_private.can_read_operations(auth.uid()));

DROP POLICY IF EXISTS purchase_ops_read ON public.purchase_requests;
CREATE POLICY purchase_ops_read ON public.purchase_requests FOR SELECT TO authenticated
USING (app_private.can_read_operations(auth.uid()));

DROP POLICY IF EXISTS receipt_ops_read ON public.material_receipts;
CREATE POLICY receipt_ops_read ON public.material_receipts FOR SELECT TO authenticated
USING (app_private.can_read_operations(auth.uid()));

DROP POLICY IF EXISTS suppliers_read ON public.suppliers;
CREATE POLICY suppliers_read ON public.suppliers FOR SELECT TO authenticated
USING (app_private.can_read_operations(auth.uid()));

DROP POLICY IF EXISTS job_boms_read ON public.job_boms;
CREATE POLICY job_boms_read ON public.job_boms FOR SELECT TO authenticated
USING (app_private.can_read_operations(auth.uid()));

DROP POLICY IF EXISTS job_bom_items_read ON public.job_bom_items;
CREATE POLICY job_bom_items_read ON public.job_bom_items FOR SELECT TO authenticated
USING (app_private.can_read_operations(auth.uid()));

DROP POLICY IF EXISTS production_jobs_read ON public.production_jobs;
CREATE POLICY production_jobs_read ON public.production_jobs FOR SELECT TO authenticated
USING (app_private.can_read_operations(auth.uid()));

DROP POLICY IF EXISTS production_exception_read ON public.production_material_exceptions;
CREATE POLICY production_exception_read ON public.production_material_exceptions FOR SELECT TO authenticated
USING (app_private.can_read_operations(auth.uid()));

DROP POLICY IF EXISTS item_template_materials_read ON public.item_template_materials;
CREATE POLICY item_template_materials_read ON public.item_template_materials FOR SELECT TO authenticated
USING (
  app_private.is_active_user(auth.uid()) AND NOT app_private.has_role(auth.uid(), 'viewer')
);

DROP POLICY IF EXISTS quote_material_estimates_read ON public.quote_material_estimates;
CREATE POLICY quote_material_estimates_read ON public.quote_material_estimates FOR SELECT TO authenticated
USING (
  app_private.is_active_user(auth.uid()) AND NOT app_private.has_role(auth.uid(), 'viewer')
);

DROP POLICY IF EXISTS materials_admin_write ON public.materials;
CREATE POLICY materials_admin_write ON public.materials FOR ALL TO authenticated
USING (app_private.can_approve_operational_exception(auth.uid()))
WITH CHECK (app_private.can_approve_operational_exception(auth.uid()));
