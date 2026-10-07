import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AccessDenied } from "@/components/system";
import { useAuth } from "@/hooks/useAuth";
import { canAccountingWork, canViewFullReports } from "@/lib/roles";

export const Route = createFileRoute("/_app/invoices")({ component: InvoicesLayout });

function InvoicesLayout() {
  const { role } = useAuth();
  if (canAccountingWork(role) || canViewFullReports(role)) return <Outlet />;
  return (
    <AccessDenied
      title="Limited read-only access"
      description="Invoices are available to accounting, owner, and admin staff users."
    />
  );
}
