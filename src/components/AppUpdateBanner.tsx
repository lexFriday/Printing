import { useEffect, useState } from "react";
import { RefreshCw, Sparkles, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  APP_VERSION,
  clearSiteCacheAndReload,
  fetchRemoteAppVersion,
  getStoredAppVersion,
  isAuthLoopDetected,
} from "@/lib/appVersion";

export function AppUpdateBanner() {
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [authLoop, setAuthLoop] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Clean up cache-busting query params (_v, _cb) from the address bar after a hard reload
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("_v") || url.searchParams.has("_cb")) {
        url.searchParams.delete("_v");
        url.searchParams.delete("_cb");
        const cleanSearch = url.searchParams.toString();
        const nextUrl = `${url.pathname}${cleanSearch ? `?${cleanSearch}` : ""}${url.hash}`;
        window.history.replaceState({}, "", nextUrl);
      }
    } catch {}

    const checkState = async () => {
      if (isAuthLoopDetected()) {
        setAuthLoop(true);
      }

      const stored = getStoredAppVersion();
      const remote = await fetchRemoteAppVersion();
      const targetVersion = remote || APP_VERSION;

      if (!stored || stored !== targetVersion || (remote && remote !== APP_VERSION)) {
        setUpdateVersion(targetVersion);
      } else {
        setUpdateVersion(null);
      }
    };

    void checkState();

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        void checkState();
      }
    };

    const onAuthLoopEvent = () => {
      setAuthLoop(true);
      setUpdateVersion((prev) => prev || APP_VERSION);
    };

    const interval = window.setInterval(() => {
      void checkState();
    }, 45_000);

    window.addEventListener("focus", onVisibilityOrFocus);
    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("automate:auth-loop", onAuthLoopEvent);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisibilityOrFocus);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("automate:auth-loop", onAuthLoopEvent);
    };
  }, []);

  if (!updateVersion && !authLoop) return null;

  const handleUpdate = async () => {
    setUpdating(true);
    await clearSiteCacheAndReload({
      targetVersion: updateVersion || APP_VERSION,
      clearAuth: authLoop || window.location.pathname.startsWith("/auth"),
    });
  };

  return (
    <div
      role="region"
      aria-label="Application update notification"
      className="sticky top-0 z-[100] w-full border-b border-blue-700/30 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 px-4 py-2.5 text-white shadow-md print:hidden"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-xs sm:text-sm">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20">
            {authLoop ? (
              <AlertTriangle className="h-4 w-4 text-amber-200" />
            ) : (
              <Sparkles className="h-4 w-4 text-blue-100" />
            )}
          </span>
          <div>
            <span className="font-semibold">
              {authLoop
                ? "Sign-in session loop detected — clean cache reset required"
                : `Update available (${updateVersion || APP_VERSION})`}
            </span>
            <span className="hidden sm:inline text-blue-100 ml-2">
              {authLoop
                ? "Click the button to clear stale browser cache & session tokens and reload cleanly."
                : "Click update to clear cached site data and hard-reload into the latest clean state."}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            size="sm"
            onClick={() => void handleUpdate()}
            disabled={updating}
            className="h-8 rounded-lg bg-white px-3.5 text-xs font-semibold text-blue-700 shadow-xs hover:bg-blue-50"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${updating ? "animate-spin" : ""}`} />
            {updating
              ? "Clearing cache & reloading…"
              : authLoop
                ? "Clear Cache & Fix Sign-In"
                : "Update & Clear Cache"}
          </Button>
        </div>
      </div>
    </div>
  );
}

