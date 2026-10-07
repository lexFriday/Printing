BEGIN;

-- Reuse the trusted row audit used by item_templates. Recipe changes and their
-- audit entries commit together; an audit error must abort the whole save RPC.
-- No historical backfill: the original actor and before-values are unknown.
DROP TRIGGER IF EXISTS capture_audit_log ON public.item_template_materials;
CREATE TRIGGER capture_audit_log
AFTER INSERT OR UPDATE OR DELETE ON public.item_template_materials
FOR EACH ROW EXECUTE FUNCTION app_private.capture_audit_log();

COMMIT;
