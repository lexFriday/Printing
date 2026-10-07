import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/settings/bom-templates 2")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/item-templates" });
  },
});
