BEGIN;

-- Provision sales and staff accounts using precomputed bcrypt hashes (no plaintext
-- passwords stored in source control) and ensure their profiles and roles exist.
DO $$
DECLARE
  v_user RECORD;
  v_user_id uuid;
BEGIN
  FOR v_user IN
    SELECT *
    FROM (
      VALUES
        ('dhodie22@gmail.com', 'Dhodie Sosa', 'sales'::public.app_role, '$2a$10$CK8fk0oLV4IBmD5N71QdkeRPni/mvhnZsVbNVNgWifMnatxlElWbW'),
        ('rachellejadejames@gmail.com', 'Rachelle Beso', 'staff'::public.app_role, '$2a$10$5Y0PVtz3Ve4UELHwdufmcOH76dpw5D3.hUnPFtY3syBTx8aJgV/Iq'),
        ('kheyesbieto007@gmail.com', 'Khey Esbieto', 'staff'::public.app_role, '$2a$10$PrObCjRWIkmIW1ShvBnBYeMJz4nXfQkYI2zpiL54TGMM/pqI8tFs6'),
        ('johnarlechino@gmail.com', 'John Carlo Dela Pena', 'staff'::public.app_role, '$2a$10$KDP4fv9oFmMUxBxUW.ZJT.p2psHTXuWuKV9iZ9BEUauLB8BzZwvzS'),
        ('lorelie327@gmail.com', 'Lorelie Frances David', 'sales'::public.app_role, '$2a$10$5h.4xga3tn107dsVyYO9Zea6gKkFUQqfjFOlSrz8BXO9xdkRVmdzG')
    ) AS t(email, display_name, role_name, password_hash)
  LOOP
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE lower(email) = lower(v_user.email)
    LIMIT 1;

    IF v_user_id IS NULL THEN
      BEGIN
        v_user_id := gen_random_uuid();

        INSERT INTO auth.users (
          instance_id,
          id,
          aud,
          role,
          email,
          encrypted_password,
          email_confirmed_at,
          raw_app_meta_data,
          raw_user_meta_data,
          confirmation_token,
          recovery_token,
          email_change_token_new,
          email_change,
          created_at,
          updated_at
        )
        VALUES (
          '00000000-0000-0000-0000-000000000000',
          v_user_id,
          'authenticated',
          'authenticated',
          v_user.email,
          v_user.password_hash,
          now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('display_name', v_user.display_name),
          '',
          '',
          '',
          '',
          now(),
          now()
        );

        INSERT INTO auth.identities (
          id,
          user_id,
          provider_id,
          identity_data,
          provider,
          last_sign_in_at,
          created_at,
          updated_at
        )
        VALUES (
          gen_random_uuid(),
          v_user_id,
          v_user_id::text,
          jsonb_build_object(
            'sub', v_user_id::text,
            'email', v_user.email,
            'email_verified', true,
            'phone_verified', false
          ),
          'email',
          now(),
          now(),
          now()
        );
      EXCEPTION
        WHEN insufficient_privilege THEN
          v_user_id := NULL;
          RAISE NOTICE 'Insufficient privilege to insert % into auth.users; create user via Auth Admin/Dashboard.', v_user.email;
      END;
    END IF;

    IF v_user_id IS NOT NULL THEN
      INSERT INTO public.profiles (id, display_name, email, status)
      VALUES (v_user_id, v_user.display_name, v_user.email, 'active')
      ON CONFLICT (id) DO UPDATE
      SET
        display_name = EXCLUDED.display_name,
        email = EXCLUDED.email,
        status = 'active';

      INSERT INTO public.user_roles (user_id, role)
      VALUES (v_user_id, v_user.role_name)
      ON CONFLICT (user_id) DO UPDATE
      SET role = EXCLUDED.role;
    END IF;
  END LOOP;
END
$$;

COMMIT;

