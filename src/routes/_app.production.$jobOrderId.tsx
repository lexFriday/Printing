import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronsUpDown,
  Ellipsis,
  PackageCheck,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { WorkflowStepper } from "@/components/workflow-stepper";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { summarizeMaterialReadiness } from "@/lib/fabricationInventory";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  getMaterialPlanActions,
  type CustomMaterialRow,
  validateCustomMaterialRows,
} from "@/lib/productionMaterialRows";
import { normalizeProductionSteps, sortProductionGroupsByItemOrder } from "@/lib/productionSteps";
import { canExecuteProduction } from "@/lib/roles";
import { canAssignProduction } from "@/lib/roles";
import {
  ProductionAssignmentDialog,
  type ProductionAssignmentItem,
} from "@/components/ProductionAssignmentDialog";

export const Route = createFileRoute("/_app/production/$jobOrderId")({
  component: ProductionDocumentPage,
});

function ProductionDocumentPage() {
  const { jobOrderId } = Route.useParams();
  return <ProductionWorkspace jobOrderId={jobOrderId} />;
}

type MaterialRow = {
  id: string;
  planned_quantity: number;
  unit: string;
  material_id: string;
  job_order_line_item_id?: string | null;
  materials?: { name: string } | null;
};

type MaterialOption = { id: string; name: string; unit: string; available?: number };
type ProductionJob = Database["public"]["Tables"]["production_jobs"]["Row"];
type ProductionTask = Database["public"]["Tables"]["production_tasks"]["Row"];
type ItemRecipeSuggestion = {
  id: string;
  name: string;
  item_template_materials?: Array<{
    material_id: string;
    quantity: number;
    version: number;
    materials?: { id: string; name: string; unit: string } | null;
  }>;
};

function MaterialPicker({
  materials,
  selectedId,
  usedIds,
  onSelect,
}: {
  materials: MaterialOption[];
  selectedId: string;
  usedIds: Set<string>;
  onSelect: (material: MaterialOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = materials.find((material) => String(material.id) === String(selectedId));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 w-full justify-between px-3 font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? `${selected.name} · ${selected.unit}` : "Choose material"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search materials…" />
          <CommandList>
            <CommandEmpty>No material found.</CommandEmpty>
            <CommandGroup>
              {materials.map((material) => {
                const isSelected = String(material.id) === String(selectedId);
                const isUsed = usedIds.has(String(material.id)) && !isSelected;
                return (
                  <CommandItem
                    key={material.id}
                    value={`${material.name} ${material.unit}`}
                    disabled={isUsed}
                    onSelect={() => {
                      onSelect(material);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">{material.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {typeof material.available === "number"
                        ? `${material.available} available · `
                        : ""}
                      {material.unit}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function ProductionWorkspace({
  jobOrderId,
  embedded = false,
}: {
  jobOrderId: string;
  embedded?: boolean;
}) {
  const { role } = useAuth();
  const canExecuteMaterials = canExecuteProduction(role);
  const mayAssign = canAssignProduction(role);
  const queryClient = useQueryClient();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [expandedMaterialIds, setExpandedMaterialIds] = useState<Set<string>>(new Set());
  const activeStepRef = useRef<HTMLDivElement | null>(null);
  const [materialAction, setMaterialAction] = useState<{
    materialId: string;
    type: "consume" | "return" | "waste";
  } | null>(null);
  const [holdTask, setHoldTask] = useState<{ id: string; label: string } | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [confirmTask, setConfirmTask] = useState<{
    id: string;
    status: "in_progress" | "done";
    label: string;
  } | null>(null);
  const [customMaterialOpen, setCustomMaterialOpen] = useState(false);
  const [selectedBomSuggestionId, setSelectedBomSuggestionId] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [customMaterials, setCustomMaterials] = useState<CustomMaterialRow[]>([
    { lineId: "", materialId: "", quantity: "", unit: "" },
  ]);
  const [customMaterialAttempted, setCustomMaterialAttempted] = useState(false);
  const [stepEditor, setStepEditor] = useState<{
    itemId: string;
    itemName: string;
    steps: string[];
  } | null>(null);
  const [assigningItem, setAssigningItem] = useState<ProductionAssignmentItem | null>(null);
  const [remarks, setRemarks] = useState("");
  const [remarksDirty, setRemarksDirty] = useState(false);
  const [slaDate, setSlaDate] = useState("");
  const [slaReason, setSlaReason] = useState("");
  useEffect(() => {
    const revealLinkedItem = () => {
      const targetId = decodeURIComponent(window.location.hash.slice(1));
      if (!targetId.startsWith("item-")) return;
      setDetailsOpen(true);
      window.setTimeout(() => {
        document.getElementById(targetId)?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "start",
        });
      }, 0);
    };

    revealLinkedItem();
    window.addEventListener("hashchange", revealLinkedItem);
    return () => window.removeEventListener("hashchange", revealLinkedItem);
  }, [jobOrderId]);
  const customMaterial = customMaterials[0];
  const setCustomMaterial = (
    value: typeof customMaterial | ((previous: typeof customMaterial) => typeof customMaterial),
  ) =>
    setCustomMaterials((rows) =>
      typeof value === "function" ? [value(rows[0]), ...rows.slice(1)] : [value],
    );
  const documentQuery = useQuery({
    queryKey: ["production-document", jobOrderId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("production_job_document", {
        p_job_order_id: jobOrderId,
      });
      if (error) throw error;
      return Array.isArray(data) ? (data[0] ?? null) : data;
    },
  });
  const productionQuery = useQuery({
    queryKey: ["production-job", jobOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_production_job" as any, {
        p_job_order_id: jobOrderId,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? (data[0] ?? null) : data;
      return result?.job_order_id ? result : null;
    },
  });
  useEffect(() => {
    if (!remarksDirty) setRemarks(productionQuery.data?.remarks ?? "");
  }, [productionQuery.data?.remarks, remarksDirty]);
  useEffect(() => {
    const dueAt = (productionQuery.data as any)?.sla_due_at as string | null | undefined;
    if (dueAt) setSlaDate(dueAt.slice(0, 10));
  }, [productionQuery.data]);
  const bomQuery = useQuery({
    queryKey: ["job-order-bom", jobOrderId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("job_boms") as any)
        .select(
          "id,template_version,released_at,job_bom_items(id,planned_quantity,unit,material_id,job_order_line_item_id,materials(name))",
        )
        .eq("job_order_id", jobOrderId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const lineItemsQuery = useQuery({
    queryKey: ["production-line-items", jobOrderId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("production_job_line_items", {
        p_job_order_id: jobOrderId,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const itemRecipeSuggestionsQuery = useQuery({
    queryKey: ["production-item-recipe-suggestions"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("item_templates") as any)
        .select(
          "id,name,item_template_materials!inner(material_id,quantity,version,active,materials(id,name,unit))",
        )
        .eq("is_active", true)
        .eq("item_template_materials.active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ItemRecipeSuggestion[];
    },
    enabled: customMaterialOpen,
  });
  const itemAssignmentsQuery = useQuery({
    queryKey: ["production-item-assignments", jobOrderId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("production_item_assignment_details", {
        p_job_order_id: jobOrderId,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const tasksQuery = useQuery({
    queryKey: ["production-tasks", jobOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ensure_production_tasks" as any, {
        p_job_order_id: jobOrderId,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const itemReadinessQuery = useQuery({
    queryKey: ["production-item-readiness", jobOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("production_item_readiness" as any, {
        p_job_order_id: jobOrderId,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const exceptionsQuery = useQuery({
    queryKey: ["production-exceptions", jobOrderId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("production_material_exceptions") as any)
        .select("id,reason,status,created_at")
        .eq("job_order_id", jobOrderId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const movementsQuery = useQuery({
    queryKey: ["production-movements", jobOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("production_material_activity", {
        p_job_order_id: jobOrderId,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const readinessQuery = useQuery({
    queryKey: ["production-material-readiness", jobOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("production_material_readiness" as any, {
        p_job_order_id: jobOrderId,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const inventorySummaryQuery = useQuery({
    queryKey: ["inventory-material-summary"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("inventory_material_summary");
      if (error) throw error;
      return data ?? [];
    },
  });
  const materialsQuery = useQuery({
    queryKey: ["production-material-options"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("materials") as any)
        .select("id,name,unit,inventory_unit,roll_width_ft,roll_length_ft,category")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  useEffect(() => {
    const selected = (materialsQuery.data ?? []).find(
      (m: any) => String(m.id) === String(customMaterial.materialId),
    );
    if (selected?.unit && customMaterial.unit !== selected.unit)
      setCustomMaterials((rows) =>
        rows.map((row, index) => (index === 0 ? { ...row, unit: selected.unit } : row)),
      );
  }, [customMaterial.materialId, customMaterial.unit, materialsQuery.data]);
  const purchaseRequestsQuery = useQuery({
    queryKey: ["production-purchase-requests", jobOrderId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("purchase_requests") as any)
        .select(
          "id,material_id,status,requested_quantity,received_quantity,ordered_at,expected_at,supplier_name",
        )
        .eq("job_order_id", jobOrderId)
        .in("status", ["requested", "ordered", "partially_received"]);
      if (error) throw error;
      return data ?? [];
    },
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["production-document", jobOrderId] }),
      queryClient.invalidateQueries({ queryKey: ["production-job", jobOrderId] }),
      queryClient.invalidateQueries({ queryKey: ["job", jobOrderId] }),
      queryClient.invalidateQueries({ queryKey: ["job-order", jobOrderId] }),
      queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      queryClient.invalidateQueries({ queryKey: ["job-order-bom", jobOrderId] }),
      queryClient.invalidateQueries({ queryKey: ["production-tasks", jobOrderId] }),
      queryClient.invalidateQueries({ queryKey: ["production-item-readiness", jobOrderId] }),
      queryClient.invalidateQueries({ queryKey: ["production-movements", jobOrderId] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-material-summary"] }),
      queryClient.invalidateQueries({
        queryKey: ["production-material-readiness", jobOrderId],
      }),
      queryClient.invalidateQueries({ queryKey: ["production-purchase-requests", jobOrderId] }),
      queryClient.invalidateQueries({ queryKey: ["production-workspace-queue"] }),
    ]);
  const saveRemarks = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("update_production_remarks", {
        p_job_order_id: jobOrderId,
        p_remarks: remarks,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["production-job", jobOrderId], data);
      setRemarks(data.remarks ?? "");
      setRemarksDirty(false);
      void queryClient.invalidateQueries({ queryKey: ["production-workspace-queue"] });
      toast.success("Production remarks saved");
    },
    onError: (error: Error) =>
      toast.error(error.message || "Unable to save production remarks"),
  });
  const saveSla = useMutation({
    mutationFn: async () => {
      if (!slaDate) throw new Error("Choose a committed completion date.");
      if (!slaReason.trim()) throw new Error("Explain why this SLA is appropriate.");
      const { data, error } = await (supabase.rpc as any)("set_production_sla", {
        p_job_order_id: jobOrderId,
        p_sla_due_at: new Date(`${slaDate}T23:59:59`).toISOString(),
        p_reason: slaReason.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["production-job", jobOrderId], data);
      queryClient.invalidateQueries({ queryKey: ["production-workspace-queue"] });
      setSlaReason("");
      toast.success("Production SLA updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const plan = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("create_production_plan" as any, {
        p_job_order_id: jobOrderId,
        p_job_type: "general",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      await refresh();
      queryClient.setQueryData(
        ["production-job", jobOrderId],
        Array.isArray(data) ? data[0] : data,
      );
    },
    onError: (error: Error) => toast.error(error.message || "Unable to create production plan"),
  });
  const release = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("release_production_from_quote" as any, {
        p_job_order_id: jobOrderId,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (error: Error) =>
      toast.error(
        /no materials found/i.test(error.message)
          ? "This custom item has no project materials configured. Add materials to the Quote or Job Order, then use project materials here."
          : error.message || "Unable to release production",
      ),
  });
  const start = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("start_production" as any, {
        p_job_order_id: jobOrderId,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["production-job", jobOrderId] });
      const previousProduction = queryClient.getQueryData<ProductionJob | null>([
        "production-job",
        jobOrderId,
      ]);
      queryClient.setQueryData<ProductionJob | null>(["production-job", jobOrderId], (current) =>
        current ? { ...current, status: "in_progress" } : current,
      );
      return { previousProduction };
    },
    onError: (error: Error, _variables, context) => {
      queryClient.setQueryData(
        ["production-job", jobOrderId],
        context?.previousProduction,
      );
      toast.error(error.message || "Unable to start production");
    },
    onSettled: refresh,
  });
  const reconcile = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("reconcile_production" as any, {
        p_job_order_id: jobOrderId,
        p_decision: "accept",
        p_reason: "Materials reviewed",
      });
      if (error) throw error;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["production-job", jobOrderId] });
      const previousProduction = queryClient.getQueryData<ProductionJob | null>([
        "production-job",
        jobOrderId,
      ]);
      queryClient.setQueryData<ProductionJob | null>(["production-job", jobOrderId], (current) =>
        current ? { ...current, status: "for_reconciliation" } : current,
      );
      return { previousProduction };
    },
    onError: (error: Error, _variables, context) => {
      queryClient.setQueryData(
        ["production-job", jobOrderId],
        context?.previousProduction,
      );
      toast.error(error.message || "Unable to reconcile materials");
    },
    onSettled: refresh,
  });
  const complete = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("complete_production" as any, {
        p_job_order_id: jobOrderId,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["production-job", jobOrderId] });
      const previousProduction = queryClient.getQueryData<ProductionJob | null>([
        "production-job",
        jobOrderId,
      ]);
      queryClient.setQueryData<ProductionJob | null>(["production-job", jobOrderId], (current) =>
        current ? { ...current, status: "completed" } : current,
      );
      return { previousProduction };
    },
    onSuccess: () => toast.success("Production complete — Job Order is ready for delivery"),
    onError: (error: Error, _variables, context) => {
      queryClient.setQueryData(
        ["production-job", jobOrderId],
        context?.previousProduction,
      );
      toast.error(error.message || "Unable to complete production");
    },
    onSettled: refresh,
  });
  const approve = useMutation({
    mutationFn: async (exceptionId: string) => {
      const { error } = await supabase.rpc("approve_material_exception" as any, {
        p_exception_id: exceptionId,
        p_decision: "approved",
        p_reason: "Approved for local review",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      exceptionsQuery.refetch();
    },
  });
  const updateTask = useMutation({
    mutationFn: async ({
      id,
      status,
      holdReason,
    }: {
      id: string;
      status: string;
      holdReason?: string | null;
    }) => {
      const { error } = await supabase.rpc("update_production_task" as any, {
        p_task_id: id,
        p_status: status,
        p_hold_reason: holdReason ?? null,
      });
      if (error) throw error;
    },
    onMutate: async ({ id, status, holdReason }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["production-job", jobOrderId] }),
        queryClient.cancelQueries({ queryKey: ["production-tasks", jobOrderId] }),
      ]);
      const previousProduction = queryClient.getQueryData<ProductionJob | null>([
        "production-job",
        jobOrderId,
      ]);
      const previousTasks = queryClient.getQueryData<ProductionTask[]>([
        "production-tasks",
        jobOrderId,
      ]);
      const nextTasks = previousTasks?.map((task) =>
        task.id === id
          ? {
              ...task,
              status,
              hold_reason: status === "on_hold" ? (holdReason ?? null) : null,
            }
          : task,
      );
      queryClient.setQueryData(["production-tasks", jobOrderId], nextTasks);
      queryClient.setQueryData<ProductionJob | null>(["production-job", jobOrderId], (current) => {
        if (!current) return current;
        const allDone = nextTasks?.length && nextTasks.every((task) => task.status === "done");
        return { ...current, status: allDone ? "for_reconciliation" : "in_progress" };
      });
      return { previousProduction, previousTasks };
    },
    onError: (error: Error, _variables, context) => {
      queryClient.setQueryData(
        ["production-job", jobOrderId],
        context?.previousProduction,
      );
      queryClient.setQueryData(["production-tasks", jobOrderId], context?.previousTasks);
      toast.error(error.message);
    },
    onSettled: refresh,
  });
  const saveSteps = useMutation({
    mutationFn: async () => {
      if (!stepEditor) throw new Error("Choose an item to customize.");
      const steps = normalizeProductionSteps(stepEditor.steps);
      const { error } = await supabase.rpc("save_custom_item_production_steps" as any, {
        p_job_order_line_item_id: stepEditor.itemId,
        p_steps: steps,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await tasksQuery.refetch();
      setStepEditor(null);
      toast.success("Production steps saved");
    },
    onError: (error: Error) => toast.error(error.message || "Unable to save production steps"),
  });
  const movement = useMutation({
    mutationFn: async ({
      materialId,
      lineItemId,
      type,
      planned,
      quantity: requestedQuantity,
    }: {
      materialId: string;
      lineItemId?: string;
      type: string;
      planned: number;
      quantity?: number;
    }) => {
      const quantity = Number(requestedQuantity ?? quantities[materialId] ?? planned);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Enter a positive quantity");
      if (type === "reserve" && !lineItemId) throw new Error("Choose a production item to reserve.");
      const rpc = type === "reserve" ? "reserve_production_item_inventory" : "record_production_material_activity";
      const args =
        type === "reserve"
          ? {
              p_material_id: materialId,
              p_job_order_id: jobOrderId,
              p_job_order_line_item_id: lineItemId,
              p_quantity: quantity,
              p_idempotency_key: crypto.randomUUID(),
            }
          : {
              p_material_id: materialId,
              p_job_order_id: jobOrderId,
              p_movement_type: type === "consume" ? "consumption" : type,
              p_quantity: quantity,
              p_idempotency_key: crypto.randomUUID(),
            };
      const { error } = await supabase.rpc(rpc as any, args);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (error: any) =>
      toast.error(
        error?.code === "PGRST202"
          ? "Production update is not available yet. Apply the latest database migration."
          : error?.message || "Unable to record material movement",
      ),
  });
  const shortage = useMutation({
    mutationFn: async (materialIds: string[]) => {
      const { data, error } = await supabase.rpc("request_missing_production_materials", {
        p_job_order_id: jobOrderId,
        p_material_ids: materialIds,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
      return data ?? [];
    },
    onSuccess: async (requests) => {
      await refresh();
      toast.success(
        requests.length
          ? `${requests.length} material request${requests.length === 1 ? "" : "s"} sent to Purchasing.`
          : "No additional material request was needed.",
      );
    },
    onError: (error: any) => toast.error(error?.message ?? "Unable to request missing materials"),
  });
  const addCustomMaterial = useMutation({
    mutationFn: async () => {
      const errors = validateCustomMaterialRows(customMaterials);
      if (errors.length) throw new Error(errors[0].message);
      if (!isReleasedBom) {
        const lineId = customMaterials[0].lineId;
        const { error } = await supabase.rpc("confirm_custom_item_materials" as any, {
          p_job_order_id: jobOrderId,
          p_job_order_line_item_id: lineId,
          p_materials: customMaterials.map((row) => ({
            materialId: row.materialId,
            quantity: Number(row.quantity),
            unit: row.unit,
          })),
          p_idempotency_key: crypto.randomUUID(),
        });
        if (error) throw error;
        return;
      }
      for (const row of customMaterials) {
        const { error } = await supabase.rpc("add_custom_job_order_material" as any, {
          p_job_order_id: jobOrderId,
          p_job_order_line_item_id: row.lineId,
          p_material_id: row.materialId,
          p_quantity: Number(row.quantity),
          p_unit: row.unit,
        });
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      const count = customMaterials.length;
      setCustomMaterials([
        { lineId: lineItemsQuery.data?.[0]?.id ?? "", materialId: "", quantity: "", unit: "" },
      ]);
      setCustomMaterialAttempted(false);
      await refresh();
      setCustomMaterialOpen(false);
      toast.success(
        isReleasedBom
          ? `${count} missing ${count === 1 ? "material was" : "materials were"} added and readiness was recalculated.`
          : "Materials confirmed — production setup is ready for stock allocation.",
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const submitCustomMaterials = () => {
    setCustomMaterialAttempted(true);
    if (!validateCustomMaterialRows(customMaterials).length) {
      addCustomMaterial.mutate();
    }
  };
  useEffect(() => {
    const currentStatus = productionQuery.data?.status ?? "not_started";
    if (currentStatus === "in_progress" && activeStepRef.current) {
      activeStepRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [productionQuery.data?.status]);
  if (documentQuery.isLoading)
    return <div className="p-6 text-sm text-muted-foreground">Loading production document…</div>;
  if (documentQuery.isError)
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-destructive">Unable to load this production document.</p>
        <Button variant="outline" onClick={() => documentQuery.refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  if (!documentQuery.data)
    return (
      <div className="space-y-3 p-6">
        <p className="font-medium">
          {role === "production"
            ? "This production item is not assigned to your account."
            : "Production document not found."}
        </p>
        <p className="text-sm text-muted-foreground">
          {role === "production"
            ? "Ask an Owner or Admin to assign you to the item."
            : "It may have been removed or you may not have access."}
        </p>
        <Button variant="outline" asChild>
          <Link to="/production">Back to production</Link>
        </Button>
      </div>
    );
  const job = documentQuery.data;
  const production = productionQuery.data;
  const bom = bomQuery.data;
  const items: MaterialRow[] = bom?.job_bom_items ?? [];
  const isReleasedBom = Boolean(bom?.released_at);
  const hasPreparedBom = Boolean(bom && !isReleasedBom && items.length > 0);
  const status = production?.status ?? "not_started";
  const isCompleted = status === "completed";
  const canRelease = role === "owner" || role === "admin";
  const isPreStart = ["not_started", "preparing", "partially_reserved", "ready_to_start"].includes(
    status,
  );
  const canPlanMaterials =
    Boolean(production) && isReleasedBom && canExecuteMaterials && isPreStart;
  const canRecordMaterialActivity = canExecuteMaterials && status === "in_progress";
  const canAddMissingMaterials =
    canExecuteMaterials &&
    isReleasedBom &&
    ["preparing", "partially_reserved", "ready_to_start", "in_progress"].includes(status);
  const plannedTotal = items.reduce((sum, item) => sum + Number(item.planned_quantity), 0);
  const actualTotal = (movementsQuery.data ?? []).reduce(
    (sum: number, movement: any) =>
      sum +
      (movement.movement_type === "return"
        ? -Number(movement.quantity)
        : ["consumption", "waste"].includes(movement.movement_type)
          ? Number(movement.quantity)
          : 0),
    0,
  );
  const variance = actualTotal - plannedTotal;
  const readinessRows = (readinessQuery.data ?? []).map((row: any) => ({
    plannedQuantity: Number(row.planned_quantity),
    reservedQuantity: Number(row.reserved_quantity),
  }));
  const readiness = summarizeMaterialReadiness(readinessRows);
  const readinessByMaterial = new Map(
    (readinessQuery.data ?? []).map((row: any) => [row.material_id, row]),
  );
  const purchaseByMaterial = new Map(
    (purchaseRequestsQuery.data ?? []).map((request: any) => [request.material_id, request]),
  );
  const inventoryByMaterial = new Map(
    (inventorySummaryQuery.data ?? []).map((material: any) => [material.material_id, material]),
  );
  const activityByMaterial = new Map<
    string,
    { consumed: number; returned: number; wasted: number }
  >();
  for (const movement of movementsQuery.data ?? []) {
    const current = activityByMaterial.get(movement.material_id) ?? {
      consumed: 0,
      returned: 0,
      wasted: 0,
    };
    if (movement.movement_type === "consumption") current.consumed += Number(movement.quantity);
    if (movement.movement_type === "return") current.returned += Number(movement.quantity);
    if (movement.movement_type === "waste") current.wasted += Number(movement.quantity);
    activityByMaterial.set(movement.material_id, current);
  }
  const groupedMaterials = Array.from(
    items
      .reduce((groups, item) => {
        const existing = groups.get(item.material_id) ?? {
          materialId: item.material_id,
          name: item.materials?.name ?? "Material",
          unit: item.unit,
          planned: 0,
          rows: [] as MaterialRow[],
        };
        existing.planned += Number(item.planned_quantity);
        existing.rows.push(item);
        groups.set(item.material_id, existing);
        return groups;
      }, new Map<string, { materialId: string; name: string; unit: string; planned: number; rows: MaterialRow[] }>())
      .values(),
  );
  const displayItems = groupedMaterials.map((group) => ({
    id: group.materialId,
    material_id: group.materialId,
    planned_quantity: group.planned,
    unit: group.unit,
    materials: { name: group.name },
    allocations: group.rows,
  }));
  const purchasingShortageItems = displayItems.filter((item) => {
    const unreserved = Number(readinessByMaterial.get(item.material_id)?.shortage_quantity ?? 0);
    const available = Number(inventoryByMaterial.get(item.material_id)?.available ?? 0);
    return unreserved - available > 0;
  });
  const hasPurchasingShortage = purchasingShortageItems.length > 0;
  const purchasingShortageTotal = purchasingShortageItems.reduce((total, item) => {
    const unreserved = Number(readinessByMaterial.get(item.material_id)?.shortage_quantity ?? 0);
    const available = Number(inventoryByMaterial.get(item.material_id)?.available ?? 0);
    return total + Math.max(0, unreserved - available);
  }, 0);
  const nextStep = isCompleted
    ? "Production is complete. No further material action is required."
    : status === "in_progress"
      ? "Record consumption, returns, and waste as the work happens."
      : status === "for_reconciliation"
        ? "Material usage has been checked. Finish production to make the Job Order ready for delivery."
        : status === "awaiting_approval"
          ? "An exception is waiting for Owner/Admin approval."
          : status === "partially_reserved"
            ? hasPurchasingShortage
              ? "Reserve available stock and create purchasing requests for the remaining shortage."
              : "Reserve the remaining available stock."
            : readiness.isReady
              ? "All planned materials are reserved. Production can start."
              : "Reserve the remaining materials or resolve the shortage before production starts.";
  const groupedTasks = sortProductionGroupsByItemOrder(
    Object.entries(
      ((tasksQuery.data as any[] | undefined) ?? []).reduce(
        (groups: Record<string, any[]>, task: any) => (
          (groups[task.job_order_line_item_id] ??= []).push(task),
          groups
        ),
        {},
      ),
    ).map(([itemId, tasks]) => {
      const readinessItem = (itemReadinessQuery.data as any[] | undefined)?.find(
        (row) => row.job_order_line_item_id === itemId,
      );
      const lineItem = (lineItemsQuery.data as any[] | undefined)?.find((row) => row.id === itemId);
      const item = { ...lineItem, ...readinessItem, quote_line: lineItem?.quote_line };
      const orderedTasks = (tasks as any[]).sort((a, b) => a.task_order - b.task_order);
      const complete =
        orderedTasks.length > 0 && orderedTasks.every((task) => task.status === "done");
      return {
        itemId,
        item,
        tasks: orderedTasks,
        state: complete ? "complete" : (item?.status ?? "blocked"),
      };
    }),
  );
  const nextReadyItem = groupedTasks.find((group) => group.state === "ready");
  const activeGroup = groupedTasks.find((group) => group.state === "in_progress") ?? nextReadyItem;
  const activeTask =
    activeGroup?.tasks.find((task: any) => task.status === "in_progress") ??
    activeGroup?.tasks.find((task: any) => task.status !== "done");
  const isCustomLine = (item: any) => !item?.item_template_id;
  const canEditSteps = (group: any) =>
    canRelease &&
    isCustomLine(group.item) &&
    group.tasks.every((task: any) => task.status === "not_started");
  const openStepEditor = (group: any) =>
    setStepEditor({
      itemId: group.itemId,
      itemName: group.item?.description ?? "Custom item",
      steps: group.tasks.map((task: any) => task.task_type),
    });
  const customizableGroup = groupedTasks.find(canEditSteps);
  const setupBlockedItems = groupedTasks.filter(
    (group) =>
      !(itemReadinessQuery.data as any[] | undefined)?.some(
        (row) => row.job_order_line_item_id === group.itemId,
      ),
  );
  const customSetupBlockedItems = setupBlockedItems.filter((group) => isCustomLine(group.item));
  const materialPlanActions = getMaterialPlanActions({
    canRelease,
    hasProduction: Boolean(production),
    isReleased: isReleasedBom,
    hasPreparedMaterials: hasPreparedBom,
    hasBom: Boolean(bom),
    needsCustomMaterials: customSetupBlockedItems.length > 0,
  });
  const openCustomMaterials = (lineId?: string) => {
    setSelectedBomSuggestionId("");
    setCustomMaterial({
      lineId:
        lineId ??
        customSetupBlockedItems[0]?.itemId ??
        setupBlockedItems[0]?.itemId ??
        lineItemsQuery.data?.[0]?.id ??
        "",
      materialId: "",
      quantity: "",
      unit: "",
    });
    setCustomMaterialOpen(true);
  };
  const selectedMaterialLine = (lineItemsQuery.data ?? []).find(
    (line: any) => line.id === customMaterial.lineId,
  );
  const normalizedMaterialLineDescription = String(selectedMaterialLine?.description ?? "")
    .trim()
    .toLocaleLowerCase();
  const suggestedItemRecipe = (itemRecipeSuggestionsQuery.data ?? []).find(
    (template) =>
      template.id === selectedMaterialLine?.item_template_id ||
      template.name.trim().toLocaleLowerCase() === normalizedMaterialLineDescription,
  );
  const applyBomSuggestion = (suggestionId = selectedBomSuggestionId) => {
    const suggestion = (itemRecipeSuggestionsQuery.data ?? []).find(
      (template) => template.id === suggestionId,
    );
    if (!suggestion) return;
    const lineId = customMaterial.lineId;
    const existingMaterialIds = new Set(
      items
        .filter((item) => item.job_order_line_item_id === lineId)
        .map((item) => item.material_id),
    );
    const proposed = (suggestion.item_template_materials ?? []).filter(
      (component) => !existingMaterialIds.has(component.material_id),
    );
    if (!proposed.length) {
      toast.info("All materials from this BOM are already assigned to the item.");
      return;
    }
    setCustomMaterials(
      proposed.map((component) => ({
        lineId,
        materialId: component.material_id,
        quantity: String(component.quantity),
        unit: component.materials?.unit ?? "",
      })),
    );
    setCustomMaterialAttempted(false);
  };
  const resolveShortages = async () => {
    if (!isReleasedBom) {
      try {
        await release.mutateAsync();
      } catch {
        return;
      }
    }
    await shortage.mutateAsync(purchasingShortageItems.map((item) => item.material_id));
  };
  return (
    <div className={embedded ? "flex flex-col gap-5" : "flex flex-col gap-5 p-3 sm:p-5"}>
      {!canExecuteMaterials && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          You can view this production document, but material actions require an Operations role.
        </p>
      )}
      {status === "completed" && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Production is complete. This document is preserved for reference.
        </p>
      )}
      {!embedded ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button variant="ghost" size="icon" asChild>
            <Link
              to="/jobs/$id"
              params={{ id: jobOrderId }}
              title="Back to this Job Order"
              aria-label="Back to this Job Order"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <p className="text-sm text-muted-foreground">Production workspace · linked Job Order</p>
            <h1 className="text-2xl font-semibold sm:text-3xl">{job.job_number}</h1>
            <p className="text-muted-foreground">{job.project_name}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            {isPreStart && hasPurchasingShortage ? (
              <Button
                size="sm"
                variant="outline"
                disabled={shortage.isPending || release.isPending}
                onClick={resolveShortages}
              >
                Request missing materials
              </Button>
            ) : null}
            <span className="rounded-full bg-muted px-3 py-1 text-sm">
              {status.replaceAll("_", " ")}
            </span>
          </div>
        </div>
      ) : null}
      {!embedded ? (
        <Card className="p-3">
          <WorkflowStepper
            steps={[
              { label: "BOM", state: bom ? "done" : "current" },
              {
                label: "Ready",
                state: [
                  "ready_to_start",
                  "in_progress",
                  "for_reconciliation",
                  "completed",
                ].includes(status)
                  ? "done"
                  : "waiting",
              },
              {
                label: "Production",
                state: ["in_progress", "for_reconciliation", "completed"].includes(status)
                  ? "done"
                  : "waiting",
              },
              {
                label: "Materials Checked",
                state: ["for_reconciliation", "completed"].includes(status) ? "done" : "waiting",
              },
              { label: "Complete", state: status === "completed" ? "done" : "waiting" },
            ]}
          />
        </Card>
      ) : null}
      <Card className="space-y-3 p-4 sm:p-5">
        <div>
          <h2 className="font-semibold">Production SLA</h2>
          <p className="text-sm text-muted-foreground">
            Commit to a realistic completion date. Material shortages remain visible as the exception.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr_auto] sm:items-end">
          <label className="grid gap-1 text-sm font-medium">
            Committed completion date
            <Input type="date" value={slaDate} onChange={(event) => setSlaDate(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Reason for this commitment or revision
            <Input
              value={slaReason}
              maxLength={500}
              placeholder="Scope estimate, material delay, or revised plan"
              onChange={(event) => setSlaReason(event.target.value)}
            />
          </label>
          <Button
            type="button"
            disabled={!production || !slaDate || !slaReason.trim() || saveSla.isPending || status === "completed"}
            onClick={() => saveSla.mutate()}
          >
            {saveSla.isPending ? "Saving…" : "Set SLA"}
          </Button>
        </div>
        <p className="text-sm">
          {hasPurchasingShortage
            ? "Blocked by materials · Purchasing exception active"
            : status === "completed"
              ? `Completed ${production?.completed_at ? new Date(production.completed_at).toLocaleString() : ""}`
              : slaDate
                ? `${new Date(`${slaDate}T23:59:59`) < new Date() ? "Overdue" : new Date(`${slaDate}T23:59:59`).getTime() - Date.now() <= 86_400_000 ? "Due soon" : "On track"} · committed through ${new Date(`${slaDate}T23:59:59`).toLocaleDateString()}`
                : "Default SLA is three working days."}
        </p>
      </Card>
      <Card className="space-y-3 p-4 sm:p-5">
        <div>
          <h2 className="font-semibold">Production remarks</h2>
          <p className="text-sm text-muted-foreground">
            Keep production-specific instructions and handoff context with this Job Order.
          </p>
        </div>
        <Textarea
          value={remarks}
          maxLength={2000}
          rows={4}
          placeholder="Add production remarks…"
          onChange={(event) => {
            setRemarks(event.target.value);
            setRemarksDirty(true);
          }}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">{remarks.length}/2,000 characters</span>
          <Button
            type="button"
            size="sm"
            className="w-full sm:w-auto"
            disabled={!production || !remarksDirty || saveRemarks.isPending}
            onClick={() => saveRemarks.mutate()}
          >
            {saveRemarks.isPending ? "Saving…" : "Save remarks"}
          </Button>
        </div>
      </Card>
      {!embedded ? (
        <Card className="w-full overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="px-4 py-5 sm:px-8 sm:py-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Next action
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                  {status === "completed"
                    ? "Production complete"
                    : customSetupBlockedItems.length
                    ? "Add required materials"
                    : !production
                      ? "Set up production"
                      : !isReleasedBom
                        ? "Review materials"
                        : setupBlockedItems.length
                          ? "Materials needed"
                          : isPreStart && !readiness.isReady
                            ? hasPurchasingShortage
                              ? "Materials needed"
                              : "Reserve materials"
                            : status === "ready_to_start"
                              ? "Ready to begin"
                              : status === "in_progress"
                                ? (activeTask?.task_type ?? "Production in progress")
                                : status === "for_reconciliation"
                                  ? "Material usage checked"
                                   : "Production needs attention"}
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  {status === "completed"
                    ? role === "production"
                      ? "Your production work is complete. The Job Order has been handed off to the delivery workflow."
                      : "This Job Order is ready for the delivery workflow."
                    : customSetupBlockedItems.length
                    ? "This custom item has no materials yet. Add what Production needs before work begins."
                    : !production
                      ? "Create the material plan for this Job Order."
                      : !isReleasedBom
                        ? "Confirm the prepared materials before production begins."
                        : setupBlockedItems.length
                          ? "Add the materials required for this custom item."
                          : isPreStart && !readiness.isReady
                            ? hasPurchasingShortage
                              ? `${purchasingShortageItems.length} material${purchasingShortageItems.length === 1 ? " is" : "s are"} blocking production.`
                              : "Available stock still needs to be reserved."
                            : status === "ready_to_start"
                              ? "All required materials are reserved."
                              : status === "in_progress"
                                ? `${activeGroup?.item?.description ?? "This item"} is active. Complete the current step to keep work moving.`
                                : status === "for_reconciliation"
                                  ? "Finish production to move the Job Order to delivery."
                                   : nextStep}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${isPreStart && !readiness.isReady ? "bg-amber-100 text-amber-900" : status === "completed" ? "bg-emerald-100 text-emerald-800" : "bg-primary/10 text-primary"}`}
              >
                {isPreStart && !readiness.isReady
                  ? "Needs materials"
                  : status === "ready_to_start"
                    ? "Ready"
                    : status === "in_progress"
                      ? "In production"
                      : status === "for_reconciliation"
                        ? "Materials checked"
                        : status === "completed"
                          ? "Complete"
                          : "Setup"}
              </span>
            </div>
            {isReleasedBom && isPreStart && !readiness.isReady ? (
              <div className="mt-5 divide-y rounded-xl border">
                {displayItems
                  .filter(
                    (item) =>
                      Number(readinessByMaterial.get(item.material_id)?.shortage_quantity ?? 0) > 0,
                  )
                  .map((item) => (
                    <div
                      key={item.id}
                      className="flex min-h-14 items-center justify-between gap-4 px-4 py-3"
                    >
                      <span className="font-medium">{item.materials?.name ?? "Material"}</span>
                      <span className="text-sm text-amber-800">
                        Need{" "}
                        {Number(readinessByMaterial.get(item.material_id)?.shortage_quantity ?? 0)}{" "}
                        {item.unit}
                      </span>
                    </div>
                  ))}
              </div>
            ) : null}
            <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap sm:items-center">
              {customSetupBlockedItems.length ? (
                <Button size="lg" className="min-h-11" onClick={() => openCustomMaterials()}>
                  Add required materials
                </Button>
              ) : null}
              {!production && canRelease && !customSetupBlockedItems.length ? (
                <Button
                  size="lg"
                  className="min-h-11"
                  onClick={() => plan.mutate()}
                  disabled={plan.isPending}
                >
                  Create production plan
                </Button>
              ) : null}
              {production &&
              !isReleasedBom &&
              canRelease &&
              (materialPlanActions.primary === "release" ||
                materialPlanActions.primary === "use") ? (
                <Button size="lg" onClick={() => release.mutate()} disabled={release.isPending}>
                  {materialPlanActions.primary === "use"
                    ? "Use project materials"
                    : "Release material plan"}
                </Button>
              ) : null}
              {customizableGroup && groupedTasks.length === 1 ? (
                <Button
                  size="lg"
                  className="min-h-11"
                  variant="outline"
                  onClick={() => openStepEditor(customizableGroup)}
                >
                  Customize production steps
                </Button>
              ) : null}
              {isReleasedBom && isPreStart && hasPurchasingShortage ? (
                <Button
                  size="lg"
                  onClick={resolveShortages}
                  disabled={shortage.isPending || release.isPending}
                >
                  Request {purchasingShortageItems.length} missing material
                  {purchasingShortageItems.length === 1 ? "" : "s"}
                </Button>
              ) : null}
              {isReleasedBom && isPreStart && readiness.isReady ? (
                <Button size="lg" onClick={() => start.mutate()} disabled={start.isPending}>
                  Start production
                </Button>
              ) : null}
              {status === "in_progress" && activeTask ? (
                <Button
                  size="lg"
                  onClick={() =>
                    updateTask.mutate({
                      id: activeTask.id,
                      status: activeTask.status === "in_progress" ? "done" : "in_progress",
                    })
                  }
                  disabled={updateTask.isPending}
                >
                  {activeTask.status === "in_progress" ? "Complete step" : "Start production"}
                </Button>
              ) : null}
              {status === "in_progress" ? (
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => reconcile.mutate()}
                  disabled={reconcile.isPending}
                >
                  Check material usage
                </Button>
              ) : null}
              {status === "for_reconciliation" ? (
                <Button size="lg" onClick={() => complete.mutate()} disabled={complete.isPending}>
                  Complete production
                </Button>
              ) : null}
              {status === "completed" ? (
                role === "production" ? (
                  <Button size="lg" variant="outline" asChild>
                    <Link to="/production">Back to production queue</Link>
                  </Button>
                ) : (
                  <Button size="lg" asChild>
                    <Link to={`/jobs/${jobOrderId}`}>Open Job Order</Link>
                  </Button>
                )
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}
      {isReleasedBom && (
        <div className="hidden rounded-xl border bg-gradient-to-r from-primary/[0.06] via-background to-background px-4 py-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Workflow guidance
          </p>
          <p className="mt-1 text-sm leading-6">
            <span className="font-semibold">
              {setupBlockedItems.length
                ? "Setup needed:"
                : nextReadyItem
                  ? "Next item to produce:"
                  : "Next action:"}
            </span>{" "}
            {setupBlockedItems.length
              ? `Custom item has no project materials configured. Add materials to the Quote or Job Order, then use project materials here.`
              : nextReadyItem
                ? `Start ${nextReadyItem.item?.description ?? "the next ready item"}.`
                : nextStep}
          </p>
          {setupBlockedItems.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-amber-800">
                Fix next: {setupBlockedItems[0].item?.description ?? "item setup"}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setCustomMaterial({
                    lineId: setupBlockedItems[0].itemId,
                    materialId: "",
                    quantity: "",
                    unit: "",
                  });
                  setCustomMaterialOpen(true);
                }}
              >
                Add project materials
              </Button>
            </div>
          ) : null}
        </div>
      )}
      <details
        open={detailsOpen}
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        className="group w-full rounded-xl border bg-card px-4 py-4 shadow-sm sm:px-5"
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-md text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <span>{detailsOpen ? "Hide production details" : "View production details"}</span>
          <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0" />
        </summary>
        <div className="mt-5 space-y-5">
          {groupedTasks.length ? (
            <section aria-labelledby="production-items-heading" className="space-y-3">
              <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 id="production-items-heading" className="text-lg font-semibold">
                    Production items
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Work from the highlighted item, then complete each step in order.
                  </p>
                </div>
                <div
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"
                  aria-label="Production queue summary"
                >
                  <span>
                    {groupedTasks.filter((group) => group.state === "ready").length} ready
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {groupedTasks.filter((group) => group.state === "in_progress").length} in
                    progress
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {groupedTasks.filter((group) => group.state === "blocked").length} need materials
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {groupedTasks.filter((group) => group.state === "complete").length} complete
                  </span>
                </div>
              </div>
              <div className={cn("grid gap-3", groupedTasks.length > 1 && "xl:grid-cols-2")}>
                {groupedTasks.map(({ itemId, item, tasks, state }) => {
                  const shortages = (item?.shortage_materials ?? []) as any[];
                  const itemMaterials = items.filter(
                    (material) => material.job_order_line_item_id === itemId,
                  );
                  const group = { itemId, item, tasks, state };
                  const assignment = (itemAssignmentsQuery.data ?? []).find(
                    (row: any) => row.job_order_line_item_id === itemId,
                  );
                  return (
                    <Card
                      id={`item-${itemId}`}
                      ref={state === "in_progress" ? activeStepRef : undefined}
                      key={itemId}
                      className={`scroll-mt-6 overflow-hidden transition-[border-color,box-shadow,background-color] duration-200 ease-out motion-reduce:transition-none ${state === "in_progress" ? "border-primary bg-primary/[0.03] ring-2 ring-primary/20" : state === "ready" && nextReadyItem?.itemId === itemId ? "border-primary ring-1 ring-primary/20" : ""}`}
                    >
                      <div className="border-b bg-muted/20 px-4 py-4 sm:px-5">
                        <div className="grid gap-3">
                          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-base font-semibold">
                                  {item?.description ?? "Item production steps"}
                                </h3>
                                {state === "in_progress" ? (
                                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                                    Current item
                                  </span>
                                ) : state === "ready" && nextReadyItem?.itemId === itemId ? (
                                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                                    Up next
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <span className="shrink-0 rounded-full bg-background px-2.5 py-1 text-xs font-medium capitalize ring-1 ring-border transition-colors duration-200 motion-reduce:transition-none">
                              {state === "blocked" ? "Needs materials" : state.replaceAll("_", " ")}
                            </span>
                          </div>
                          <div className="grid gap-2">
                            <p className="min-w-0 text-sm text-muted-foreground">
                              <span className="text-base font-semibold text-muted-foreground">Team:</span>{" "}
                              <span className="[overflow-wrap:anywhere]">
                                {assignment?.assigned_names?.length
                                  ? assignment.assigned_names.join(", ")
                                  : "Not assigned yet"}
                              </span>
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              {state === "blocked" &&
                              itemMaterials.length === 0 &&
                              ((canRelease && !isReleasedBom) || canAddMissingMaterials) ? (
                                <Button
                                  size="sm"
                                  className="min-h-11"
                                  onClick={() => openCustomMaterials(itemId)}
                                >
                                  Add materials
                                </Button>
                              ) : null}
                              {mayAssign ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="min-h-11"
                                  onClick={() =>
                                    setAssigningItem({
                                      jobOrderLineItemId: itemId,
                                      label: item?.description ?? "Production item",
                                      assignedUserIds: assignment?.assigned_user_ids ?? [],
                                      isActive: state !== "complete",
                                    })
                                  }
                                >
                                  {assignment?.assigned_names?.length ? "Edit team" : "Assign team"}
                                </Button>
                              ) : null}
                              {canEditSteps(group) && groupedTasks.length > 1 ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="min-h-11"
                                  onClick={() => openStepEditor(group)}
                                >
                                  Customize steps
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        {state === "blocked" ? (
                          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            Missing:{" "}
                            {shortages
                              .map((m) => `${m.material_name ?? "Material"} (${m.shortage})`)
                              .join(", ") || "materials"}
                            . Reserve stock or create a purchasing request.
                          </p>
                        ) : state === "in_progress" ? (
                          <p className="mt-2 text-sm text-muted-foreground">
                            Work on this step now. Complete it to move automatically to the next
                            step.
                          </p>
                        ) : state === "complete" ? (
                          <p className="mt-2 text-sm text-emerald-700">
                            All production steps are complete.
                          </p>
                        ) : null}
                      </div>
                      <ol className="space-y-2 p-4 sm:p-5">
                        {tasks.map((task: any, index) => {
                          const previousComplete = tasks
                            .slice(0, index)
                            .every((previous) => previous.status === "done");
                          const canAct =
                            state !== "blocked" && previousComplete && task.status !== "done";
                          return (
                            <li
                              key={task.id}
                              className={`flex flex-col gap-3 rounded-lg border px-3 py-3 text-sm transition-colors duration-200 motion-reduce:transition-none sm:flex-row sm:items-center sm:justify-between ${task.status === "in_progress" ? "border-primary/40 bg-primary/[0.04]" : ""}`}
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <span
                                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${task.status === "done" ? "bg-emerald-100 text-emerald-800" : task.status === "in_progress" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                                >
                                  {task.status === "done" ? (
                                    <Check aria-hidden="true" className="h-4 w-4" />
                                  ) : (
                                    index + 1
                                  )}
                                </span>
                                <div className="min-w-0">
                                  <p className="font-medium">{task.task_type}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {task.status === "done"
                                      ? "Completed"
                                      : task.status === "in_progress"
                                        ? "In progress now"
                                        : state === "blocked"
                                          ? "Waiting for materials"
                                          : previousComplete
                                            ? "Ready to start"
                                            : "Starts after the previous step"}
                                  </p>
                                </div>
                              </div>
                              <div className="flex min-h-10 items-center justify-end gap-2">
                                {task.status === "done" ? (
                                  <span className="text-sm font-medium text-emerald-700">
                                    Complete
                                  </span>
                                ) : state === "blocked" ? (
                                  <span className="text-xs text-muted-foreground">
                                    Starts after materials are ready
                                  </span>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant={previousComplete ? "default" : "outline"}
                                    disabled={!canAct || updateTask.isPending}
                                    onClick={() =>
                                      updateTask.mutate({
                                        id: task.id,
                                        status:
                                          task.status === "in_progress" ? "done" : "in_progress",
                                      })
                                    }
                                  >
                                    {task.status === "in_progress"
                                      ? "Complete step"
                                      : task.status === "on_hold"
                                        ? "Resume"
                                        : previousComplete
                                          ? "Start production"
                                          : "Starts after previous step"}
                                  </Button>
                                )}
                                {task.status === "in_progress" ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={updateTask.isPending}
                                    onClick={() => {
                                      setHoldReason("");
                                      setHoldTask({ id: task.id, label: task.task_type });
                                    }}
                                  >
                                    Hold
                                  </Button>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                      <section
                        aria-labelledby={`item-materials-${itemId}`}
                        className="border-t bg-muted/10 px-4 py-4 sm:px-5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h4 id={`item-materials-${itemId}`} className="text-sm font-semibold">
                              Materials for this item
                            </h4>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Only the materials assigned to {item?.description ?? "this item"}.
                            </p>
                          </div>
                          {canAddMissingMaterials ? (
                            <Button
                              size="sm"
                              variant={itemMaterials.length ? "outline" : "default"}
                              className="min-h-11"
                              onClick={() => openCustomMaterials(itemId)}
                            >
                              {itemMaterials.length ? "Add missing material" : "Add materials"}
                            </Button>
                          ) : null}
                        </div>
                        {itemMaterials.length ? (
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {itemMaterials.map((material) => {
                              const shortage = shortages.find(
                                (entry) => entry.material_id === material.material_id,
                              );
                              const shortageQuantity = Number(shortage?.shortage ?? 0);
                              const availableQuantity = Number(
                                inventoryByMaterial.get(material.material_id)?.available ?? 0,
                              );
                              const reservableQuantity = Math.min(
                                shortageQuantity,
                                Math.max(0, availableQuantity),
                              );
                              const purchaseQuantity = Math.max(
                                0,
                                shortageQuantity - reservableQuantity,
                              );
                              const purchaseRequest = purchaseByMaterial.get(material.material_id);
                              return (
                                <div key={material.id} className="rounded-lg border bg-background px-3 py-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium">
                                        {material.materials?.name ?? "Material"}
                                      </p>
                                      <p className="mt-0.5 text-xs text-muted-foreground">
                                        Planned {material.planned_quantity} {material.unit}
                                      </p>
                                    </div>
                                    <span
                                      className={cn(
                                        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                                        shortage
                                          ? "bg-amber-100 text-amber-900"
                                          : "bg-emerald-100 text-emerald-800",
                                      )}
                                    >
                                      {shortage ? `Short ${shortage.shortage}` : "Reserved"}
                                    </span>
                                  </div>
                                  {shortage && canPlanMaterials ? (
                                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                                      {reservableQuantity > 0 ? (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          disabled={movement.isPending}
                                          onClick={() =>
                                            movement.mutate({
                                              materialId: material.material_id,
                                              lineItemId: material.job_order_line_item_id ?? itemId,
                                              type: "reserve",
                                              planned: reservableQuantity,
                                              quantity: reservableQuantity,
                                            })
                                          }
                                        >
                                          Reserve {reservableQuantity} {material.unit}
                                        </Button>
                                      ) : null}
                                      {purchaseRequest && mayAssign ? (
                                        <Button size="sm" variant="outline" asChild>
                                          <Link
                                            to="/purchasing/$requestId"
                                            params={{ requestId: purchaseRequest.id }}
                                          >
                                            Open purchase request
                                          </Link>
                                        </Button>
                                      ) : purchaseRequest ? (
                                        <span className="text-sm text-amber-800">
                                          Requested from Purchasing
                                        </span>
                                      ) : purchaseQuantity > 0 ? (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          disabled={shortage.isPending}
                                          onClick={() => shortage.mutate([material.material_id])}
                                        >
                                          {shortage.isPending &&
                                          shortage.variables?.includes(material.material_id)
                                            ? "Creating request…"
                                            : "Request from Purchasing"}
                                        </Button>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="mt-3 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                            No materials assigned yet. Use the item recipe suggestion to add the expected materials here.
                          </p>
                        )}
                      </section>
                    </Card>
                  );
                })}
              </div>
            </section>
          ) : null}
          {canRecordMaterialActivity || status === "for_reconciliation" ? (
          <Card id="material-actions" className="order-3 scroll-mt-6 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">
                  {canRecordMaterialActivity || status === "for_reconciliation"
                    ? "Record job-wide material usage"
                    : "Resolve shared inventory needs"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {!bom && setupBlockedItems.length
                    ? `No materials have been added for ${setupBlockedItems[0].item?.description ?? "this custom item"}. Add what is needed to produce it.`
                    : "Reservations and actual usage are managed here because inventory movements are recorded for the whole Job Order. Planned materials stay with their respective items above."}
                </p>
              </div>
              {!production && !canRelease && (
                <p className="text-sm text-muted-foreground">
                  Waiting for an Owner/Admin to finish production setup.
                </p>
              )}
              {canAddMissingMaterials ? (
                <Button variant="outline" onClick={() => openCustomMaterials()}>
                  Add missing material
                </Button>
              ) : null}
              {production && !isReleasedBom && !canRelease && (
                <p className="text-sm text-muted-foreground">
                  Waiting for an Owner/Admin to release the production plan.
                </p>
              )}
            </div>
            {bom && (
              <>
                <p className="mt-4 text-sm text-muted-foreground">
                  {isReleasedBom
                    ? `Template version ${bom.template_version} · released ${new Date(bom.released_at).toLocaleString()}`
                    : "Prepared Job Order materials · review, then release this BOM for production."}
                </p>
                <div className="mt-4 overflow-x-auto rounded-md border">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span>Material and usage</span>
                    <span className="text-right">Activity</span>
                  </div>
                  {items.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">
                      No materials are attached to this Job Order BOM.
                    </p>
                  ) : (
                    displayItems.map((item) => (
                      <div
                        key={item.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-3 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">{item.materials?.name ?? "Material"}</p>
                          {isReleasedBom && isPreStart ? (
                            <p className="text-sm text-muted-foreground">
                              Planned {item.planned_quantity} {item.unit} · Reserved{" "}
                              {Number(
                                readinessByMaterial.get(item.material_id)?.reserved_quantity ?? 0,
                              )}{" "}
                              · Short{" "}
                              {Number(
                                readinessByMaterial.get(item.material_id)?.shortage_quantity ?? 0,
                              )}
                            </p>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              Planned {item.planned_quantity} {item.unit} · Consumed{" "}
                              {activityByMaterial.get(item.material_id)?.consumed ?? 0} · Returned{" "}
                              {activityByMaterial.get(item.material_id)?.returned ?? 0} · Waste{" "}
                              {activityByMaterial.get(item.material_id)?.wasted ?? 0}
                            </p>
                          )}
                          {(() => {
                            const request = purchaseByMaterial.get(item.material_id);
                            if (inventorySummaryQuery.isLoading) return null;
                            const availableQuantity = Number(
                              inventoryByMaterial.get(item.material_id)?.available ?? 0,
                            );
                            const reservedQuantity = Number(
                              readinessByMaterial.get(item.material_id)?.reserved_quantity ?? 0,
                            );
                            const remainingForMaterial = Math.max(
                              0,
                              Number(item.planned_quantity) - reservedQuantity,
                            );
                            const hasTrueShortage = availableQuantity < remainingForMaterial;
                            if (!request && !hasTrueShortage) return null;
                            return (
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                                <Link
                                  to="/inventory/$materialId"
                                  params={{ materialId: item.material_id }}
                                  className="underline underline-offset-4"
                                >
                                  Open inventory
                                </Link>
                                {request ? (
                                  <Link
                                    to="/purchasing/$requestId"
                                    params={{ requestId: request.id }}
                                    className="underline underline-offset-4"
                                  >
                                    {request.status === "ordered"
                                      ? "Open order"
                                      : "Open purchase request"}
                                  </Link>
                                ) : hasTrueShortage ? (
                                  <span className="text-amber-800">Purchasing action needed</span>
                                ) : (
                                  <span className="text-muted-foreground">
                                    Reserve available stock
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {(expandedMaterialIds.has(item.material_id) ||
                            canPlanMaterials ||
                            canRecordMaterialActivity) && (
                            <>
                              {canRecordMaterialActivity && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      aria-label={`Material actions for ${item.materials?.name ?? "material"}`}
                                    >
                                      <Ellipsis className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        setMaterialAction({
                                          materialId: item.material_id,
                                          type: "consume",
                                        })
                                      }
                                    >
                                      Consume
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        setMaterialAction({
                                          materialId: item.material_id,
                                          type: "return",
                                        })
                                      }
                                    >
                                      Return
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        setMaterialAction({
                                          materialId: item.material_id,
                                          type: "waste",
                                        })
                                      }
                                    >
                                      Waste
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                              <input
                                aria-label={`Quantity for ${item.materials?.name ?? "material"}`}
                                type="number"
                                min="0.001"
                                step="0.001"
                                className="h-9 w-24 rounded-md border bg-background px-2"
                                readOnly={!canPlanMaterials && !canRecordMaterialActivity}
                                aria-readonly={!canPlanMaterials && !canRecordMaterialActivity}
                                value={quantities[item.material_id] ?? item.planned_quantity}
                                onChange={(e) =>
                                  setQuantities((current) => ({
                                    ...current,
                                    [item.material_id]: e.target.value,
                                  }))
                                }
                              />
                              {canPlanMaterials && (
                                <>
                                  {(() => {
                                    const reservationLineItemId = item.allocations.length === 1
                                      ? item.allocations[0].job_order_line_item_id
                                      : null;
                                    const reserved = Number(
                                      readinessByMaterial.get(item.material_id)
                                        ?.reserved_quantity ?? 0,
                                    );
                                    const remainingToReserve = Math.max(
                                      0,
                                      Number(item.planned_quantity) - reserved,
                                    );
                                    const available = Number(
                                      inventoryByMaterial.get(item.material_id)?.available ?? 0,
                                    );
                                    const reservable = Math.min(
                                      remainingToReserve,
                                      Math.max(0, available),
                                    );
                                    const shortageQuantity = Math.max(
                                      0,
                                      remainingToReserve - reservable,
                                    );
                                    return (
                                      <>
                                        {reservationLineItemId && remainingToReserve > 0 && reservable > 0 ? (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() =>
                                              movement.mutate({
                                                materialId: item.material_id,
                                                lineItemId: reservationLineItemId,
                                                type: "reserve",
                                                planned: reservable,
                                                quantity: reservable,
                                              })
                                            }
                                            disabled={movement.isPending}
                                          >
                                            Reserve {reservable} {item.unit}
                                          </Button>
                                        ) : null}
                                        {remainingToReserve > 0 &&
                                        shortageQuantity > 0 &&
                                        !purchaseByMaterial.get(item.material_id) ? (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => shortage.mutate([item.material_id])}
                                            disabled={shortage.isPending || movement.isPending}
                                          >
                                            Request {shortageQuantity} {item.unit} from Purchasing
                                          </Button>
                                        ) : null}
                                        {remainingToReserve <= 0 ? (
                                          <span className="text-sm text-emerald-700">Reserved</span>
                                        ) : null}
                                      </>
                                    );
                                  })()}
                                </>
                              )}
                              {canRecordMaterialActivity && (
                                <>
                                  {(() => {
                                    const planned = Number(item.planned_quantity);
                                    const consumed = Number(
                                      activityByMaterial.get(item.material_id)?.consumed ?? 0,
                                    );
                                    const hasReachedPlan = consumed >= planned;
                                    return (
                                      <div className="flex flex-wrap items-center justify-end gap-2">
                                        <Button
                                          size="sm"
                                          variant="default"
                                          disabled={movement.isPending}
                                          onClick={() =>
                                            movement.mutate({
                                              materialId: item.material_id,
                                              type: "consume",
                                              planned: item.planned_quantity,
                                            })
                                          }
                                        >
                                          {hasReachedPlan ? "Record additional use" : "Consume"}
                                        </Button>
                                        {hasReachedPlan && (
                                          <span className="text-xs text-amber-700">
                                            Adds a material variance
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })()}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={movement.isPending}
                                    onClick={() =>
                                      movement.mutate({
                                        materialId: item.material_id,
                                        type: "return",
                                        planned: item.planned_quantity,
                                      })
                                    }
                                  >
                                    Return
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={movement.isPending}
                                    onClick={() =>
                                      movement.mutate({
                                        materialId: item.material_id,
                                        type: "waste",
                                        planned: item.planned_quantity,
                                      })
                                    }
                                  >
                                    Waste
                                  </Button>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-4 flex justify-end">
                  {isReleasedBom && isPreStart && !readiness.isReady && (
                    <p className="text-sm text-muted-foreground">
                      Resolve the listed shortages below before starting production.
                    </p>
                  )}
                </div>
              </>
            )}
          </Card>
          ) : null}
        </div>
      </details>
      {!embedded && isReleasedBom && (
        <Card className="hidden order-2 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Production actions
          </p>
          <h2 className="mt-1 font-semibold">Next action</h2>
          <p className="mt-1 text-sm text-muted-foreground">{nextStep}</p>
          <div className="mt-3 grid gap-3 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground">Status</p>
              <p className="font-medium capitalize">{status.replaceAll("_", " ")}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Blocker</p>
              <p className="font-medium">
                {isPreStart && readiness.shortageCount > 0
                  ? hasPurchasingShortage
                    ? `${purchasingShortageItems.length} material shortage${purchasingShortageItems.length === 1 ? "" : "s"}`
                    : `${readiness.shortageCount} material${readiness.shortageCount === 1 ? "" : "s"} awaiting reservation`
                  : "No production blocker"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Responsible role</p>
              <p className="font-medium">
                {isPreStart && readiness.shortageCount > 0
                  ? hasPurchasingShortage
                    ? "Purchasing / Operations"
                    : "Operations"
                  : status === "in_progress"
                    ? "Production Staff"
                    : "Operations"}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {status === "completed" && (
              role === "production" ? (
                <Button variant="outline" asChild>
                  <Link to="/production">Back to production queue</Link>
                </Button>
              ) : (
                <Button asChild>
                  <Link to={`/jobs/${jobOrderId}`}>Open Job Order</Link>
                </Button>
              )
            )}
            {(isPreStart || status === "in_progress") &&
              ((!isReleasedBom && readiness.shortageCount > 0) || hasPurchasingShortage) && (
                <Button
                  variant="outline"
                  disabled={
                    (!isReleasedBom && !canRelease) || release.isPending || shortage.isPending
                  }
                  onClick={async () => {
                    if (!isReleasedBom) {
                      release.mutate();
                      return;
                    }
                    await shortage.mutateAsync(
                      purchasingShortageItems.map((item) => item.material_id),
                    );
                  }}
                >
                  <PackageCheck className="mr-2 h-4 w-4" />
                  {!isReleasedBom
                    ? "Release production plan"
                    : status === "in_progress"
                      ? "Request newly missing materials"
                      : "Request missing materials"}
                </Button>
              )}
            {status === "in_progress" && readiness.shortageCount > 0 && (
              <span className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Production has started. Send any newly discovered shortage to Purchasing.
              </span>
            )}
            {status === "in_progress" && (
              <Button onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>
                Check material usage
              </Button>
            )}
            {status === "for_reconciliation" && (
              <Button onClick={() => complete.mutate()} disabled={complete.isPending}>
                Complete production
              </Button>
            )}
            {status === "awaiting_approval" && (
              <>
                {canRelease &&
                  exceptionsQuery.data
                    ?.filter((exception: any) => exception.status === "pending")
                    .map((exception: any) => (
                      <Button
                        key={exception.id}
                        onClick={() => approve.mutate(exception.id)}
                        disabled={approve.isPending}
                      >
                        Approve variance
                      </Button>
                    ))}
                {(!canRelease ||
                  !exceptionsQuery.data?.some(
                    (exception: any) => exception.status === "pending",
                  )) && (
                  <span className="rounded-md bg-muted px-3 py-2 text-sm">Awaiting approval</span>
                )}
              </>
            )}
          </div>
        </Card>
      )}
      {isReleasedBom && !isPreStart && (
        <Card className="p-5">
          <h2 className="font-semibold">Material variance</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground">Planned</p>
              <p className="text-xl font-semibold">{plannedTotal}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Net consumption</p>
              <p className="text-xl font-semibold">{actualTotal}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Variance</p>
              <p className={`text-xl font-semibold ${variance > 0 ? "text-destructive" : ""}`}>
                {variance > 0 ? "+" : ""}
                {variance}
              </p>
            </div>
          </div>
        </Card>
      )}
      {exceptionsQuery.data?.length > 0 && (
        <Card className="p-5">
          <h2 className="font-semibold">Material approvals</h2>
          <div className="mt-3 divide-y">
            {exceptionsQuery.data.map((exception: any) => (
              <div
                key={exception.id}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm">{exception.reason}</p>
                  <p className="text-xs text-muted-foreground">{exception.status}</p>
                </div>
                {exception.status === "pending" && canRelease && (
                  <Button
                    size="sm"
                    onClick={() => approve.mutate(exception.id)}
                    disabled={approve.isPending}
                  >
                    Approve
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
      <Dialog
        open={Boolean(holdTask)}
        onOpenChange={(open) => {
          if (!open && !updateTask.isPending) setHoldTask(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Put task on hold</DialogTitle>
            <DialogDescription>
              Briefly explain what is stopping {holdTask?.label ?? "this task"}. This will be
              visible to the production team.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="hold-reason" className="text-sm font-medium">
              Reason for hold
            </label>
            <textarea
              id="hold-reason"
              autoFocus
              className="min-h-28 w-full resize-y rounded-md border bg-background p-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              value={holdReason}
              onChange={(event) => setHoldReason(event.target.value)}
              placeholder="Example: Waiting for corrected artwork from the customer"
            />
            <p className="text-xs text-muted-foreground">
              The task can be resumed when this blocker is resolved.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={updateTask.isPending}
              onClick={() => setHoldTask(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={!holdReason.trim() || updateTask.isPending}
              onClick={() => {
                if (!holdTask) return;
                updateTask.mutate(
                  {
                    id: holdTask.id,
                    status: "on_hold",
                    holdReason: holdReason.trim(),
                  },
                  {
                    onSuccess: () => {
                      setHoldTask(null);
                      setHoldReason("");
                      toast.success(`${holdTask.label} is now on hold.`);
                    },
                  },
                );
              }}
            >
              {updateTask.isPending ? "Putting on hold…" : "Put on hold"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(confirmTask)} onOpenChange={(open) => !open && setConfirmTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmTask?.status === "done" ? "Complete task?" : "Start task?"}
            </DialogTitle>
            <DialogDescription>
              {confirmTask?.status === "done"
                ? `Mark ${confirmTask?.label ?? "this task"} complete?`
                : `Start ${confirmTask?.label ?? "this task"}?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTask(null)}>
              Cancel
            </Button>
            <Button
              disabled={updateTask.isPending}
              onClick={() => {
                if (confirmTask)
                  updateTask.mutate({ id: confirmTask.id, status: confirmTask.status });
                setConfirmTask(null);
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(materialAction)}
        onOpenChange={(open) => !open && setMaterialAction(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record material activity</DialogTitle>
            <DialogDescription>
              {materialAction?.type === "waste"
                ? "Waste creates a material variance and should be confirmed carefully."
                : `Record ${materialAction?.type ?? "activity"} for this material.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMaterialAction(null)}>
              Cancel
            </Button>
            <Button
              disabled={movement.isPending}
              onClick={() => {
                if (materialAction)
                  movement.mutate({
                    materialId: materialAction.materialId,
                    type: materialAction.type,
                    planned: Number(quantities[materialAction.materialId] ?? 0),
                  });
                setMaterialAction(null);
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(stepEditor)} onOpenChange={(open) => !open && setStepEditor(null)}>
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Customize production steps</DialogTitle>
            <DialogDescription>
              Set the working sequence for {stepEditor?.itemName ?? "this custom item"}. You can
              change it until the first step starts.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-2 overflow-y-auto py-1">
            {stepEditor?.steps.map((step, index) => (
              <div
                key={index}
                className="flex items-center gap-2 rounded-lg border bg-background p-2"
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <Input
                  value={step}
                  maxLength={80}
                  aria-label={`Production step ${index + 1}`}
                  onChange={(event) =>
                    setStepEditor((current) =>
                      current
                        ? {
                            ...current,
                            steps: current.steps.map((value, stepIndex) =>
                              stepIndex === index ? event.target.value : value,
                            ),
                          }
                        : current,
                    )
                  }
                />
                <div className="flex shrink-0 items-center">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={index === 0}
                    aria-label={`Move ${step || `step ${index + 1}`} up`}
                    onClick={() =>
                      setStepEditor((current) => {
                        if (!current || index === 0) return current;
                        const steps = [...current.steps];
                        [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]];
                        return { ...current, steps };
                      })
                    }
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={!stepEditor || index === stepEditor.steps.length - 1}
                    aria-label={`Move ${step || `step ${index + 1}`} down`}
                    onClick={() =>
                      setStepEditor((current) => {
                        if (!current || index === current.steps.length - 1) return current;
                        const steps = [...current.steps];
                        [steps[index], steps[index + 1]] = [steps[index + 1], steps[index]];
                        return { ...current, steps };
                      })
                    }
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={(stepEditor?.steps.length ?? 0) === 1}
                    aria-label={`Remove ${step || `step ${index + 1}`}`}
                    onClick={() =>
                      setStepEditor((current) =>
                        current
                          ? {
                              ...current,
                              steps: current.steps.filter((_, stepIndex) => stepIndex !== index),
                            }
                          : current,
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={(stepEditor?.steps.length ?? 0) >= 12}
            onClick={() =>
              setStepEditor((current) =>
                current ? { ...current, steps: [...current.steps, ""] } : current,
              )
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            Add production step
          </Button>
          <p className="text-xs text-muted-foreground">
            Owner/Admin only · changes are recorded in the audit log.
          </p>
          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setStepEditor(null)}>
              Cancel
            </Button>
            <Button disabled={saveSteps.isPending} onClick={() => saveSteps.mutate()}>
              {saveSteps.isPending ? "Saving…" : "Save production steps"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={customMaterialOpen}
        onOpenChange={(open) => {
          setCustomMaterialOpen(open);
          if (!open) setCustomMaterialAttempted(false);
        }}
      >
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{isReleasedBom ? "Add missing materials" : "Add materials"}</DialogTitle>
            <DialogDescription>
              {isReleasedBom
                ? "Add requirements discovered after release. Existing BOM lines stay unchanged, and each addition is recorded."
                : "Build the material list for this custom item. Units come from Inventory."}
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1 text-sm font-medium">
            Assign materials to item
            <select
              className="h-10 rounded-md border bg-background px-3 font-normal"
              value={customMaterial.lineId}
              onChange={(event) =>
                setCustomMaterials((rows) =>
                  rows.map((row) => ({ ...row, lineId: event.target.value })),
                )
              }
            >
              {(lineItemsQuery.data ?? []).map((line: any) => (
                <option key={line.id} value={line.id}>
                  {line.description}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-muted-foreground">
              All materials in this save will belong only to this item.
            </span>
          </label>
          {suggestedItemRecipe ? (
            <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    Suggested for {selectedMaterialLine?.description ?? "this item"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {suggestedItemRecipe.name} · {suggestedItemRecipe.item_template_materials.length}{" "}
                    material{suggestedItemRecipe.item_template_materials.length === 1 ? "" : "s"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="min-h-11 shrink-0"
                  onClick={() => {
                    setSelectedBomSuggestionId(suggestedItemRecipe.id);
                    applyBomSuggestion(suggestedItemRecipe.id);
                  }}
                >
                  Use {suggestedItemRecipe.name} recipe
                </Button>
              </div>
            </div>
          ) : null}
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="grid min-w-0 flex-1 gap-1 text-sm font-medium">
                Start with a BOM suggestion
                <select
                  className="h-10 rounded-md border bg-background px-3 font-normal"
                  value={selectedBomSuggestionId}
                  onChange={(event) => setSelectedBomSuggestionId(event.target.value)}
                  disabled={
                    itemRecipeSuggestionsQuery.isLoading || itemRecipeSuggestionsQuery.isError
                  }
                >
                  <option value="">
                    {itemRecipeSuggestionsQuery.isLoading
                      ? "Loading item recipes…"
                      : itemRecipeSuggestionsQuery.isError
                        ? "Item recipes unavailable"
                        : "Choose an Item Template recipe (optional)"}
                  </option>
                  {(itemRecipeSuggestionsQuery.data ?? []).map((template) => {
                    const version = Math.max(
                      1,
                      ...(template.item_template_materials ?? []).map(
                        (component) => component.version,
                      ),
                    );
                    return (
                      <option key={template.id} value={template.id}>
                        {template.name} · recipe version {version}
                      </option>
                    );
                  })}
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={!selectedBomSuggestionId || itemRecipeSuggestionsQuery.isLoading}
                onClick={() => applyBomSuggestion()}
              >
                Use suggested materials
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Item Template recipes prefill this form only. Review the materials and quantities
              before saving.
            </p>
          </div>
          <div className="min-h-0 overflow-y-auto rounded-md border">
            <div className="hidden grid-cols-[minmax(0,1fr)_10rem_2.5rem] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
              <span>Material</span>
              <span>Quantity</span>
              <span className="sr-only">Remove</span>
            </div>
            <div className="divide-y">
              {customMaterials.map((row, index) => {
                const errors = customMaterialAttempted
                  ? validateCustomMaterialRows(customMaterials).filter(
                      (error) => error.index === index,
                    )
                  : [];
                const materialError = errors.find((error) => error.field === "materialId")?.message;
                const quantityError = errors.find((error) => error.field === "quantity")?.message;
                const usedIds = new Set(
                  [
                    ...customMaterials
                      .filter((_, rowIndex) => rowIndex !== index)
                      .map((material) => String(material.materialId)),
                    ...items
                      .filter((item) => item.job_order_line_item_id === row.lineId)
                      .map((item) => String(item.material_id)),
                  ].filter(Boolean),
                );
                const materialOptions = (materialsQuery.data ?? []).map((material: any) => ({
                  ...material,
                  available: Number(inventoryByMaterial.get(material.id)?.available ?? 0),
                }));
                return (
                  <div
                    key={index}
                    className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_10rem_2.5rem] sm:items-start"
                  >
                    <div className="grid min-w-0 gap-1">
                      <span className="text-xs font-medium sm:sr-only">Material {index + 1}</span>
                      <MaterialPicker
                        materials={materialOptions}
                        selectedId={row.materialId}
                        usedIds={usedIds}
                        onSelect={(material) =>
                          setCustomMaterials((rows) =>
                            rows.map((value, rowIndex) =>
                              rowIndex === index
                                ? { ...value, materialId: material.id, unit: material.unit }
                                : value,
                            ),
                          )
                        }
                      />
                      {materialError ? (
                        <p className="text-xs text-destructive">{materialError}</p>
                      ) : null}
                    </div>
                    <div className="grid gap-1">
                      <span className="text-xs font-medium sm:sr-only">Quantity</span>
                      <div
                        className={cn(
                          "flex h-10 items-center rounded-md border bg-background",
                          quantityError && "border-destructive",
                        )}
                      >
                        <Input
                          className="h-9 min-w-0 border-0 shadow-none focus-visible:ring-0"
                          aria-label={`Quantity for material ${index + 1}`}
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={row.quantity}
                          onChange={(event) =>
                            setCustomMaterials((rows) =>
                              rows.map((value, rowIndex) =>
                                rowIndex === index
                                  ? { ...value, quantity: event.target.value }
                                  : value,
                              ),
                            )
                          }
                        />
                        {row.unit ? (
                          <select
                            aria-label={`Unit for material ${index + 1}`}
                            className="h-9 max-w-36 shrink-0 border-0 border-l bg-transparent px-2 text-sm text-muted-foreground focus:outline-none"
                            value={row.unit}
                            onChange={(event) =>
                              setCustomMaterials((rows) =>
                                rows.map((value, rowIndex) =>
                                  rowIndex === index ? { ...value, unit: event.target.value } : value,
                                ),
                              )
                            }
                          >
                            <option value={row.unit}>{row.unit}</option>
                            {String((materialOptions.find((m: any) => m.id === row.materialId) as any)?.category ?? "").toLowerCase().includes("tarpaulin") ? (
                              <option value="sqft">Square feet (ft²)</option>
                            ) : null}
                          </select>
                        ) : null}
                      </div>
                      {(() => {
                        const material = materialOptions.find((m: any) => m.id === row.materialId) as any;
                        const quantity = Number(row.quantity);
                        const width = Number(material?.roll_width_ft);
                        const length = Number(material?.roll_length_ft);
                        if (!material || row.unit !== "sqft" || !Number.isFinite(quantity) || quantity <= 0 || width <= 0 || length <= 0) return null;
                        return <p className="text-xs text-muted-foreground">Inventory impact: {(quantity / (width * length)).toFixed(4)} roll · {width} ft × {length} ft capacity</p>;
                      })()}
                      {quantityError ? (
                        <p className="text-xs text-destructive">{quantityError}</p>
                      ) : null}
                    </div>
                    {customMaterials.length > 1 ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-10 w-10 text-muted-foreground hover:text-destructive"
                        aria-label={`Remove material ${index + 1}`}
                        onClick={() =>
                          setCustomMaterials((rows) =>
                            rows.filter((_, rowIndex) => rowIndex !== index),
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : (
                      <span aria-hidden="true" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() =>
              setCustomMaterials((rows) => [
                ...rows,
                { lineId: rows[0]?.lineId ?? "", materialId: "", quantity: "", unit: "" },
              ])
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            Add another material
          </Button>
          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setCustomMaterialOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submitCustomMaterials}
              disabled={addCustomMaterial.isPending}
            >
              {addCustomMaterial.isPending
                ? "Saving…"
                : `Save ${customMaterials.length} ${customMaterials.length === 1 ? "material" : "materials"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ProductionAssignmentDialog
        item={assigningItem}
        onClose={() => setAssigningItem(null)}
        onSaved={async () => {
          await itemAssignmentsQuery.refetch();
        }}
      />
    </div>
  );
}
