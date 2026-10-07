import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, role, roleError, loading, roleLoading } = useAuth();
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

  if (!roleLoading && (!role || role === "viewer") && !roleError) {
    return <WaitingForWorkspaceAccess />;
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen min-w-0 w-full bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 min-w-0 items-center gap-2 border-b bg-card/50 px-4 backdrop-blur">
            <SidebarTrigger />
          </header>
          <main className="mx-auto min-w-0 w-full max-w-[1400px] flex-1 p-4 sm:p-5 lg:p-6">
            {roleLoading && !role ? (
              <div className="text-sm text-muted-foreground">Loading workspace…</div>
            ) : (
              <Outlet />
            )}
          </main>
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
          Waiting for workspace access
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          An owner needs to give you a role before you can access workspace operations. After your
          role is added, tap Try again.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button type="button" onClick={() => window.location.reload()}>
            Try again
          </Button>
          <Button type="button" variant="outline" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </Button>
        </div>
      </section>
    </main>
  );
}
