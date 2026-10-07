import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { canApproveOperationalException, canOperateInventory } from "@/lib/roles";
export const Route = createFileRoute("/_app/inventory/$materialId")({
  component: InventoryDocument,
});
function InventoryDocument() {
  const { materialId } = Route.useParams();
  const { role } = useAuth();
  const canOperate = canOperateInventory(role);
  const canCorrect = canApproveOperationalException(role);
  const queryClient = useQueryClient();
  const [receiptQuantity, setReceiptQuantity] = useState("");
  const [correctionQuantity, setCorrectionQuantity] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const q = useQuery({
    queryKey: ["inventory-document", materialId],
    queryFn: async () => {
      const [
        { data: material, error: mError },
        { data: movements, error: mvError },
        { data: purchases, error: pError },
      ] = await Promise.all([
        (supabase.from("materials" as never) as any)
          .select("id,name,unit,category,pack_size")
          .eq("id", materialId)
          .single(),
        (supabase.from("inventory_movements" as never) as any)
          .select("id,movement_type,quantity,created_at,job_order_id")
          .eq("material_id", materialId)
          .order("created_at", { ascending: false })
          .limit(20),
        (supabase.from("purchase_requests" as never) as any)
          .select("id,requested_quantity,received_quantity,status,job_order_id,job_orders(job_number,project_name)")
          .eq("material_id", materialId)
          .neq("status", "cancelled"),
      ]);
      if (mError) throw mError;
      if (mvError) throw mvError;
      if (pError) throw pError;
      const [{ data: balance }, { data: activity, error: activityError }] = await Promise.all([
        (supabase.rpc as any)("inventory_balance", { p_material_id: materialId }),
        (supabase.rpc as any)("inventory_material_activity_summary", { p_material_id: materialId }),
      ]);
      if (activityError) throw activityError;
      const totals = activity?.[0] ?? { consumed: 0, returned: 0, wasted: 0 };
      return {
        material,
        movements: movements ?? [],
        balance: balance?.[0],
        consumed: totals.consumed ?? 0,
        returned: totals.returned ?? 0,
        waste: totals.wasted ?? 0,
        openPurchase: (purchases ?? []).reduce(
          (n: any, x: any) =>
            n + Math.max(0, Number(x.requested_quantity) - Number(x.received_quantity)),
          0,
        ),
        purchases: purchases ?? [],
      };
    },
  });
  const receiveStock = useMutation({
    mutationFn: async () => {
      if (!canOperate) throw new Error("Your role cannot receive inventory.");
      const quantity = Number(receiptQuantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Enter a positive quantity");
      }
      const { error } = await (supabase.rpc as any)("record_inventory_movement", {
        p_material_id: materialId,
        p_job_order_id: null,
        p_movement_type: "receipt",
        p_quantity: quantity,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setReceiptQuantity("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory-document", materialId] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-materials"] }),
      ]);
      toast.success("Stock received");
    },
    onError: (error: Error) => toast.error(error.message || "Unable to receive stock"),
  });
  const correctStock = useMutation({
    mutationFn: async () => {
      if (!canCorrect) throw new Error("Only an owner or admin can correct inventory.");
      const quantity = Number(correctionQuantity);
      if (!Number.isFinite(quantity) || quantity === 0) {
        throw new Error("Enter a positive or negative quantity");
      }
      if (!correctionReason.trim()) throw new Error("A correction reason is required");
      const { error } = await (supabase.rpc as any)("record_inventory_correction", {
        p_material_id: materialId,
        p_quantity_delta: quantity,
        p_reason: correctionReason.trim(),
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setCorrectionQuantity("");
      setCorrectionReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory-document", materialId] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-materials"] }),
      ]);
      toast.success("Stock correction recorded");
    },
    onError: (error: Error) => toast.error(error.message || "Unable to correct stock"),
  });
  if (q.isLoading) return <p>Loading inventory document…</p>;
  if (q.isError) return <div className="flex flex-wrap items-center gap-3"><p className="text-destructive">Unable to load this material and its movement history.</p><Button variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button></div>;
  const m = q.data.material as any,
    b = q.data.balance ?? {};
  const cards = [
    ["On hand", b.on_hand ?? 0],
    ["Reserved", b.reserved ?? 0],
    ["Available", b.available ?? 0],
    ["Consumed", q.data.consumed],
    ["Returned", q.data.returned],
    ["Waste", q.data.waste],
    ["Open purchase", q.data.openPurchase],
  ];
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <p className="text-sm text-muted-foreground">Inventory document</p>
        <h1 className="text-3xl font-semibold">{m.name}</h1>
        <p className="text-muted-foreground">
          {m.category} · {m.unit}
        </p>
        <span className="rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium">Pack size: {m.pack_size ?? "—"}</span>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <Card key={label} className="p-4 shadow-sm transition-shadow hover:shadow-md">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold">{value}</p>
          </Card>
        ))}
      </div>
      {canOperate && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="font-semibold">Receive stock</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Use this for opening stock or deliveries not linked to a shortage request. This adds
              stock to the ledger. Linked purchases are received from Purchasing.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-sm">
                <span>Quantity received</span>
                <input
                  aria-label="Quantity received"
                  className="h-10 w-40 rounded-md border bg-background px-2"
                  min="0.001"
                  onChange={(event) => setReceiptQuantity(event.target.value)}
                  step="0.001"
                  type="number"
                  value={receiptQuantity}
                />
              </label>
              <Button disabled={receiveStock.isPending} onClick={() => receiveStock.mutate()}>
                {receiveStock.isPending ? "Receiving…" : "Receive stock"}
              </Button>
            </div>
          </Card>
          {canCorrect ? <Card className="p-5">
            <h2 className="font-semibold">Correct stock</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Use a positive number to add stock or a negative number to remove it. Only an owner
              or admin can correct stock, and the reason is always recorded.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[9rem_1fr_auto] sm:items-end">
              <label className="grid gap-1 text-sm">
                <span>Adjustment</span>
                <input
                  aria-label="Stock adjustment"
                  className="h-10 rounded-md border bg-background px-2"
                  onChange={(event) => setCorrectionQuantity(event.target.value)}
                  step="0.001"
                  type="number"
                  value={correctionQuantity}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span>Reason</span>
                <input
                  aria-label="Correction reason"
                  className="h-10 rounded-md border bg-background px-2"
                  onChange={(event) => setCorrectionReason(event.target.value)}
                  value={correctionReason}
                />
              </label>
              <Button disabled={correctStock.isPending} onClick={() => correctStock.mutate()}>
                {correctStock.isPending ? "Recording…" : "Record correction"}
              </Button>
            </div>
          </Card> : null}
        </div>
      )}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Open purchase requests</h2><p className="text-sm text-muted-foreground">Requests linked to this material.</p></div><Link className="text-sm underline" to="/purchasing">Open Purchasing</Link></div>
        <div className="mt-4 divide-y">{q.data.purchases.length ? q.data.purchases.map((x: any) => <div key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><span>{x.job_orders?.job_number ?? "Replenishment"} · {Math.max(0, Number(x.requested_quantity) - Number(x.received_quantity ?? 0))} remaining</span><Button asChild size="sm" variant="outline"><Link to="/purchasing/$requestId" params={{ requestId: x.id }}>Open request</Link></Button></div>) : <p className="mt-2 text-sm text-muted-foreground">No open purchase requests.</p>}</div>
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold">Recent movements</h2>
        <div className="mt-4 divide-y">
          {q.data.movements.length ? (
            q.data.movements.map((x: any) => (
              <div key={x.id} className="flex justify-between py-3">
                <span>{x.movement_type}</span>
                <span>
                  {x.quantity} {m.unit}{" "}
                  {x.job_order_id ? (
                    <Link to="/jobs/$id" params={{ id: x.job_order_id }} className="ml-2 underline">
                      Open job
                    </Link>
                  ) : null}
                </span>
              </div>
            ))
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No movements yet.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
