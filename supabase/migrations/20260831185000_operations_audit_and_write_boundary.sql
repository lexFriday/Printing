-- Operations mutations are performed only by guarded SECURITY DEFINER RPCs.
-- The ledger and production records use the existing audit log as their
-- immutable history, alongside their own business records.
REVOKE INSERT, UPDATE, DELETE ON public.inventory_movements, public.purchase_requests,
  public.material_receipts, public.production_jobs, public.production_material_exceptions
FROM authenticated;

DROP POLICY IF EXISTS movement_ops_insert ON public.inventory_movements;
DROP POLICY IF EXISTS purchase_ops_insert ON public.purchase_requests;
DROP POLICY IF EXISTS receipt_ops_insert ON public.material_receipts;
DROP POLICY IF EXISTS production_jobs_write ON public.production_jobs;
DROP POLICY IF EXISTS production_jobs_update ON public.production_jobs;
DROP POLICY IF EXISTS production_exception_insert ON public.production_material_exceptions;
DROP POLICY IF EXISTS production_exception_update ON public.production_material_exceptions;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'materials', 'bom_templates', 'bom_template_components', 'job_boms',
    'job_bom_items', 'inventory_movements', 'purchase_requests',
    'material_receipts', 'production_material_exceptions'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS capture_audit_log ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER capture_audit_log AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app_private.capture_audit_log()',
      table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION app_private.capture_production_job_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
  VALUES (
    auth.uid(),
    lower(TG_OP),
    'production_jobs',
    COALESCE(NEW.job_order_id, OLD.job_order_id),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION app_private.capture_production_job_audit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS capture_audit_log ON public.production_jobs;
CREATE TRIGGER capture_audit_log
AFTER INSERT OR UPDATE OR DELETE ON public.production_jobs
FOR EACH ROW EXECUTE FUNCTION app_private.capture_production_job_audit();
