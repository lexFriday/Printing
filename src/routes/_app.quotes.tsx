import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AccessDenied } from "@/components/system";
import { useAuth } from "@/hooks/useAuth";
import { canSalesWork } from "@/lib/roles";

export const Route = createFileRoute("/_app/quotes")({
  component: QuotesLayout,
});

function QuotesLayout() {
  const { role } = useAuth();
  if (!canSalesWork(role)) {
    return (
      <AccessDenied
        title="Limited read-only access"
        description="Quotes are handled by sales, owner, and admin staff users."
      />
    );
  }
  return <Outlet />;
}
