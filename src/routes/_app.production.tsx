import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/production")({ component: ProductionLayout });

function ProductionLayout() {
  return <Outlet />;
}
