import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AccessDenied } from "@/components/system";
import { useAuth } from "@/hooks/useAuth";
import { canOperatePurchasing, canViewStatusOnly } from "@/lib/roles";

export const Route = createFileRoute("/_app/purchasing")({ component: PurchasingLayout });

function PurchasingLayout() {
  const { role } = useAuth();
  if (!canOperatePurchasing(role) && !canViewStatusOnly(role)) {
    return <AccessDenied title="Purchasing is managed by Admin" description="Production can request missing materials from the Production workspace. Owner and Admin handle suppliers, orders, and receipts here." />;
  }
  return <Outlet />;
}
