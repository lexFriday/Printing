BEGIN;

-- Owners and admins can perform accounting writes, including JO-to-invoice conversion.
CREATE OR REPLACE FUNCTION public.can_write_operations(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_active_user(_user_id)
    AND (
      public.has_role(_user_id, 'owner')
      OR public.has_role(_user_id, 'admin')
      OR public.has_role(_user_id, 'staff')
    )
$$;

CREATE OR REPLACE FUNCTION app_private.can_write_operations(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_private.is_active_user(_user_id)
    AND (
      app_private.has_role(_user_id, 'owner')
      OR app_private.has_role(_user_id, 'admin')
      OR app_private.has_role(_user_id, 'staff')
    )
$$;

COMMIT;
