-- New signups (other than the very first workspace owner) start inactive
-- without a role until an owner or admin approves them in Settings -> Users.
-- Adapted from supabase/migrations/20261113121000_pending_signup_approval.sql:
-- keeps the advisory lock and checks public.profiles instead of auth.users,
-- because querying managed auth tables from this trigger breaks signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_first_user boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(22160500);
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles WHERE id <> NEW.id)
    INTO is_first_user;

  INSERT INTO public.profiles (id, display_name, email, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    CASE WHEN is_first_user THEN 'active'::public.user_status ELSE 'inactive'::public.user_status END
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    display_name = COALESCE(NULLIF(public.profiles.display_name, ''), EXCLUDED.display_name);

  IF is_first_user THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'owner'::public.app_role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
  END IF;

  RETURN NEW;
END;
$$;
