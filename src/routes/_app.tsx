import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { MobileNav } from "@/components/MobileNav";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_LOGO_PATH, APP_NAME } from "@/lib/brand";
import { recordIntentionalSignOut } from "@/lib/appVersion";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, role, profileStatus, roleError, loading, roleLoading } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (!loading && !user) void nav({ to: "/auth", replace: true });
  }, [loading, user, nav]);

  if ((loading || roleLoading) && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!user) return null;

  if (!roleLoading && (!role || role === "viewer" || profileStatus === "inactive") && !roleError) {
    return <WaitingForWorkspaceAccess />;
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen min-w-0 w-full bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 min-w-0 items-center justify-between gap-2 border-b bg-card/85 px-3 backdrop-blur md:px-4">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="hidden md:inline-flex" />
              <img
                src={APP_LOGO_PATH}
                alt={APP_NAME}
                className="h-6 w-auto object-contain md:hidden"
              />
            </div>
            {role ? (
              <span className="rounded-full border bg-muted/60 px-2.5 py-0.5 text-[11px] font-medium capitalize text-muted-foreground md:hidden">
                {role}
              </span>
            ) : null}
          </header>
          <main className="mx-auto min-w-0 w-full max-w-[1400px] flex-1 p-3 pb-24 sm:p-5 md:pb-6 lg:p-6">
            {roleLoading && !role ? (
              <div className="text-sm text-muted-foreground">Loading workspace…</div>
            ) : (
              <Outlet />
            )}
          </main>
          <MobileNav />
        </div>
      </div>
    </SidebarProvider>
  );
}

function WaitingForWorkspaceAccess() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f9ff] px-5 py-8">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white px-6 py-7 text-center shadow-sm sm:px-10 sm:py-8">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-500">
          <Clock3 className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-950">
          Waiting for admin approval
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          An owner or admin needs to accept your account request and assign you a role before you
          can access workspace operations. After your account is approved, tap Try again.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button type="button" onClick={() => window.location.reload()}>
            Try again
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              recordIntentionalSignOut();
              void supabase.auth.signOut();
            }}
          >
            Sign out
          </Button>
        </div>
      </section>
    </main>
  );
}
