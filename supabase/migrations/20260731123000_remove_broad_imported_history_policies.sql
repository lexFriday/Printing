-- Remove the original broad read policies. PostgreSQL combines permissive
-- policies with OR, so leaving either policy would still expose the data.

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'legacy_accounting_entries',
    'legacy_profit_loss_monthly',
    'legacy_profit_loss_lines'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
      'legacy accounting read', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
      'legacy pnl sensitive read', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
      'legacy pnl lines sensitive read', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
      'legacy financial history read', table_name);

    EXECUTE format($policy$
      CREATE POLICY %I
        ON public.%I
        FOR SELECT TO authenticated
        USING (
          app_private.is_active_user(auth.uid())
          AND EXISTS (
            SELECT 1
            FROM public.user_roles
            WHERE user_id = auth.uid()
              AND role::text IN ('owner', 'admin', 'accounting')
          )
        )
    $policy$, 'legacy financial history read', table_name);
  END LOOP;
END $$;
