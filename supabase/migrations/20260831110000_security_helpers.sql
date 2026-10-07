-- Compatibility foundation for the operations migrations. The original base
-- schema defines profiles/user_roles, while later migrations rely on these
-- least-privilege helpers before their later permission hardening runs.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'owner';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'accounting';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'production';

-- PostgreSQL requires a transaction boundary before newly-added enum values
-- can be referenced by functions or policies.
COMMIT;
BEGIN;

CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION public.is_active_user(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id);
$$;

CREATE OR REPLACE FUNCTION app_private.is_active_user(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_user(_user_id);
$$;

CREATE OR REPLACE FUNCTION app_private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.can_write_operations(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_user(_user_id)
    AND (public.has_role(_user_id, 'owner') OR public.has_role(_user_id, 'admin') OR public.has_role(_user_id, 'accounting'));
$$;

CREATE OR REPLACE FUNCTION app_private.can_write_operations(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_write_operations(_user_id);
$$;

GRANT EXECUTE ON FUNCTION public.is_active_user(uuid), public.can_write_operations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_active_user(uuid), app_private.has_role(uuid, public.app_role), app_private.can_write_operations(uuid) TO authenticated;

COMMIT;
