-- Ensure every table owner and function owner in public/app_private (plus
-- authenticated, service_role, and postgres) has privileges on all public
-- tables and sequences so FK checks and triggers never fail with 42501.
DO $$
DECLARE
  v_role name;
BEGIN
  FOR v_role IN
    SELECT DISTINCT r.rolname
    FROM pg_roles r
    WHERE r.rolname IN ('authenticated', 'service_role', 'postgres')
       OR r.rolname IN (SELECT tableowner FROM pg_tables WHERE schemaname = 'public')
       OR r.oid IN (
         SELECT p.proowner
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname IN ('public', 'app_private')
       )
  LOOP
    BEGIN
      EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', v_role);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON ALL TABLES IN SCHEMA public TO %I', v_role);
      EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', v_role);
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping grant for role %', v_role;
    END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';