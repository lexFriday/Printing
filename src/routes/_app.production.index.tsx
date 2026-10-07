import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ClipboardList, UserRoundPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ProductionAssignmentDialog,
  type ProductionAssignmentItem,
} from "@/components/ProductionAssignmentDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { canAssignProduction } from "@/lib/roles";
import { productionStatusLabel } from "@/lib/productionQueue";

export const Route = createFileRoute("/_app/production/")({ component: ProductionPage });

type QueueItem = {
  job_order_line_item_id: string;
  job_order_id: string;
  job_number: string;
  project_name: string;
  item_description: string;
  quantity: number;
  item_order: number;
  customer_name: string | null;
  target_completion_date: string | null;
  job_status: string;
  production_status: string | null;
  item_status: string;
  shortage_count: number;
  current_task: string | null;
  next_action: string | null;
  assigned_user_ids: string[];
  assigned_names: string[];
  is_unassigned: boolean;
  item_completed: boolean;
};
type View = "needs_assignment" | "active" | "completed";

function ProductionPage() {
  const { role } = useAuth();
  const mayAssign = canAssignProduction(role);
  const isProductionUser = role === "production";
  const [view, setView] = useState<View>(mayAssign ? "needs_assignment" : "active");
  const [assigning, setAssigning] = useState<ProductionAssignmentItem | null>(null);
  const items = useQuery({
    queryKey: ["production-workspace-queue"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("production_queue" as any);
      if (error) throw error;
      return (data ?? []).map((item: any) => ({
        ...item,
        job_order_line_item_id: item.job_order_line_item_id ?? item.job_order_id,
        item_description: item.item_description ?? item.project_name,
        quantity: item.quantity ?? 1,
        item_order: item.item_order ?? 0,
        customer_name: item.customer_name ?? null,
        target_completion_date: item.target_completion_date ?? null,
        item_status: item.item_status ?? item.job_status,
        current_task: item.current_task ?? null,
        assigned_user_ids: item.assigned_user_ids ?? [],
        assigned_names: item.assigned_names ?? [],
        is_unassigned: item.is_unassigned ?? false,
        item_completed: item.item_completed ?? item.job_status === "completed",
      })) as QueueItem[];
    },
  });
  const isCompleted = (item: QueueItem) => item.item_completed;
  const counts = useMemo(
    () => ({
      needs_assignment: (items.data ?? []).filter(
        (item) => item.is_unassigned && !isCompleted(item),
      ).length,
      active: (items.data ?? []).filter((item) => !item.is_unassigned && !isCompleted(item)).length,
      completed: (items.data ?? []).filter(isCompleted).length,
    }),
    [items.data],
  );
  const visibleItems = useMemo(
    () =>
      (items.data ?? []).filter((item) =>
        view === "needs_assignment"
          ? item.is_unassigned && !isCompleted(item)
          : view === "completed"
            ? isCompleted(item)
            : !item.is_unassigned && !isCompleted(item),
      ),
    [items.data, view],
  );
  const openAssignment = (item: QueueItem) =>
    setAssigning({
      jobOrderLineItemId: item.job_order_line_item_id,
      label: `${item.job_number} · ${item.item_description}`,
      assignedUserIds: item.assigned_user_ids ?? [],
      isActive: !item.item_completed,
    });
  const views: Array<[View, string]> = [
    ["needs_assignment", "Needs assignment"],
    ["active", "Active"],
    ["completed", "Completed"],
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-3 sm:px-0">
      <header>
        <p className="text-sm text-muted-foreground">Production workspace</p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          {isProductionUser ? "My Production" : "Production queue"}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {isProductionUser
            ? "Work on your assigned items. Each item shows what is blocking it and what to do next."
            : mayAssign
              ? "Assign each item, then monitor blockers and progress."
              : "Monitor production items, blockers, and progress."}
        </p>
      </header>
      <Card className="overflow-hidden">
        <div
          className="flex flex-wrap gap-2 border-b p-4"
          role="tablist"
          aria-label="Production views"
        >
          {views
            .filter(([value]) => mayAssign || value !== "needs_assignment")
            .map(([value, label]) => (
              <Button
                key={value}
                role="tab"
                aria-selected={view === value}
                size="sm"
                variant={view === value ? "default" : "ghost"}
                onClick={() => setView(value)}
              >
                {label} <span className="ml-1 opacity-75">{counts[value]}</span>
              </Button>
            ))}
        </div>
        {items.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading production items…</p>
        ) : items.isError ? (
          <div className="flex flex-wrap items-center gap-3 p-6">
            <div>
              <p className="font-medium text-destructive">Production items could not be loaded.</p>
              <p className="text-sm text-muted-foreground">
                Check your connection, then try again.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => items.refetch()}>
              Try again
            </Button>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 p-8 text-center">
            <ClipboardList className="h-6 w-6 text-muted-foreground" />
            <p className="font-medium">
              {view === "needs_assignment"
                ? "No production jobs need assignment."
                : view === "completed"
                  ? "No completed production items"
                  : isProductionUser
                    ? "You have no assigned production work."
                    : "No active production items"}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              {view === "needs_assignment"
                ? "New Job Order items that need owners will appear here."
                : isProductionUser
                  ? "An Owner or Admin can assign a production item to you."
                  : "New production work will appear here automatically."}
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {visibleItems.map((item) => (
              <article
                key={item.job_order_line_item_id}
                className="grid gap-4 p-4 transition-colors hover:bg-muted/30 sm:p-5 md:grid-cols-[1fr_auto] md:items-center"
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/production/$jobOrderId"
                      params={{ jobOrderId: item.job_order_id }}
                      hash={`item-${item.job_order_line_item_id}`}
                      className="font-semibold underline-offset-4 hover:underline"
                    >
                      {item.job_number} · {item.item_description}
                    </Link>
                    <Badge variant={item.shortage_count > 0 ? "destructive" : "secondary"}>
                      {productionStatusLabel(item.production_status)}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {item.project_name} · Qty {item.quantity}
                    {item.customer_name ? ` · ${item.customer_name}` : ""}
                    {item.target_completion_date
                      ? ` · Due ${new Date(item.target_completion_date).toLocaleDateString()}`
                      : ""}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Status:</span>{" "}
                    {productionStatusLabel(item.item_status)}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Next:</span>{" "}
                    {item.next_action || item.current_task || "Open this item to continue"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {item.is_unassigned
                      ? "Unassigned — assign at least one Production user."
                      : `Assigned to ${item.assigned_names.join(", ")}`}
                    {item.shortage_count
                      ? ` · Blocked by ${item.shortage_count} material shortage${item.shortage_count === 1 ? "" : "s"}`
                      : ""}
                  </p>
                </div>
                <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap md:justify-end">
                  {mayAssign ? (
                    <Button
                      className="w-full sm:w-auto"
                      variant="outline"
                      onClick={() => openAssignment(item)}
                    >
                      <UserRoundPlus className="mr-2 h-4 w-4" />
                      Assign team
                    </Button>
                  ) : null}
                  <Button className="w-full sm:w-auto" asChild>
                    <Link
                      to="/production/$jobOrderId"
                      params={{ jobOrderId: item.job_order_id }}
                      hash={`item-${item.job_order_line_item_id}`}
                    >
                      Open item
                    </Link>
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
      <ProductionAssignmentDialog item={assigning} onClose={() => setAssigning(null)} />
    </div>
  );
}
