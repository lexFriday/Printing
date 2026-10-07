BEGIN;

-- Re-assert the API-visible permission for the settlement RPC. This repairs
-- environments where the function migration ran but PostgREST retained an
-- older schema cache or the EXECUTE grant was lost during a restore.
GRANT USAGE ON SCHEMA public TO authenticated;
REVOKE ALL ON FUNCTION public.settle_and_close_petty_cash_batch(uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_and_close_petty_cash_batch(uuid, numeric, text)
  TO authenticated;

-- Make the function immediately discoverable through the Supabase REST API.
NOTIFY pgrst, 'reload schema';

COMMIT;
