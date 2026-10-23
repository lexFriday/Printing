import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ItemTemplatesPage } from "@/components/ItemTemplatesView";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronDown, Package } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { canManageOperationalSettings, canOperatePurchasing } from "@/lib/roles";
import { MaterialImportDialog } from "@/components/MaterialImportDialog";
import { materialNameSchema } from "@/lib/materialName";

export const Route = createFileRoute("/_app/inventory")({ component: InventoryPage });

function InventoryPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [view, setView] = useState<"inventory" | "templates">("inventory");
  const [statusFilter, setStatusFilter] = useState<"all" | "reorder" | "ok">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const { role } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canEditMaterials = canManageOperationalSettings(role);
  const [newMaterial, setNewMaterial] = useState<{name:string; unit:string; category:string; reorder:string; pack:string} | null>(null);
  const [editMaterial, setEditMaterial] = useState<{id:string; name:string; originalName:string} | null>(null);
  const createMaterial = useMutation({ mutationFn: async (form: NonNullable<typeof newMaterial>) => { if (!form.name.trim() || !form.unit.trim()) throw new Error("Material name and unit are required."); const { error } = await (supabase.from("materials") as any).insert({ name: form.name.trim(), unit: form.unit.trim(), category: form.category.trim() || "Other", reorder_threshold: Number(form.reorder) || 0, pack_size: Number(form.pack) || 1, is_active: true }); if (error) throw error; }, onSuccess: async () => { setNewMaterial(null); await qc.invalidateQueries({queryKey:["inventory-materials"]}); await qc.invalidateQueries({queryKey:["active-materials-for-item-template"]}); toast.success("Material added to inventory"); }, onError: (e: Error) => toast.error(e.message || "Unable to add material") });
  const renameMaterial = useMutation({ mutationFn: async (material: NonNullable<typeof editMaterial>) => { if (!canEditMaterials) throw new Error("Only an owner or admin can edit materials."); const parsed = materialNameSchema.safeParse(material.name); if (!parsed.success) throw new Error("Material name is required."); if (parsed.data === material.originalName) return false; const { error } = await (supabase.from("materials") as any).update({ name: parsed.data }).eq("id", material.id).select("id").single(); if (error?.code === "23505") throw new Error("A material with this name already exists."); if (error) throw new Error(error.message || "Unable to update material name"); return true; }, onSuccess: async (changed, material) => { setEditMaterial(null); if (!changed) return; await Promise.all([qc.invalidateQueries({queryKey:["inventory-materials"]}), qc.invalidateQueries({queryKey:["inventory-document", material.id]}), qc.invalidateQueries({queryKey:["active-materials-for-item-template"]})]); toast.success("Material name updated"); } });
  const materials = useQuery({
    queryKey: ["inventory-materials"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("inventory_material_summary");
      if (error) throw error;
      return data ?? [];
    },
  });
  const materialRows = materials.data ?? [];

  const viewToggle = (
    <div className="inline-flex w-fit rounded-lg border bg-muted/30 p-1" role="tablist" aria-label="Inventory workspace views">
      <button type="button" role="tab" aria-selected={view === "inventory"} onClick={() => setView("inventory")} className={`min-h-10 rounded-md px-4 py-2 text-sm font-medium transition-colors ${view === "inventory" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}>Inventory</button>
      <button type="button" role="tab" aria-selected={view === "templates"} onClick={() => setView("templates")} className={`min-h-10 rounded-md px-4 py-2 text-sm font-medium transition-colors ${view === "templates" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}>Item Templates</button>
    </div>
  );

  if (pathname.startsWith("/inventory/")) return <Outlet />;

  return (
    <div className="space-y-5">
      {view === "inventory" && <header className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-3xl font-semibold">Inventory</h1><p className="mt-1 text-muted-foreground">Materials and stock records for production.</p></div><div className="flex flex-wrap gap-2"><MaterialImportDialog onImported={async () => { await Promise.all([qc.invalidateQueries({queryKey:["inventory-materials"]}), qc.invalidateQueries({queryKey:["active-materials-for-item-template"]})]); }} /><Button onClick={() => setNewMaterial({name:"",unit:"",category:"",reorder:"",pack:"1"})}>Add material</Button></div>
      </header>}
      {view === "inventory" ? viewToggle : null}
      {view === "templates" ? <ItemTemplatesPage navigation={viewToggle} /> : null}
      {view === "inventory" ? <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="relative"><select aria-label="Filter by category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-10 appearance-none rounded-md border bg-background py-2 pl-3 pr-9 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"><option value="all">All categories</option><option value="substrate">Substrate</option><option value="ink">Ink</option><option value="hardware">Hardware</option><option value="finishing">Finishing</option><option value="other">Other</option></select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /></div><div className="flex items-center gap-3"><div className="relative"><select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="h-10 appearance-none rounded-md border bg-background py-2 pl-3 pr-9 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"><option value="all">All statuses</option><option value="reorder">Reorder needed</option><option value="ok">In stock</option></select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /></div><span className="text-sm text-muted-foreground">{materialRows.length} rows</span></div></div>
        {materials.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading materials…</p>
        ) : materials.isError ? (
          <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-destructive">Unable to load inventory materials.</p><Button variant="outline" size="sm" onClick={() => materials.refetch()}>Retry</Button></div>
        ) : materialRows.length === 0 ? (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Package className="h-5 w-5" />
            No materials have been added yet.
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background"><TableRow><TableHead>Material</TableHead><TableHead>Unit</TableHead><TableHead>On hand</TableHead><TableHead>Reserved</TableHead><TableHead>Available</TableHead><TableHead>Open purchase</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>
            {materialRows.filter((m: any) => { const needed = Number(m.available) < Number(m.reorder_threshold ?? 0) && Number(m.reorder_threshold ?? 0) > 0; const categoryMatches = categoryFilter === "all" || String(m.category ?? "other").toLowerCase() === categoryFilter; return categoryMatches && (statusFilter === "all" || (statusFilter === "reorder" ? needed : !needed)); }).map((m: any) => {
              const reorderNeeded =
                Number(m.available) < Number(m.reorder_threshold ?? 0) &&
                Number(m.reorder_threshold ?? 0) > 0;
              const reorderGap = Math.max(0, Number(m.reorder_threshold ?? 0) - Number(m.available ?? 0));
              const packSize = Math.max(1, Number(m.pack_size ?? 1));
              const suggestedPurchaseQuantity = Math.ceil(reorderGap / packSize) * packSize;
              return (
                <TableRow key={m.material_id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link
                        to="/inventory/$materialId"
                        params={{ materialId: m.material_id }}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {m.material_name}
                      </Link>
                      {reorderNeeded ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                          Reorder needed
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{m.category} · reorder at {m.reorder_threshold}</p>
                    <div className="flex items-center gap-3"><Link to="/inventory/$materialId" params={{ materialId: m.material_id }} className="text-xs text-primary underline-offset-4 hover:underline">Open material</Link>{canEditMaterials ? <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => { renameMaterial.reset(); setEditMaterial({id:m.material_id,name:m.material_name,originalName:m.material_name}); }}>Edit name</Button> : null}</div>
                  </TableCell><TableCell>{m.unit}</TableCell><TableCell>{m.on_hand}</TableCell><TableCell>{m.reserved}</TableCell><TableCell className="font-medium">{m.available}</TableCell><TableCell>{m.open_purchase_quantity}</TableCell><TableCell>{reorderNeeded ? <span className="text-xs text-amber-800">Reorder needed</span> : <span className="text-xs text-emerald-700">Healthy</span>}</TableCell><TableCell className="text-right">{reorderNeeded ? Number(m.open_purchase_quantity ?? 0) > 0 ? <Button size="sm" variant="outline" onClick={() => m.open_purchase_request_id ? navigate({ to: "/purchasing/$requestId", params: { requestId: m.open_purchase_request_id } }) : navigate({ to: "/purchasing" })}>Open purchase request</Button> : suggestedPurchaseQuantity > 0 ? <Button size="sm" variant="outline" disabled={!canOperatePurchasing(role)} onClick={async () => { const { error } = await (supabase.rpc as any)("create_replenishment_request", { p_material_id: m.material_id, p_quantity: suggestedPurchaseQuantity }); if (error) toast.error(error.message || "Unable to create purchase request"); else { toast.success("Purchase request created"); await materials.refetch(); navigate({ to: "/purchasing" }); } }}>Create purchase request</Button> : <span className="text-xs text-muted-foreground" title="Available stock is at the reorder threshold">No purchase needed</span> : null}</TableCell>
                </TableRow>
              );
            })}
          </TableBody></Table>
          </div>
        )}
      </Card> : null}
      {newMaterial ? <Dialog open onOpenChange={(open) => !open && setNewMaterial(null)}><DialogContent><DialogHeader><DialogTitle>Add material</DialogTitle></DialogHeader><div className="grid gap-3"><label className="grid gap-1 text-sm font-medium">Material name<Input placeholder="e.g. Glossy Vinyl" value={newMaterial.name} onChange={(e) => setNewMaterial({...newMaterial,name:e.target.value})} /></label><div className="grid grid-cols-2 gap-3"><label className="grid gap-1 text-sm font-medium">Unit<select aria-label="Unit" value={newMaterial.unit} onChange={(e) => setNewMaterial({...newMaterial,unit:e.target.value})} className="h-10 rounded-md border bg-background px-3 font-normal"><option value="">Select unit</option><option value="sqm">Square metre (sqm)</option><option value="ml">Millilitre (ml)</option><option value="pcs">Pieces (pcs)</option><option value="sheet">Sheets</option><option value="roll">Rolls</option><option value="kg">Kilograms (kg)</option></select></label><label className="grid gap-1 text-sm font-medium">Category<select aria-label="Category" value={newMaterial.category} onChange={(e) => setNewMaterial({...newMaterial,category:e.target.value})} className="h-10 rounded-md border bg-background px-3 font-normal"><option value="">Select category</option><option value="substrate">Substrate</option><option value="ink">Ink</option><option value="hardware">Hardware</option><option value="finishing">Finishing</option><option value="other">Other</option></select></label></div><div className="grid grid-cols-2 gap-3"><label className="grid gap-1 text-sm font-medium">Reorder threshold<Input type="number" min="0" placeholder="0" value={newMaterial.reorder} onChange={(e) => setNewMaterial({...newMaterial,reorder:e.target.value})} /></label><label title="How many units arrive together. Used for reorder quantities." className="grid gap-1 text-sm font-medium">Units per pack<Input type="number" min="1" placeholder="1" value={newMaterial.pack} onChange={(e) => setNewMaterial({...newMaterial,pack:e.target.value})} /></label></div></div><DialogFooter><Button variant="outline" onClick={() => setNewMaterial(null)}>Cancel</Button><Button onClick={() => createMaterial.mutate(newMaterial)} disabled={createMaterial.isPending}>{createMaterial.isPending ? "Adding…" : "Add material"}</Button></DialogFooter></DialogContent></Dialog> : null}
      {editMaterial ? <Dialog open onOpenChange={(open) => !open && setEditMaterial(null)}><DialogContent><DialogHeader><DialogTitle>Edit material name</DialogTitle></DialogHeader><form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); renameMaterial.mutate(editMaterial); }}><label className="grid gap-1 text-sm font-medium">Material name<Input autoFocus value={editMaterial.name} onChange={(e) => { renameMaterial.reset(); setEditMaterial({...editMaterial,name:e.target.value}); }} aria-invalid={renameMaterial.isError} />{renameMaterial.isError ? <span role="alert" className="text-sm font-normal text-destructive">{renameMaterial.error.message}</span> : null}</label><DialogFooter><Button type="button" variant="outline" onClick={() => setEditMaterial(null)} disabled={renameMaterial.isPending}>Cancel</Button><Button type="submit" disabled={renameMaterial.isPending}>{renameMaterial.isPending ? "Saving…" : "Save name"}</Button></DialogFooter></form></DialogContent></Dialog> : null}
    </div>
  );
}
