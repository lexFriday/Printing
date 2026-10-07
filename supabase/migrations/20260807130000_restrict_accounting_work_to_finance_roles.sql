-- Keep accounting mutations, including payments and proof files, behind the
-- Owner/Admin/Accounting boundary. Staff remains operational-only.
CREATE OR REPLACE FUNCTION app_private.can_accounting_work(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT app_private.is_active_user(_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = _user_id
        AND role::text IN ('owner', 'admin', 'accounting')
    );
$$;

REVOKE ALL ON FUNCTION app_private.can_accounting_work(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.can_accounting_work(uuid) TO authenticated, service_role;
