import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Untyped view of the same signed-in client, for production, purchasing and
 * notification tables/functions that the repo's migrations define but the live
 * database does not have yet. Calls still go through the user's session and RLS;
 * they fail at runtime until those migrations are applied.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const operationsDb = supabase as unknown as SupabaseClient<any, "public", any>;
