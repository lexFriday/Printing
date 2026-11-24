-- Drop the foreign key from workflow_drafts.customer_id -> customers(id)
-- so draft auto-save (PATCH/UPSERT) never fails with 42501 "permission denied
-- for table customers" when PostgreSQL runs RI_FKey_check_upd.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'workflow_drafts'
      AND c.contype = 'f'
      AND c.confrelid = 'public.customers'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.workflow_drafts DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';