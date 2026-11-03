declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" && __APP_VERSION__
    ? __APP_VERSION__
    : "2026.11.03-v2";

export const APP_VERSION_STORAGE_KEY = "automate:app-version";
export const AUTH_SIGNIN_TS_KEY = "automate:last-signin-ts";
export const AUTH_INTENTIONAL_SIGNOUT_KEY = "automate:intentional-signout";
export const AUTH_LOOP_DETECTED_KEY = "automate:auth-loop-detected";
export const AUTH_LOOP_COUNT_KEY = "automate:auth-loop-count";

/**
 * Purges all Supabase auth tokens (`sb-*`, `supabase.auth.*`, `lovable-preview-auth*`)
 * from localStorage and sessionStorage so corrupted or half-rotated refresh tokens
 * cannot cause a login -> logout loop.
 */
export function purgeStaleAuthStorage() {
  if (typeof window === "undefined") return;
  try {
    const localKeys = Object.keys(window.localStorage);
    for (const key of localKeys) {
      if (
        key.startsWith("sb-") ||
        key.includes("supabase") ||
        key.includes("auth-token") ||
        key.includes("lovable-preview-auth")
      ) {
        window.localStorage.removeItem(key);
      }
    }
  } catch (err) {
    console.warn("[AppVersion] Unable to purge localStorage auth keys:", err);
  }

  try {
    const sessionKeys = Object.keys(window.sessionStorage);
    for (const key of sessionKeys) {
      if (
        key.startsWith("sb-") ||
        key.includes("supabase") ||
        key.includes("auth-token") ||
        key.includes("lovable-preview-auth")
      ) {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch (err) {
    console.warn("[AppVersion] Unable to purge sessionStorage auth keys:", err);
  }
}

/**
 * Validates whether any existing Supabase session in localStorage is structurally sound.
 * If it is malformed JSON or missing a refresh_token, removes it immediately.
 */
export function sanitizeStoredAuthSession() {
  if (typeof window === "undefined") return;
  try {
    const localKeys = Object.keys(window.localStorage);
    for (const key of localKeys) {
      if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (
            !parsed ||
            typeof parsed !== "object" ||
            !parsed.access_token ||
            !parsed.refresh_token
          ) {
            window.localStorage.removeItem(key);
          }
        } catch {
          window.localStorage.removeItem(key);
        }
      }
    }
  } catch {}
}

export function recordAuthSignIn() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(AUTH_SIGNIN_TS_KEY, String(Date.now()));
    window.sessionStorage.removeItem(AUTH_INTENTIONAL_SIGNOUT_KEY);
  } catch {}
}

export function recordIntentionalSignOut() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(AUTH_INTENTIONAL_SIGNOUT_KEY, "1");
    window.sessionStorage.removeItem(AUTH_SIGNIN_TS_KEY);
    window.sessionStorage.removeItem(AUTH_LOOP_DETECTED_KEY);
    window.sessionStorage.removeItem(AUTH_LOOP_COUNT_KEY);
  } catch {}
}

/**
 * Detects if a user was unexpectedly signed out within 20 seconds of signing in
 * (a classic symptom of a corrupted refresh token, clock skew, or stale cache).
 * Automatically purges corrupted auth tokens and flags the loop so the UI can prompt/heal.
 */
export function detectAndHealUnexpectedSignOut(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const intentional = window.sessionStorage.getItem(AUTH_INTENTIONAL_SIGNOUT_KEY);
    if (intentional === "1") {
      window.sessionStorage.removeItem(AUTH_INTENTIONAL_SIGNOUT_KEY);
      return false;
    }

    const lastSignInRaw = window.sessionStorage.getItem(AUTH_SIGNIN_TS_KEY);
    if (!lastSignInRaw) return false;

    const elapsedMs = Date.now() - Number(lastSignInRaw);
    if (Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < 20_000) {
      const prevCount = Number(window.sessionStorage.getItem(AUTH_LOOP_COUNT_KEY) || "0");
      const nextCount = prevCount + 1;
      window.sessionStorage.setItem(AUTH_LOOP_COUNT_KEY, String(nextCount));
      window.sessionStorage.setItem(AUTH_LOOP_DETECTED_KEY, "1");
      window.sessionStorage.removeItem(AUTH_SIGNIN_TS_KEY);
      purgeStaleAuthStorage();
      return true;
    }
  } catch {}
  return false;
}

export function isAuthLoopDetected(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(AUTH_LOOP_DETECTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function getStoredAppVersion(): string | null {
  if (typeof window === "undefined") return APP_VERSION;
  try {
    return window.localStorage.getItem(APP_VERSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function markCurrentAppVersionApplied(version: string = APP_VERSION) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(APP_VERSION_STORAGE_KEY, version);
  } catch {}
}

export async function fetchRemoteAppVersion(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(`/version.json?_t=${Date.now()}`, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data?.version === "string" && data.version.trim()
      ? data.version.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * Clears browser CacheStorage, unregisters Service Workers, cleans localStorage/sessionStorage,
 * records the applied app version, and performs a cache-busting hard reload.
 */
export async function clearSiteCacheAndReload(options?: {
  targetVersion?: string;
  clearAuth?: boolean;
  redirectTo?: string;
}) {
  if (typeof window === "undefined") return;
  const versionToSave = options?.targetVersion || APP_VERSION;
  const shouldClearAuth =
    options?.clearAuth ??
    (window.location.pathname.startsWith("/auth") || isAuthLoopDetected());

  // 1. Clear CacheStorage (Service Worker / PWA / Vite asset caches)
  try {
    if ("caches" in window && window.caches) {
      const cacheNames = await window.caches.keys();
      await Promise.all(cacheNames.map((name) => window.caches.delete(name)));
    }
  } catch (err) {
    console.warn("[AppVersion] CacheStorage clear failed:", err);
  }

  // 2. Unregister any Service Workers
  try {
    if ("serviceWorker" in navigator && navigator.serviceWorker) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister()));
    }
  } catch (err) {
    console.warn("[AppVersion] ServiceWorker unregister failed:", err);
  }

  // 3. Clear IndexedDB databases if supported (except active browser internals)
  try {
    if ("indexedDB" in window && typeof window.indexedDB?.databases === "function") {
      const dbs = await window.indexedDB.databases();
      for (const db of dbs) {
        if (db.name) {
          try {
            window.indexedDB.deleteDatabase(db.name);
          } catch {}
        }
      }
    }
  } catch {}

  // 4. Clean localStorage and sessionStorage
  try {
    if (shouldClearAuth) {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } else {
      sanitizeStoredAuthSession();
      const preservedAuthEntries: Array<[string, string]> = [];
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
          const val = window.localStorage.getItem(key);
          if (val) preservedAuthEntries.push([key, val]);
        }
      }
      window.localStorage.clear();
      window.sessionStorage.clear();
      for (const [k, v] of preservedAuthEntries) {
        window.localStorage.setItem(k, v);
      }
    }
    window.localStorage.setItem(APP_VERSION_STORAGE_KEY, versionToSave);
  } catch (err) {
    console.warn("[AppVersion] Storage reset failed:", err);
  }

  // 5. Hard reload with cache-busting query parameter
  const targetPath = options?.redirectTo || window.location.pathname || "/";
  const url = new URL(targetPath, window.location.origin);
  window.location.search
    .replace(/^\?/, "")
    .split("&")
    .filter(Boolean)
    .forEach((part) => {
      const [rawKey, rawVal = ""] = part.split("=");
      const key = decodeURIComponent(rawKey);
      if (key !== "_v" && key !== "_cb") {
        url.searchParams.set(key, decodeURIComponent(rawVal));
      }
    });
  url.searchParams.set("_v", versionToSave);
  url.searchParams.set("_cb", String(Date.now()));

  window.location.replace(url.toString());
}

