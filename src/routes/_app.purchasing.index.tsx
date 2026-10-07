import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShoppingCart } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { canOperatePurchasing } from "@/lib/roles";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { groupPurchaseRequestsByJobOrder, purchaseRequestNextAction } from "@/lib/fabricationInventory";

export const Route = createFileRoute("/_app/purchasing/")({ component: PurchasingQueue });

const formatTin = (value: string) => value.replace(/\D/g, "").slice(0, 15).replace(/(\d{3})(?=\d)/g, "$1-").replace(/-+$/g, "");
const formatPhone = (value: string) => {
  const digits = value.replace(/\D/g, "").replace(/^63/, "").slice(0, 12);
  if (!digits) return "";
  return `+63 ${digits.slice(0, 3)}${digits.length > 3 ? ` ${digits.slice(3, 6)}` : ""}${digits.length > 6 ? ` ${digits.slice(6, 10)}` : ""}`.trim();
};
function PurchasingQueue() {
  const [statusFilter, setStatusFilter] = useState<"all" | "requested" | "ordered" | "partially_received" | "received" | "cancelled">("all");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ name: "", tin_number: "", contact_person: "", address: "", phone: "" });
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestLines, setRequestLines] = useState([{ materialId: "", quantity: "" }]);
  const [requestSupplier, setRequestSupplier] = useState("");
  const { role } = useAuth();
  const navigate = useNavigate();
  const canOperate = canOperatePurchasing(role);
  const materials = useQuery({ queryKey: ["purchasing-materials"], queryFn: async () => { const { data, error } = await (supabase.from("materials") as any).select("id,name,unit,reorder_threshold").eq("is_active", true).order("name"); if (error) throw error; return data ?? []; } });
  const suppliers = useQuery({ queryKey: ["purchasing-suppliers"], queryFn: async () => { const { data, error } = await (supabase.from("suppliers") as any).select("id,name").eq("active", true).order("name"); if (error) throw error; return data ?? []; } });
  const createRequest = useMutation({ mutationFn: async () => { if (!canOperate) throw new Error("You do not have permission to create requests."); if (!requestSupplier) throw new Error("Choose a supplier before creating the request."); const materialIds = requestLines.map((line) => line.materialId).filter(Boolean); if (new Set(materialIds).size !== materialIds.length) throw new Error("Each material can only appear once per request."); if (requestLines.some((line) => !line.materialId || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0)) throw new Error("Choose a material and positive quantity for every row."); const createdIds: string[] = []; for (const line of requestLines) { const { data, error } = await (supabase.rpc as any)("create_standalone_purchase_request", { p_material_id: line.materialId, p_quantity: Number(line.quantity), p_supplier_id: requestSupplier }); if (error) throw error; createdIds.push(data); } return createdIds; }, onSuccess: async (data) => { setRequestOpen(false); setRequestLines([{ materialId: "", quantity: "" }]); setRequestSupplier(""); setStatusFilter("all"); await requests.refetch(); toast.success("Standalone purchase requests created"); if (data?.[0]) navigate({ to: "/purchasing/$requestId", params: { requestId: data[0] } }); }, onError: (e: Error) => toast.error(e.message) });
  const addSupplier = useMutation({ mutationFn: async () => { if (!canOperate || !supplierForm.name.trim()) throw new Error("Supplier name is required"); if (supplierForm.tin_number && !/^\d{9,15}$/.test(supplierForm.tin_number.replace(/[-\s]/g, ""))) throw new Error("TIN must contain 9–15 digits."); if (supplierForm.phone && !/^\+?[0-9 ()-]{7,20}$/.test(supplierForm.phone)) throw new Error("Enter a valid phone number."); const { error } = await (supabase.rpc as any)("create_supplier", { p_name: supplierForm.name.trim(), p_tin_number: supplierForm.tin_number.replace(/[-\s]/g, "") || null, p_contact_person: supplierForm.contact_person.trim() || null, p_address: supplierForm.address.trim() || null, p_phone: supplierForm.phone.trim() || null }); if (error) throw error; }, onSuccess: async () => { setSupplierForm({ name: "", tin_number: "", contact_person: "", address: "", phone: "" }); setSupplierOpen(false); await suppliers.refetch(); toast.success("Supplier added"); }, onError: (e: Error) => toast.error(e.message || "You do not have permission to add suppliers") });
  const requests = useQuery({
    queryKey: ["purchase-requests", statusFilter],
    queryFn: async () => {
      const { data, error } = await (supabase.from("purchase_requests") as any)
        .select(
          "id,purchase_number,job_order_id,requested_quantity,received_quantity,status,supplier_name,supplier_id,ordered_quantity,ordered_at,expected_at,created_at,materials(name,unit),job_orders(job_number,project_name)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return statusFilter === "all" ? (data ?? []) : (data ?? []).filter((row: any) => row.status === statusFilter);
    },
  });
  const production = useQuery({
    queryKey: ["production-queue-for-purchasing"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("production_queue");
      if (error) throw error;
      return data ?? [];
    },
  });
  const requestRows = requests.data ?? [];
  const productionByJob = new Map((production.data ?? []).map((job: any) => [job.job_order_id, job]));
  const prioritizedRows = [...requestRows].sort((left: any, right: any) => {
    const leftOpen = left.status !== "received" && left.status !== "cancelled";
    const rightOpen = right.status !== "received" && right.status !== "cancelled";
    const leftBlocks = leftOpen && (productionByJob.get(left.job_order_id)?.shortage_count ?? 0) > 0;
    const rightBlocks = rightOpen && (productionByJob.get(right.job_order_id)?.shortage_count ?? 0) > 0;
    return Number(rightBlocks) - Number(leftBlocks) || Number(rightOpen) - Number(leftOpen) || String(left.created_at ?? "").localeCompare(String(right.created_at ?? ""));
  });
  const requestsById = new Map(prioritizedRows.map((request: any) => [request.id, request]));
  const openRequests = prioritizedRows.filter((request: any) => request.status !== "received" && request.status !== "cancelled");
  const visibleQueueRows = statusFilter === "all" ? openRequests : prioritizedRows;
  const jobOrderGroups = groupPurchaseRequestsByJobOrder(visibleQueueRows.map((request: any) => ({
    id: request.id,
    jobOrderId: request.job_order_id,
    jobNumber: request.job_orders?.job_number ?? null,
    projectName: request.job_orders?.project_name ?? null,
  })));
  const standaloneRequests = visibleQueueRows.filter((request: any) => !request.job_order_id);
  const showProductionSection = requests.isLoading || requests.isError || jobOrderGroups.length > 0 || visibleQueueRows.length === 0;
  const blockingRequests = openRequests.filter((request: any) => (productionByJob.get(request.job_order_id)?.shortage_count ?? 0) > 0);
  const supplierMissing = openRequests.filter((request: any) => !request.supplier_id && !request.supplier_name);
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-3xl font-semibold">Purchase requests</h1><p className="mt-1 text-muted-foreground">Track material shortages and partial receipts.</p></div>
        <div className="flex gap-2"><Button variant="outline" onClick={() => setSupplierOpen(true)} disabled={!canOperate}>Add supplier</Button><Button onClick={() => setRequestOpen(true)} disabled={!canOperate}>+ New purchase request</Button></div>
      </header>
      <Dialog open={requestOpen} onOpenChange={setRequestOpen}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>New standalone purchase request</DialogTitle></DialogHeader><div className="flex flex-col gap-3"><div className="hidden grid-cols-[1fr_12rem_auto] gap-3 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:grid"><span>Material</span><span>Quantity</span><span /></div>{requestLines.map((line, index) => <div key={index} className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"><Label className="sm:hidden">Material</Label><select value={line.materialId} onChange={(e) => setRequestLines((rows) => rows.map((row, i) => i === index ? { ...row, materialId: e.target.value } : row))} className="h-10 rounded-md border bg-background px-3"><option value="">Select material</option>{(materials.data ?? []).map((m: any) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}</select><Label className="sm:hidden">Quantity</Label><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(e) => setRequestLines((rows) => rows.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row))} placeholder="Quantity to replenish" />{requestLines.length > 1 ? <Button type="button" variant="ghost" onClick={() => setRequestLines((rows) => rows.filter((_, i) => i !== index))}>Remove</Button> : null}</div>)}<Button type="button" variant="outline" onClick={() => setRequestLines((rows) => [...rows, { materialId: "", quantity: "" }])}>Add another material</Button><Label className="order-first" htmlFor="request-supplier">Supplier</Label><select id="request-supplier" value={requestSupplier} onChange={(e) => setRequestSupplier(e.target.value)} className="order-first h-10 rounded-md border bg-background px-3"><option value="">Choose supplier</option>{(suppliers.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div><DialogFooter><Button variant="outline" onClick={() => setRequestOpen(false)}>Cancel</Button><Button onClick={() => createRequest.mutate()} disabled={createRequest.isPending}>{createRequest.isPending ? "Creating…" : "Create request"}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={supplierOpen} onOpenChange={setSupplierOpen}><DialogContent><DialogHeader><DialogTitle>Add supplier</DialogTitle></DialogHeader><div className="grid gap-3"><div><Label htmlFor="supplier-name">Supplier name</Label><Input id="supplier-name" maxLength={120} value={supplierForm.name} onChange={(e) => setSupplierForm({...supplierForm,name:e.target.value})} placeholder="e.g. Metro Print Supply" /></div><div className="grid grid-cols-2 gap-3"><div><Label htmlFor="supplier-contact">Contact person</Label><Input id="supplier-contact" maxLength={120} value={supplierForm.contact_person} onChange={(e) => setSupplierForm({...supplierForm,contact_person:e.target.value})} placeholder="Primary contact" /></div><div><Label htmlFor="supplier-phone">Phone</Label><Input id="supplier-phone" inputMode="tel" maxLength={16} value={supplierForm.phone} onChange={(e) => setSupplierForm({...supplierForm,phone:formatPhone(e.target.value)})} placeholder="+63 917 123 4567" /><p className="mt-1 text-xs text-muted-foreground">Format: +63 917 123 4567</p></div></div><div><Label htmlFor="supplier-tin">TIN</Label><Input id="supplier-tin" inputMode="numeric" maxLength={19} value={supplierForm.tin_number} onChange={(e) => setSupplierForm({...supplierForm,tin_number:formatTin(e.target.value)})} placeholder="123-456-789-000" /><p className="mt-1 text-xs text-muted-foreground">Format: 123-456-789-000</p></div><div><Label htmlFor="supplier-address">Address</Label><Textarea id="supplier-address" maxLength={500} rows={3} value={supplierForm.address} onChange={(e) => setSupplierForm({...supplierForm,address:e.target.value})} placeholder="Business address" /></div></div><DialogFooter><Button variant="outline" onClick={() => setSupplierOpen(false)}>Cancel</Button><Button onClick={() => addSupplier.mutate()} disabled={addSupplier.isPending}>{addSupplier.isPending ? "Saving…" : "Save supplier"}</Button></DialogFooter></DialogContent></Dialog>
      <div className="inline-flex max-w-full flex-wrap rounded-lg border bg-muted/30 p-1" role="tablist" aria-label="Purchase request status"><>{([["all","All"],["requested","Draft"],["ordered","Ordered"],["partially_received","Partially received"],["received","Received"],["cancelled","Cancelled"]] as const).map(([value,label]) => <button key={value} type="button" role="tab" aria-selected={statusFilter===value} onClick={() => setStatusFilter(value)} className={`min-h-10 rounded-md px-3 py-2 text-sm font-medium ${statusFilter===value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}>{label}</button>)}</></div>
      {!requests.isLoading && !requests.isError ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className={blockingRequests.length > 0 ? "border-amber-200 bg-amber-50/60 p-4" : "p-4"}><p className={blockingRequests.length > 0 ? "text-sm text-amber-900" : "text-sm text-muted-foreground"}>{blockingRequests.length > 0 ? "Blocks production" : "Production blockers"}</p><p className="mt-1 text-2xl font-semibold">{blockingRequests.length}</p><p className="text-xs text-muted-foreground">{blockingRequests.length > 0 ? "Resolve these first" : "Everything is ready"}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">Supplier assignments</p><p className="mt-1 text-2xl font-semibold">{supplierMissing.length}</p><p className="text-xs text-muted-foreground">{supplierMissing.length > 0 ? "Choose a supplier to continue" : "All suppliers assigned"}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">Open purchase requests</p><p className="mt-1 text-2xl font-semibold">{openRequests.length}</p><p className="text-xs text-muted-foreground">{openRequests.length > 0 ? "Partial receipts stay open" : "Nothing needs attention"}</p></Card>
        </div>
      ) : null}
      {showProductionSection ? <section className="space-y-3" aria-labelledby="production-purchase-requests">
        <div><h2 id="production-purchase-requests" className="text-lg font-semibold">Production requests by Job Order</h2><p className="text-sm text-muted-foreground">Each group is one production need; supplier and order actions stay on each material request.</p></div>
        {requests.isLoading ? (
          <Card className="p-5"><p className="text-sm text-muted-foreground">Loading purchase requests…</p></Card>
        ) : requests.isError ? (
          <Card className="flex flex-wrap items-center gap-3 p-5"><p className="text-sm text-destructive">Unable to load purchase requests.</p><Button variant="outline" size="sm" onClick={() => requests.refetch()}>Retry</Button></Card>
        ) : visibleQueueRows.length === 0 ? (
          <Card className="flex items-center gap-3 p-5 text-muted-foreground">
            <ShoppingCart className="h-5 w-5" />
            No purchase requests yet.
          </Card>
        ) : (
          <div className="space-y-3">{jobOrderGroups.map((group) => <Card key={group.jobOrderId} className="divide-y p-4 sm:p-5"><div className="pb-3"><p className="font-semibold">{group.jobNumber ?? "Job Order"}</p><p className="text-sm text-muted-foreground">{group.projectName || `${group.requestIds.length} material request${group.requestIds.length === 1 ? "" : "s"}`}</p></div>{group.requestIds.map((requestId) => <PurchaseRequestRow key={requestId} request={requestsById.get(requestId)} production={productionByJob.get(group.jobOrderId)} />)}</Card>)}</div>
        )}
      </section> : null}
      {standaloneRequests.length > 0 ? <section className="space-y-3" aria-labelledby="standalone-purchase-requests"><div><h2 id="standalone-purchase-requests" className="text-lg font-semibold">Standalone inventory requests</h2><p className="text-sm text-muted-foreground">General replenishment not tied to a Job Order.</p></div><Card className="divide-y p-4 sm:p-5">{standaloneRequests.map((request: any) => <PurchaseRequestRow key={request.id} request={request} />)}</Card></section> : null}
    </div>
  );
}

function PurchaseRequestRow({ request, production }: { request: any; production?: any }) {
  if (!request) return null;
  const requested = Number(request.requested_quantity ?? 0);
  const received = Number(request.received_quantity ?? 0);
  const remaining = Math.max(0, requested - received);
  const progress = requested > 0 ? Math.min(100, Math.round((received / requested) * 100)) : 0;
  const isOpen = request.status === "requested" || request.status === "ordered" || request.status === "partially_received";
  const action = purchaseRequestNextAction(request.status, request.supplier_name);
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">
          {request.materials?.name ?? "Material"} ·{" "}
          {request.job_orders ? (
            <Link
              to="/jobs/$id"
              params={{ id: request.job_order_id }}
              className="underline-offset-4 hover:underline"
            >
              {request.job_orders.job_number}
            </Link>
          ) : (
            "Unlinked"
          )}
        </p>
        <p className="text-sm text-muted-foreground">{request.job_orders?.project_name ?? ""}</p>
        {isOpen && production?.shortage_count > 0 ? <p className="mt-1 text-sm font-medium text-amber-800">Blocks production until received</p> : null}
        {request.status === "ordered" ? <p className="mt-1 text-sm text-muted-foreground">Order placed{request.expected_at ? ` · expected ${new Date(request.expected_at).toLocaleDateString()}` : ""}</p> : null}
        <div className="mt-2 h-1.5 w-56 max-w-full overflow-hidden rounded-full bg-muted" aria-label={`${progress}% received`}>
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-3 sm:text-right">
        <div className="text-sm">
          <p>{received} / {requested} {request.materials?.unit ?? ""}</p>
          <p className="text-muted-foreground">{remaining > 0 ? `${remaining} remaining` : "Fully received"}</p>
        </div>
        <Badge variant={remaining > 0 ? "secondary" : "default"}>{action}</Badge>
        <Button asChild variant="outline" size="sm">
          <Link to="/purchasing/$requestId" params={{ requestId: request.id }}>Open</Link>
        </Button>
      </div>
    </div>
  );
}
