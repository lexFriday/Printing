CREATE OR REPLACE FUNCTION app_private.can_control_jobs(_user_id uuid)
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
        AND role::text IN ('owner', 'admin', 'staff')
    );
$$;

REVOKE ALL ON FUNCTION app_private.can_control_jobs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.can_control_jobs(uuid) TO authenticated, service_role;
