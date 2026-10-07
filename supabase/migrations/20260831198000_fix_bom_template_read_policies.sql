-- The public role helpers are intentionally not executable by browser roles.
-- Use their app_private counterparts inside RLS policies so the template
-- library can read the same records that the guarded RPC writes.

DROP POLICY IF EXISTS bom_read ON public.bom_templates;
DROP POLICY IF EXISTS bom_component_read ON public.bom_template_components;
DROP POLICY IF EXISTS materials_active_read ON public.materials;

CREATE POLICY bom_templates_authenticated_read
  ON public.bom_templates FOR SELECT TO authenticated
  USING (app_private.is_active_user(auth.uid()));

CREATE POLICY bom_template_components_authenticated_read
  ON public.bom_template_components FOR SELECT TO authenticated
  USING (app_private.is_active_user(auth.uid()));

CREATE POLICY materials_authenticated_read
  ON public.materials FOR SELECT TO authenticated
  USING (app_private.is_active_user(auth.uid()));
