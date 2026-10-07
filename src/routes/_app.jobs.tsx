import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AccessDenied } from "@/components/system";
import { useAuth } from "@/hooks/useAuth";
import { canSalesWork, canViewJobOrders } from "@/lib/roles";

export const Route = createFileRoute("/_app/jobs")({ component: JobsLayout });

function JobsLayout() {
  const { role } = useAuth();
  if (canViewJobOrders(role)) return <Outlet />;
  return (
    <AccessDenied
      title={
        canSalesWork(role)
          ? "Job workflow is controlled by owner/admin staff"
          : "Limited read-only access"
      }
      description={
        canSalesWork(role)
          ? "Sales can hand off approved quotes, but job status movement is handled by owner/admin staff and billing work is handled by accounting."
          : "Job orders contain operational and financial details that are not available to your role."
      }
    />
  );
}
