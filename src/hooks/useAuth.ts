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
import {
  detectAndHealUnexpectedSignOut,
  recordAuthSignIn,
  sanitizeStoredAuthSession,
} from "@/lib/appVersion";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type ProfileStatus = Database["public"]["Enums"]["user_status"];

type AuthState = {
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  profileStatus: ProfileStatus | null;
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
  const [profileStatus, setProfileStatus] = useState<ProfileStatus | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const appliedSessionKey = useRef<string | null>(null);
  const currentUserId = useRef<string | null>(null);
  const roleLoadedForUser = useRef<string | null>(null);
  const roleLookupInFlightForUser = useRef<string | null>(null);
  const isRefreshingSession = useRef(false);

  useEffect(() => {
    let active = true;
    sanitizeStoredAuthSession();

    async function applySession(s: Session | null, event?: string) {
      if (event === "SIGNED_IN" && s?.user) {
        recordAuthSignIn();
      }

      const nextSessionKey = s ? `${s.user.id}:${s.access_token}` : null;
      if (appliedSessionKey.current === nextSessionKey && nextSessionKey !== null) {
        setLoading(false);
        return;
      }

      if (!s?.user) {
        const hadUser = Boolean(currentUserId.current);
        appliedSessionKey.current = null;
        currentUserId.current = null;
        roleLoadedForUser.current = null;
        roleLookupInFlightForUser.current = null;

        if (hadUser || event === "SIGNED_OUT") {
          const loopDetected = detectAndHealUnexpectedSignOut();
          if (loopDetected && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("automate:auth-loop"));
          }
        }

        setSession(null);
        setUser(null);
        setRole(null);
        setProfileStatus(null);
        setRoleError(null);
        setRoleLoading(false);
        setLoading(false);
        return;
      }

      appliedSessionKey.current = nextSessionKey;
      setSession(s);
      setUser(s.user);

      // If we already loaded the role for this exact user (or a lookup for this user is already in flight),
      // do not re-trigger roleLoading or a recursive refreshSession loop on TOKEN_REFRESHED.
      if (
        currentUserId.current === s.user.id &&
        (roleLoadedForUser.current === s.user.id || roleLookupInFlightForUser.current === s.user.id)
      ) {
        setLoading(false);
        if (roleLoadedForUser.current === s.user.id) {
          setRoleLoading(false);
        }
        return;
      }

      currentUserId.current = s.user.id;
      roleLookupInFlightForUser.current = s.user.id;
      setRoleLoading(true);
      setLoading(false);

      let data: { role: AppRole } | null = null;
      let statusData: { status: ProfileStatus } | null = null;
      let error: { message?: string; code?: string } | null = null;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const [roleResult, profileResult] = await withTimeout(
            Promise.all([
              supabase.from("user_roles").select("role").eq("user_id", s.user.id).maybeSingle(),
              supabase.from("profiles").select("status").eq("id", s.user.id).maybeSingle(),
            ]),
            8000,
            "Role lookup",
          );
          data = roleResult.data as { role: AppRole } | null;
          statusData = profileResult.data as { status: ProfileStatus } | null;
          error = roleResult.error ?? profileResult.error;
        } catch (lookupErr) {
          error = {
            message: lookupErr instanceof Error ? lookupErr.message : "Role lookup timed out.",
          };
        }

        if (!error) break;

        // If PostgREST clock is slightly behind Auth (PGRST303), simply wait for clocks to align.
        // Avoid calling refreshSession() on a fresh token to prevent refresh-token rotation collisions.
        if (error.code === "PGRST303") {
          const isExpired = s.expires_at ? s.expires_at * 1000 < Date.now() : false;
          if (isExpired && attempt === 0 && !isRefreshingSession.current) {
            isRefreshingSession.current = true;
            try {
              await supabase.auth.refreshSession();
            } catch {} finally {
              isRefreshingSession.current = false;
            }
          }
          await wait(1500 * (attempt + 1));
          continue;
        }

        break;
      }

      if (!active) return;
      roleLookupInFlightForUser.current = null;
      if (error) {
        console.error("[Auth] Unable to load user role", error);
      } else {
        roleLoadedForUser.current = s.user.id;
      }
      setRoleError(error ? (error.message ?? "Unable to load your access") : null);
      setRole(error ? null : (data?.role ?? null));
      setProfileStatus(error ? null : (statusData?.status ?? null));
      setRoleLoading(false);
      setLoading(false);
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      window.setTimeout(() => {
        if (active) void applySession(s, event);
      }, 0);
    });

    withTimeout(supabase.auth.getSession(), 12000, "Session lookup")
      .then(({ data }) => {
        if (!active) return;
        // If onAuthStateChange already populated the active user, don't overwrite with a stale null
        if (currentUserId.current && !data.session) return;
        void applySession(data.session, "INITIAL_SESSION");
      })
      .catch((error) => {
        console.error("[Auth] Unable to load session", error);
        if (!active) return;
        // Never wipe an already-authenticated user if getSession() timed out in the background
        if (currentUserId.current) {
          setLoading(false);
          return;
        }
        setSession(null);
        setUser(null);
        setRole(null);
        setProfileStatus(null);
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
    () => ({ session, user, role, profileStatus, roleError, roleLoading, loading }),
    [session, user, role, profileStatus, roleError, roleLoading, loading],
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
