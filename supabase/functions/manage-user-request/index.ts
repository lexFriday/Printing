import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_ROLES = new Set([
  "owner",
  "admin",
  "sales",
  "staff",
  "accounting",
  "production",
  "viewer",
]);

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json(500, { error: "Server configuration error." });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return json(401, { error: "Unauthorized." });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !callerData.user) {
      return json(401, { error: "Invalid session." });
    }

    const { data: callerRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerData.user.id)
      .maybeSingle();

    if (!callerRole || (callerRole.role !== "owner" && callerRole.role !== "admin")) {
      return json(403, { error: "Only owners or admins can manage user requests." });
    }

    const { action, userId, role } = await req.json();
    if (typeof userId !== "string" || !userId) {
      return json(400, { error: "userId is required." });
    }

    if (action === "accept") {
      if (typeof role !== "string" || !VALID_ROLES.has(role)) {
        return json(400, { error: "Please select a valid role." });
      }

      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .update({ status: "active" })
        .eq("id", userId);
      if (profileError) {
        return json(400, { error: profileError.message });
      }

      const { error: roleError } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: userId, role }, { onConflict: "user_id" });
      if (roleError) {
        return json(400, { error: roleError.message });
      }

      return json(200, { ok: true });
    }

    if (action === "refuse") {
      if (userId === callerData.user.id) {
        return json(400, { error: "You cannot refuse your own account." });
      }
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (deleteError) {
        return json(400, { error: deleteError.message });
      }
      return json(200, { ok: true });
    }

    return json(400, { error: "Invalid action." });
  } catch (err) {
    return json(400, { error: err instanceof Error ? err.message : "Invalid request." });
  }
});

