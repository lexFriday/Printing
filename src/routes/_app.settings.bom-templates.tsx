import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/settings/bom-templates")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/item-templates" });
  },
});
