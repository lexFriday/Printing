import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ProductionAssignmentItem = {
  jobOrderLineItemId: string;
  label: string;
  assignedUserIds: string[];
  isActive: boolean;
};
type Worker = {
  user_id: string;
  display_name: string | null;
  email: string;
  active_item_count: number;
};

export function ProductionAssignmentDialog({
  item,
  onClose,
  onSaved,
}: {
  item: ProductionAssignmentItem | null;
  onClose: () => void;
  onSaved?: () => Promise<void> | void;
}) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [expectedIds, setExpectedIds] = useState<string[]>([]);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (item && document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement;
    }
    const assignedUserIds = item?.assignedUserIds ?? [];
    setSelectedIds(assignedUserIds);
    setExpectedIds(assignedUserIds);
    setSearch("");
    setConfirmEmpty(false);
  }, [item]);
  const workers = useQuery({
    queryKey: ["production-assignment-options"],
    enabled: Boolean(item),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("production_assignment_options");
      if (error) throw error;
      return (data ?? []) as Worker[];
    },
  });
  const visibleWorkers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle
      ? (workers.data ?? []).filter((worker) =>
          `${worker.display_name ?? ""} ${worker.email}`.toLowerCase().includes(needle),
        )
      : (workers.data ?? []);
  }, [search, workers.data]);
  const close = () => {
    if (saving) return;
    setSearch("");
    setConfirmEmpty(false);
    onClose();
  };
  const save = async () => {
    if (!item) return;
    if (item.isActive && expectedIds.length > 0 && selectedIds.length === 0 && !confirmEmpty) {
      setConfirmEmpty(true);
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("set_production_item_assignments", {
      p_job_order_line_item_id: item.jobOrderLineItemId,
      p_user_ids: [...new Set(selectedIds)],
      p_expected_user_ids: expectedIds,
    });
    setSaving(false);
    if (error) {
      if (/changed since you opened/i.test(error.message ?? "")) {
        const { data: latest, error: refreshError } = await supabase
          .from("production_item_assignments")
          .select("user_id")
          .eq("job_order_line_item_id", item.jobOrderLineItemId)
          .is("removed_at", null);
        if (refreshError) {
          toast.error("Assignments changed, but the latest team could not be loaded. Try again.");
          return;
        }
        const latestIds = (latest ?? []).map(
          (assignment: { user_id: string }) => assignment.user_id,
        );
        setSelectedIds(latestIds);
        setExpectedIds(latestIds);
        setConfirmEmpty(false);
        toast.error(
          "Assignments changed. The latest team will be loaded; review it before saving again.",
        );
        await queryClient.invalidateQueries({ queryKey: ["production-workspace-queue"] });
        return;
      }
      toast.error(error.message || "Unable to save the production team.");
      return;
    }
    toast.success(
      selectedIds.length ? "Production team assigned." : "Item moved to Needs assignment.",
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["production-workspace-queue"] }),
      queryClient.invalidateQueries({ queryKey: ["production-assignment-options"] }),
      queryClient.invalidateQueries({ queryKey: ["production-item-assignments"] }),
      onSaved?.(),
    ]);
    close();
  };
  return (
    <Dialog
      open={Boolean(item)}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        aria-describedby="production-assignment-help"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Assign team</DialogTitle>
          <DialogDescription id="production-assignment-help">
            {item?.label} · Select one or more Production users for this item.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search production users"
            placeholder="Search production users"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {confirmEmpty ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-medium">Remove the final assignee?</p>
            <p className="mt-1">
              This active item will return to Needs assignment. Select Save team again to confirm.
            </p>
          </div>
        ) : null}
        <div className="max-h-72 space-y-2 overflow-y-auto py-1">
          {workers.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading Production users…</p>
          ) : workers.isError ? (
            <div className="rounded-md border border-destructive/40 p-3 text-sm">
              <p className="font-medium text-destructive">Production users could not be loaded.</p>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                onClick={() => workers.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : visibleWorkers.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm">
              <p className="font-medium">No active Production users are available.</p>
              <p className="mt-1 text-muted-foreground">
                Ask an Owner to activate or assign the Production role.
              </p>
            </div>
          ) : (
            visibleWorkers.map((worker) => {
              const checked = selectedIds.includes(worker.user_id);
              return (
                <label
                  key={worker.user_id}
                  className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-muted/40"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) => {
                      setConfirmEmpty(false);
                      setSelectedIds((ids) =>
                        next
                          ? [...new Set([...ids, worker.user_id])]
                          : ids.filter((id) => id !== worker.user_id),
                      );
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {worker.display_name || worker.email}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {worker.active_item_count} active item
                      {worker.active_item_count === 1 ? "" : "s"}
                    </span>
                  </span>
                </label>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || workers.isLoading || workers.isError}>
            {saving ? "Saving…" : "Save team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
