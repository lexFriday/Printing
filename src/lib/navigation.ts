import {
  BarChart3,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Package,
  Receipt,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@/hooks/useAuth";
import {
  canAccountingWork,
  canManageOperationalSettings,
  canManageUsers,
  canSalesWork,
  canViewFullReports,
  canViewJobOrders,
  canViewMoneyWork,
  canViewStatusOnly,
} from "@/lib/roles";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
};

const quoteItem: NavItem = { title: "Quotes", url: "/quotes", icon: FileText };
const jobItem: NavItem = { title: "Job Orders", url: "/jobs", icon: ClipboardList };
const invoiceItem: NavItem = { title: "Invoices", url: "/invoices", icon: Receipt };
const dashboardItem: NavItem = { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard };
const reportsItem: NavItem = { title: "Reports", url: "/reports", icon: BarChart3 };

export function getNavigationGroups(role: AppRole | null) {
  const workflowItems: NavItem[] = [
    ...(canSalesWork(role) ? [quoteItem] : []),
    ...(canViewJobOrders(role) && role !== "production" ? [jobItem] : []),
    ...(canAccountingWork(role) || canViewFullReports(role) ? [invoiceItem] : []),
  ];

  const insightItems: NavItem[] = [
    ...(canViewFullReports(role) || canViewMoneyWork(role) || canViewStatusOnly(role)
      ? [dashboardItem]
      : []),
    ...(canViewFullReports(role) || canViewMoneyWork(role) ? [reportsItem] : []),
  ];

  const baseAdministrationItems: NavItem[] = canSalesWork(role)
    ? [
        { title: "Business Directory", url: "/customers", icon: Users },
        { title: "Item Templates", url: "/settings/item-templates", icon: Package },
      ]
    : [];

  const personalSignatureItem: NavItem[] =
    role && !canManageUsers(role)
      ? [{ title: "My signature", url: "/settings/users", icon: Settings }]
      : [];

  const administrationItems: NavItem[] = canManageOperationalSettings(role)
    ? [
        ...baseAdministrationItems,
        ...personalSignatureItem,
        ...(canManageUsers(role)
          ? [
              { title: "Users", url: "/settings/users", icon: Settings },
              { title: "Audit Logs", url: "/settings/audit-logs", icon: ScrollText },
            ]
          : []),
      ]
    : [...baseAdministrationItems, ...personalSignatureItem];

  return {
    workflowItems,
    insightItems,
    administrationItems,
  };
}
