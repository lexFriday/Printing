import { createFileRoute } from "@tanstack/react-router";
import { ItemTemplatesPage } from "@/components/ItemTemplatesView";

export const Route = createFileRoute("/_app/settings/item-templates")({
  head: () => ({ meta: [{ title: "Item Templates — AutoMate PH" }] }),
  component: ItemTemplatesPage,
});
