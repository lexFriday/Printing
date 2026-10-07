DROP POLICY IF EXISTS "audit read admin" ON public.audit_logs;
DROP POLICY IF EXISTS "audit read owner" ON public.audit_logs;

CREATE POLICY "audit read owner" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (app_private.can_manage_users(auth.uid()) AND app_private.is_active_user(auth.uid()));
