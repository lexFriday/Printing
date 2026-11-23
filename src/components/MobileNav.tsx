import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LogOut, MoreHorizontal, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  APP_VERSION,
  clearSiteCacheAndReload,
  recordIntentionalSignOut,
} from "@/lib/appVersion";
import { getNavigationGroups, type NavItem } from "@/lib/navigation";

export function MobileNav() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const nav = useNavigate();
  const { user, role } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);

  const pendingUsers = useQuery({
    queryKey: ["pending-user-count"],
    enabled: role === "owner",
    queryFn: async () => {
      const [{ data: profiles, error: profilesError }, { data: roles, error: rolesError }] =
        await Promise.all([
          supabase.from("profiles").select("id"),
          supabase.from("user_roles").select("user_id"),
        ]);
      if (profilesError) throw profilesError;
      if (rolesError) throw rolesError;
      const assigned = new Set((roles ?? []).map((entry) => entry.user_id));
      return (profiles ?? []).filter((profile) => !assigned.has(profile.id)).length;
    },
  });

  const { workflowItems, insightItems, administrationItems } = getNavigationGroups(role);
  const allItems = [...workflowItems, ...insightItems, ...administrationItems];
  const primaryItems = allItems.slice(0, 4);
  const primaryUrls = new Set(primaryItems.map((item) => item.url));
  const moreActive = allItems.some(
    (item) =>
      !primaryUrls.has(item.url) &&
      (pathname === item.url || pathname.startsWith(item.url + "/")),
  );

  const renderSheetGroup = (label: string, items: NavItem[]) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-1.5">
        <p className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {items.map((item) => {
            const active = pathname === item.url || pathname.startsWith(item.url + "/");
            return (
              <Link
                key={item.url}
                to={item.url}
                onClick={() => setMoreOpen(false)}
                className={`flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "bg-background text-foreground hover:bg-muted/60"
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.title}</span>
                {item.title === "Users" && pendingUsers.data ? (
                  <Badge variant="destructive" className="ml-auto min-w-5 justify-center px-1.5 py-0">
                    {pendingUsers.data}
                  </Badge>
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div
        className="mx-auto grid h-16 max-w-lg items-center px-1"
        style={{ gridTemplateColumns: `repeat(${primaryItems.length + 1}, minmax(0, 1fr))` }}
      >
        {primaryItems.map((item) => {
          const active = pathname === item.url || pathname.startsWith(item.url + "/");
          return (
            <Link
              key={item.url}
              to={item.url}
              className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-medium transition-colors ${
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span
                className={`flex h-7 w-11 items-center justify-center rounded-full transition-colors ${
                  active ? "bg-primary/12" : ""
                }`}
              >
                <item.icon className="h-4 w-4" />
              </span>
              <span className="max-w-full truncate">{item.title}</span>
            </Link>
          );
        })}

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className={`relative flex h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-medium transition-colors ${
                moreActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span
                className={`flex h-7 w-11 items-center justify-center rounded-full transition-colors ${
                  moreActive ? "bg-primary/12" : ""
                }`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </span>
              <span>More</span>
              {pendingUsers.data ? (
                <span className="absolute right-3 top-1.5 h-2 w-2 rounded-full bg-destructive" />
              ) : null}
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="max-h-[85dvh] overflow-y-auto rounded-t-2xl px-4 pb-8 pt-5"
          >
            <SheetHeader className="text-left">
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription className="truncate">
                {user?.email ?? "Signed in"} · Build {APP_VERSION}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-5">
              {renderSheetGroup("Workspace", workflowItems)}
              {renderSheetGroup("Insights", insightItems)}
              {renderSheetGroup("Administration", administrationItems)}
              <div className="grid grid-cols-2 gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 justify-start"
                  onClick={() => void clearSiteCacheAndReload({ clearAuth: false })}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Reload latest
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 justify-start text-destructive hover:text-destructive"
                  onClick={() => {
                    setMoreOpen(false);
                    recordIntentionalSignOut();
                    void supabase.auth.signOut().then(() => nav({ to: "/auth", replace: true }));
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
