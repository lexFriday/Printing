-- Imported financial history is read-only and is narrower than operational visibility.
-- Keep the shared sensitive-operations helper unchanged because other modules use it.

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
