import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { canApproveOperationalException, canOperatePurchasing } from "@/lib/roles";
import { displayReceiptQuantity, parseReceiptQuantity } from "@/lib/purchaseReceiptQuantity";

export const Route = createFileRoute("/_app/purchasing/$requestId")({
  component: PurchaseDocument,
});
function PurchaseDocument() {
  const { requestId } = Route.useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const canOperate = canOperatePurchasing(role);
  const canCancel = canApproveOperationalException(role);
  const qc = useQueryClient();
  const [receiveQuantity, setReceiveQuantity] = useState<string | null>(null);
  const [newSupplier, setNewSupplier] = useState("");
  const [supplierReference, setSupplierReference] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const q = useQuery({
    queryKey: ["purchase-document", requestId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("purchase_requests") as any)
        .select(
          "id,purchase_number,requested_quantity,received_quantity,status,supplier_name,supplier_id,ordered_quantity,ordered_at,expected_at,supplier_reference,created_at,job_order_id,material_id,materials(name,unit),job_orders(job_number,project_name)",
        )
        .eq("id", requestId)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const suppliers = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("suppliers") as any)
        .select("id,name")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const receipts = useQuery({
    queryKey: ["purchase-receipts", requestId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("material_receipts") as any)
        .select("id,quantity,received_at")
        .eq("purchase_request_id", requestId)
        .order("received_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const saveSupplier = useMutation({
    mutationFn: async (supplierId?: string) => {
      if (!canOperate) throw new Error("Your role cannot select a supplier.");
      const name = newSupplier.trim();
      if (!supplierId && !name) throw new Error("Choose or enter a supplier");
      const { error } = await (supabase.rpc as any)("set_purchase_request_supplier", {
        p_request_id: requestId,
        p_supplier_id: supplierId ?? null,
        p_new_supplier_name: supplierId ? null : name,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setNewSupplier("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["purchase-document", requestId] }),
        qc.invalidateQueries({ queryKey: ["suppliers"] }),
      ]);
      toast.success("Supplier added");
    },
    onError: (e: Error) => toast.error(e.message || "Unable to add supplier"),
  });
  const receive = useMutation({
    mutationFn: async () => {
      if (!canOperate) throw new Error("Your role cannot record purchase receipts.");
      const r = q.data as any;
      const rawRemaining = Number(r.requested_quantity) - Number(r.received_quantity ?? 0);
      const quantity = Math.min(parseReceiptQuantity(receiveQuantity, rawRemaining), rawRemaining);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Enter a positive quantity");
      const { error } = await (supabase.rpc as any)("receive_purchase_request", {
        p_request_id: requestId,
        p_quantity: quantity,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["purchase-document", requestId] }),
        qc.invalidateQueries({ queryKey: ["purchase-requests"] }),
        qc.invalidateQueries({ queryKey: ["inventory-materials"] }),
        qc.invalidateQueries({ queryKey: ["jobs"] }),
        qc.invalidateQueries({ queryKey: ["production-document"] }),
        qc.invalidateQueries({ queryKey: ["purchase-receipts", requestId] }),
      ]);
      setReceiveQuantity(null);
      const jobOrderId = (q.data as any)?.job_order_id as string | null;
      if (jobOrderId) {
        const { data: readiness, error } = await supabase.rpc("production_material_readiness" as any, {
          p_job_order_id: jobOrderId,
        });
        if (!error && !(readiness ?? []).some((row: any) => Number(row.shortage_quantity) > 0)) {
          toast.success("Shortages resolved. Returning to Production.");
          navigate({ to: "/production/$jobOrderId", params: { jobOrderId } });
          return;
        }
      }
      toast.success("Receipt recorded. Return to Production when the remaining shortages are resolved.");
    },
    onError: async (e: Error) => { await q.refetch(); toast.error(/unavailable/i.test(e.message) ? "This request was already completed or cancelled. The page was refreshed." : (e.message || "Unable to record receipt")); },
  });
  const markOrdered = useMutation({
    mutationFn: async () => {
      if (!canOperate) throw new Error("Your role cannot place purchase orders.");
      const r = q.data as any;
      const remaining = Number(r.requested_quantity) - Number(r.received_quantity ?? 0);
      const { error } = await (supabase.rpc as any)("mark_purchase_request_ordered", {
        p_request_id: requestId,
        p_ordered_quantity: remaining,
        p_supplier_reference: supplierReference.trim() || null,
        p_expected_at: expectedAt ? new Date(`${expectedAt}T00:00:00`).toISOString() : null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["purchase-document", requestId] }), qc.invalidateQueries({ queryKey: ["purchase-requests"] })]);
      setSupplierReference("");
      setExpectedAt("");
      toast.success("Order recorded. Purchasing can now record the receipt when it arrives.");
    },
    onError: (e: Error) => toast.error(e.message || "Unable to record order"),
  });
  const cancelRemainder = useMutation({
    mutationFn: async () => {
      if (!canCancel) throw new Error("Only an owner or admin can cancel a purchase remainder.");
      const { error } = await (supabase.rpc as any)("cancel_purchase_request_remainder", {
        p_request_id: requestId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["purchase-document", requestId] }),
        qc.invalidateQueries({ queryKey: ["purchase-requests"] }),
        qc.invalidateQueries({ queryKey: ["inventory-materials"] }),
      ]);
      toast.success("Remaining purchase quantity cancelled");
    },
    onError: (e: Error) => toast.error(e.message || "Unable to cancel remainder"),
  });
  if (q.isLoading) return <p>Loading purchase request…</p>;
  if (q.isError) return <div className="flex flex-wrap items-center gap-3"><p className="text-destructive">Unable to load this purchase request and its receipt history.</p><Button variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button></div>;
  const r = q.data as any;
  const rawRemaining = Math.max(0, Number(r.requested_quantity) - Number(r.received_quantity ?? 0));
  const remaining = Number(rawRemaining.toFixed(3));
  const receiptQuantity = parseReceiptQuantity(receiveQuantity, rawRemaining);
  const canRecordReceipt = Number.isFinite(receiptQuantity) && receiptQuantity > 0;
  const receiptProgress = Number(r.requested_quantity) > 0 ? Math.min(100, Math.round((Number(r.received_quantity ?? 0) / Number(r.requested_quantity)) * 100)) : 0;
  const isReadyToOrder = r.status === "requested" && Boolean(r.supplier_id);
  const isReceivedJob = r.status === "received" && Boolean(r.job_order_id);
  return (
    <div className="space-y-5">
      <Link to="/purchasing" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">← Back to Purchasing</Link>
      <header className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b pb-5">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Purchasing document</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Purchase request <span className="text-lg font-medium text-muted-foreground">{r.purchase_number}</span></h1>
        </div>
        <div className="flex min-w-0 items-center gap-4 sm:ml-auto">
          <p className="truncate text-sm text-muted-foreground">{r.materials?.name} · {r.status}</p>
          <span className="shrink-0 rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium">{r.status === "requested" ? "Action needed" : r.status === "ordered" ? "Awaiting receipt" : r.status === "partially_received" ? "Partially received" : "Closed"}</span>
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 shadow-sm">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current status</p>
          <p className="mt-1 font-medium">{r.status === "requested" && !r.supplier_id ? "Needs a supplier" : r.status === "requested" ? "Ready to order" : r.status === "ordered" ? "Waiting for delivery" : r.status === "partially_received" ? `${remaining} ${r.materials?.unit ?? "units"} still expected` : r.status === "received" ? "All stock received" : "Cancelled"}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="text-sm text-muted-foreground">{isReceivedJob ? "Stock received. Return to Production to reserve it for this Job Order." : r.status === "requested" && !r.supplier_id ? "Choose a supplier below." : r.status === "requested" ? "Place the order to begin receiving." : r.status === "ordered" ? "Record the delivery when it arrives." : r.status === "partially_received" ? "Record the remaining delivery or close the remainder." : r.status === "received" ? "Inventory is up to date." : "No further action is required."}</p>
          {isReceivedJob ? <Button size="sm" asChild><Link to="/production/$jobOrderId" params={{ jobOrderId: r.job_order_id }}>Open Production</Link></Button> : null}
          {isReadyToOrder && canOperate ? <Button size="sm" onClick={() => markOrdered.mutate()} disabled={markOrdered.isPending}>{markOrdered.isPending ? "Placing…" : "Place order"}</Button> : null}
          {remaining > 0 && canOperate && r.status !== "requested" && r.status !== "cancelled" ? <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="receipt-quantity">Quantity to receive</label>
            <input id="receipt-quantity" aria-label="Quantity received" type="number" min="0.001" step="0.001" max={rawRemaining} value={displayReceiptQuantity(receiveQuantity, remaining)} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setReceiveQuantity(e.target.value)} className="h-9 w-24 rounded-md border bg-background px-2 text-sm" />
            <AlertDialog>
              <AlertDialogTrigger asChild><Button size="sm" disabled={receive.isPending || !canRecordReceipt}>{receive.isPending ? "Recording…" : "Record receipt"}</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>Record this stock receipt?</AlertDialogTitle><AlertDialogDescription>This will add {displayReceiptQuantity(receiveQuantity, remaining) || "the entered quantity"} {r.materials?.unit} to Inventory for {r.materials?.name ?? "this material"}.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Review quantity</AlertDialogCancel><AlertDialogAction onClick={() => receive.mutate()}>Post receipt</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {canCancel ? <AlertDialog><AlertDialogTrigger asChild><Button size="sm" variant="outline" disabled={cancelRemainder.isPending}>Cancel remainder</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Cancel the remaining purchase quantity?</AlertDialogTitle><AlertDialogDescription>Received stock stays recorded. This only closes the unreceived remainder.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep request open</AlertDialogCancel><AlertDialogAction onClick={() => cancelRemainder.mutate()}>Cancel remainder</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog> : null}
          </div> : null}
        </div>
      </div>
      <Card className="p-5">
        <dl className="grid items-start gap-x-5 gap-y-3 sm:grid-cols-5">
          <div className="sm:col-span-3">
            <dt className="text-sm text-muted-foreground">Job</dt>
            <dd>
              {r.job_orders ? (
                <>
                  <Link to="/jobs/$id" params={{ id: r.job_order_id }} className="underline">
                    {r.job_orders.job_number} · {r.job_orders.project_name}
                  </Link>
                </>
              ) : (
                "Source: Inventory replenishment"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Order status</dt>
            <dd>{r.status === "requested" ? "Not ordered" : r.status === "ordered" ? "Awaiting receipt" : r.status}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Order reference</dt>
            <dd>{r.supplier_reference || "Not recorded"}</dd>
          </div>
          <div className="sm:col-span-5 sm:row-start-2">
            <dt className="text-sm text-muted-foreground">Supplier</dt>
            <dd className="grid gap-2">
              <select
                aria-label="Supplier"
                value={r.supplier_id || ""}
                disabled={!canOperate || r.status !== "requested"}
                onChange={(event) => {
                  const id = event.target.value;
                  if (id) saveSupplier.mutate(id);
                }}
                className="h-10 rounded-md border bg-background px-2"
              >
                <option value="">Select supplier</option>
                {(suppliers.data as any[] | undefined)?.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
              {!r.supplier_id && r.status === "requested" ? <div className="flex gap-2">
                <input
                  aria-label="New supplier name"
                  value={newSupplier}
                  onChange={(event) => setNewSupplier(event.target.value)}
                  placeholder="Add supplier"
                  disabled={!canOperate}
                  className="h-10 min-w-0 flex-1 rounded-md border bg-background px-2"
                />
                <Button
                  variant="outline"
                  onClick={() => saveSupplier.mutate()}
                  disabled={saveSupplier.isPending}
                >
                  Add
                </Button>
              </div> : null}
              {!r.supplier_id && r.supplier_name ? (
                <span className="text-xs text-muted-foreground">
                  Legacy supplier: {r.supplier_name}
                </span>
              ) : null}
            </dd>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:col-start-4 sm:col-span-2 sm:row-start-1">
            <div><dt className="text-sm text-muted-foreground">Requested</dt><dd>{r.requested_quantity} {r.materials?.unit}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Received</dt><dd>{r.received_quantity ?? 0} {r.materials?.unit}</dd></div>
          </div>
        </dl>
        {remaining > 0 && canOperate && r.status !== "requested" && r.status !== "cancelled" ? (
          <div className="hidden mt-4 w-full flex-wrap items-end justify-end gap-3 border-t pt-3">
            <label className="grid gap-1 text-sm">
              <span>Remaining quantity to receive</span>
              <input
                aria-label="Quantity received"
                type="number"
                min="0.001"
                step="0.001"
                max={rawRemaining}
                value={displayReceiptQuantity(receiveQuantity, remaining)}
                onWheel={(e) => e.currentTarget.blur()}
                onChange={(e) => setReceiveQuantity(e.target.value)}
                className="h-10 w-36 rounded-md border bg-background px-2"
              />
            </label>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={receive.isPending || !canRecordReceipt}>{receive.isPending ? "Recording…" : "Record receipt"}</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Record this stock receipt?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will add {displayReceiptQuantity(receiveQuantity, remaining) || "the entered quantity"} {r.materials?.unit} to Inventory for {r.materials?.name ?? "this material"} and reduce the linked Job Order shortage. The receipt cannot be edited after posting.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Review quantity</AlertDialogCancel>
                    <AlertDialogAction onClick={() => receive.mutate()}>Post receipt</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            {canCancel ? <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={cancelRemainder.isPending}>
                  Cancel remainder
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel the remaining purchase quantity?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Received stock stays recorded. This only closes the unreceived remainder.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep request open</AlertDialogCancel>
                  <AlertDialogAction onClick={() => cancelRemainder.mutate()}>
                    Cancel remainder
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog> : null}
          </div>
        ) : remaining > 0 && r.status !== "requested" && r.status !== "cancelled" ? (
          <p className="mt-6 text-sm text-muted-foreground">
            {remaining} {r.materials?.unit} remains. Staff, Owner, or Admin can record the receipt.
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{r.status === "requested" ? "Receipt tracking starts after the order is placed." : r.status === "received" ? "All ordered stock has been received. Inventory is up to date." : r.status === "cancelled" ? "This request was cancelled. No further action is required." : "Fully received."}</p>
        )}
      </Card>
      <Card className="p-5">
        <div className="mb-5 rounded-lg border bg-muted/20 p-4"><div className="flex items-center justify-between text-sm"><span className="font-medium">Receipt progress</span><span className="text-muted-foreground">{receiptProgress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${receiptProgress}%` }} /></div><p className="mt-2 text-sm text-muted-foreground">{r.received_quantity ?? 0} received of {r.requested_quantity} {r.materials?.unit} · {remaining} remaining</p></div>
        <h2 className="text-lg font-semibold">Receipt history</h2>
        {receipts.isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading receipts…</p>
        ) : receipts.isError ? (
          <p className="mt-3 text-sm text-destructive">Unable to load receipt history.</p>
        ) : receipts.data.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No materials received yet.</p>
        ) : (
          <ul className="mt-3 divide-y">
            {receipts.data.map((receipt: any) => (
              <li key={receipt.id} className="flex justify-between py-2 text-sm">
                <span>
                  {receipt.quantity} {r.materials?.unit}
                </span>
                <time className="text-muted-foreground">
                  {new Date(receipt.received_at).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
