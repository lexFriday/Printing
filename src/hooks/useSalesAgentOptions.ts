import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SalesAgentOption {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
}

const salesAgentRoles = ["owner", "admin", "staff", "sales"] as const;

export function useSalesAgentOptions() {
  return useQuery({
    queryKey: ["sales-agent-options"],
    queryFn: async (): Promise<SalesAgentOption[]> => {
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, email, display_name, status")
        .eq("status", "active")
        .order("display_name", { ascending: true });
      if (profilesError) throw profilesError;

      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", [...salesAgentRoles]);
      if (rolesError) throw rolesError;

      const roleByUserId = new Map((roles ?? []).map((role) => [role.user_id, role.role]));
      const allowedUserIds = new Set(roleByUserId.keys());

      return (profiles ?? [])
        .filter((profile) => allowedUserIds.has(profile.id) && !!profile.email)
        .map((profile) => ({
          id: profile.id,
          name: profile.display_name?.trim() || profile.email || "Unnamed user",
          email: profile.email,
          role: roleByUserId.get(profile.id) ?? null,
        }));
    },
  });
}
