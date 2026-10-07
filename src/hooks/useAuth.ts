import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

type AuthState = {
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  roleError: string | null;
  roleLoading: boolean;
  loading: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`${label} timed out.`)), ms);
    Promise.resolve(promise).then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const appliedSessionKey = useRef<string | null>(null);
  const currentUserId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    async function applySession(s: Session | null) {
      const nextSessionKey = s ? `${s.user.id}:${s.access_token}` : null;
      if (appliedSessionKey.current === nextSessionKey) {
        setLoading(false);
        return;
      }

      appliedSessionKey.current = nextSessionKey;
      setSession(s);
      setUser(s?.user ?? null);
      currentUserId.current = s?.user.id ?? null;

      if (!s?.user) {
        setRole(null);
        setRoleError(null);
        setRoleLoading(false);
        setLoading(false);
        return;
      }

      setRoleLoading(true);
      setLoading((wasLoading) => wasLoading && !currentUserId.current);
      let data: { role: AppRole } | null = null;
      let error: { message?: string; code?: string } | null = null;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await withTimeout(
          supabase.from("user_roles").select("role").eq("user_id", s.user.id).maybeSingle(),
          5000,
          "Role lookup",
        );
        data = result.data as { role: AppRole } | null;
        error = result.error;

        if (!error || error.code !== "PGRST303") break;

        // Supabase can briefly reject a freshly issued token when Auth and
        // PostgREST clocks are out of sync. Refresh once, then retry.
        if (attempt === 0) await supabase.auth.refreshSession();
        await wait(2000 * (attempt + 1));
      }

      if (!active) return;
      if (error) console.error("[Auth] Unable to load user role", error);
      setRoleError(error ? (error.message ?? "Unable to load your access") : null);
      setRole(error ? null : (data?.role ?? null));
      setRoleLoading(false);
      setLoading(false);
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      window.setTimeout(() => {
        if (active) void applySession(s);
      }, 0);
    });

    withTimeout(supabase.auth.getSession(), 5000, "Session lookup")
      .then(({ data }) => {
        if (active) void applySession(data.session);
      })
      .catch((error) => {
        console.error("[Auth] Unable to load session", error);
        if (!active) return;
        setSession(null);
        setUser(null);
        setRole(null);
        setRoleError(error instanceof Error ? error.message : "Unable to load workspace access.");
        setRoleLoading(false);
        setLoading(false);
      });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({ session, user, role, roleError, roleLoading, loading }),
    [session, user, role, roleError, roleLoading, loading],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const auth = useContext(AuthContext);

  if (!auth) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return auth;
}
