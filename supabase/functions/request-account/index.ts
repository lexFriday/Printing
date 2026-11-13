import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const { email, password, displayName } = await req.json();
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const trimmedName = typeof displayName === "string" ? displayName.trim() : "";

    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      return json(400, { error: "Please enter a valid email address." });
    }
    if (typeof password !== "string" || password.length < 6) {
      return json(400, { error: "Password must be at least 6 characters." });
    }
    if (!trimmedName) {
      return json(400, { error: "Display name is required." });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json(500, { error: "Server configuration error." });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: trimmedName },
    });

    if (createError) {
      const msg = createError.message.toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        return json(409, { error: "An account with this email already exists." });
      }
      return json(400, { error: createError.message });
    }

    const userId = created.user?.id;
    if (!userId) {
      return json(500, { error: "Account could not be created." });
    }

    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    const isOwner = roleRow?.role === "owner";

    // Ensure non-first users remain inactive until an owner/admin accepts them.
    if (!isOwner) {
      await supabaseAdmin
        .from("profiles")
        .upsert(
          {
            id: userId,
            email: normalizedEmail,
            display_name: trimmedName,
            status: "inactive",
          },
          { onConflict: "id" },
        );
    }

    return json(200, { ok: true, pendingApproval: !isOwner });
  } catch (err) {
    return json(400, { error: err instanceof Error ? err.message : "Invalid request." });
  }
});

