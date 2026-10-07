-- The first account is the workspace owner. Keep this decision in the
-- database so every client and environment follows the same rule.
BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_first_user boolean;
BEGIN
  is_first_user := NOT EXISTS (SELECT 1 FROM auth.users WHERE id <> NEW.id);

  INSERT INTO public.profiles (id, display_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  IF is_first_user THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'owner'::public.app_role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill the existing first account in this local workspace.
INSERT INTO public.profiles (id, display_name, email)
SELECT id, COALESCE(raw_user_meta_data->>'display_name', split_part(email, '@', 1)), email
FROM auth.users
WHERE lower(email) = lower('1@gmail.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'owner'::public.app_role
FROM auth.users
WHERE lower(email) = lower('1@gmail.com')
ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

COMMIT;
