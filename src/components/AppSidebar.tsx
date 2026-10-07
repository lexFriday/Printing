import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Users,
  FileText,
  ClipboardList,
  Receipt,
  BarChart3,
  LogOut,
  Settings,
  ScrollText,
  LayoutDashboard,
  Package,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { APP_ICON_PATH, APP_LOGO_PATH, APP_NAME } from "@/lib/brand";
import {
  canAccountingWork,
  canViewJobOrders,
  canManageUsers,
  canManageOperationalSettings,
  canSalesWork,
  canViewMoneyWork,
  canViewStatusOnly,
  canViewFullReports,
} from "@/lib/roles";

const quoteItem = { title: "Quotes", url: "/quotes", icon: FileText };
const jobItem = { title: "Job Orders", url: "/jobs", icon: ClipboardList };
const invoiceItem = { title: "Invoices", url: "/invoices", icon: Receipt };
const dashboardItem = { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard };
const reportsItem = { title: "Reports", url: "/reports", icon: BarChart3 };

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const nav = useNavigate();
  const { user, role } = useAuth();
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
  const workflowItems = [
    ...(canSalesWork(role) ? [quoteItem] : []),
    ...(canViewJobOrders(role) && role !== "production" ? [jobItem] : []),
    ...(canAccountingWork(role) || canViewFullReports(role) ? [invoiceItem] : []),
  ];
  const insightItems = [
    ...(canViewFullReports(role) || canViewMoneyWork(role) || canViewStatusOnly(role)
      ? [dashboardItem]
      : []),
    ...(canViewFullReports(role) || canViewMoneyWork(role) ? [reportsItem] : []),
  ];
  const operationsItems: typeof workflowItems = [];
  const administrationItems = canSalesWork(role)
    ? [
        { title: "Business Directory", url: "/customers", icon: Users },
        { title: "Item Templates", url: "/settings/item-templates", icon: Package },
      ]
    : [];
  const personalSignatureItem = role && !canManageUsers(role)
    ? [{ title: "My signature", url: "/settings/users", icon: Settings }]
    : [];
  const visibleAdministrationItems = canManageOperationalSettings(role)
    ? [
        ...administrationItems,
        ...personalSignatureItem,
        ...(canManageUsers(role)
          ? [
              { title: "Users", url: "/settings/users", icon: Settings },
              { title: "Audit Logs", url: "/settings/audit-logs", icon: ScrollText },
            ]
          : []),
      ]
    : [...administrationItems, ...personalSignatureItem];

  const renderNavigationGroup = (label: string, items: typeof workflowItems) => (
      <SidebarGroup className="py-1">
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((it) => {
            const active = pathname === it.url || pathname.startsWith(it.url + "/");
            return (
              <SidebarMenuItem key={it.url}>
                <SidebarMenuButton asChild isActive={active} tooltip={it.title}>
                  <Link to={it.url}>
                    <it.icon />
                    <span>{it.title}</span>
                    {it.title === "Users" && pendingUsers.data ? (
                      <Badge
                        variant="destructive"
                        className="ml-auto min-w-5 justify-center px-1.5 py-0 group-data-[collapsible=icon]:hidden"
                        title={`${pendingUsers.data} account${pendingUsers.data === 1 ? "" : "s"} waiting for role assignment`}
                      >
                        {pendingUsers.data}
                      </Badge>
                    ) : null}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex h-12 items-center px-2 transition-[padding] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <div className="relative h-[25px] w-[105px] overflow-hidden transition-[width,height] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-[collapsible=icon]:h-[22px] group-data-[collapsible=icon]:w-[22px]">
            <img
              src={APP_LOGO_PATH}
              alt={APP_NAME}
              className="absolute left-0 top-1/2 h-[25px] w-[105px] max-w-none -translate-y-1/2 object-contain object-left opacity-100 transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-[collapsible=icon]:scale-95 group-data-[collapsible=icon]:opacity-0"
            />
            <img
              src={APP_ICON_PATH}
              alt=""
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 h-[22px] w-[22px] max-w-none -translate-x-1/2 -translate-y-1/2 scale-95 object-contain opacity-0 transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-[collapsible=icon]:scale-100 group-data-[collapsible=icon]:opacity-100"
            />
          </div>
        </div>
      </SidebarHeader>
        <SidebarContent>
          {operationsItems.length > 0 ? renderNavigationGroup("Operations", operationsItems) : null}
        {workflowItems.length > 0 ? renderNavigationGroup("Workspace", workflowItems) : null}
        {insightItems.length > 0 ? renderNavigationGroup("Insights", insightItems) : null}
        {visibleAdministrationItems.length > 0
          ? renderNavigationGroup("Administration", visibleAdministrationItems)
          : null}
      </SidebarContent>
      <SidebarFooter>
        <div className="p-2 text-xs text-muted-foreground truncate group-data-[collapsible=icon]:hidden">
          {user?.email}
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() =>
                supabase.auth.signOut().then(() => nav({ to: "/auth", replace: true }))
              }
            >
              <LogOut />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
