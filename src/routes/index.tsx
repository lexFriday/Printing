import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { defaultLandingForRole } from "@/lib/roles";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.session.user.id)
        .maybeSingle();
      throw redirect({ to: defaultLandingForRole(roleRow?.role ?? null) });
    }
    throw redirect({ to: "/auth" });
  },
  component: () => null,
});
