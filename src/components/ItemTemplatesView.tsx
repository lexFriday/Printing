import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit2, PackagePlus, ShieldCheck, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, LoadingRow, PageHeader } from "@/components/system";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { logAudit } from "@/lib/audit";
import { fmtDate, peso } from "@/lib/format";
import { formatMoneyInput, normalizeMoneyInput } from "@/lib/moneyInput";
import { canManageOperationalSettings } from "@/lib/roles";
import { toast } from "sonner";


type PricingMode = "sqft" | "fixed";
type Unit = "inches" | "feet" | "millimeters" | "centimeters" | "meters";
type TemplateRow = {
  id: string;
  name: string;
  description: string;
  pricing_mode: PricingMode;
  default_unit: Unit | null;
  default_rate_per_sqft: number | null;
  default_unit_price: number | null;
  default_width: number | null;
  default_height: number | null;
  is_active: boolean;
  updated_at: string;
  pricing_basis?: string;
  sheets_per_copy?: number | null;
  sheet_waste_percent?: number;
};
type Material = { id: string; name: string; unit: string };
type MaterialDraft = { materialId: string; quantity: string; basis: "per_item" | "per_sqft" | "fixed_per_line" };
type MaterialsForm = {
  template: TemplateRow;
  rows: MaterialDraft[];
  initialRows: MaterialDraft[];
  idempotencyKey: string;
};
type TemplateForm = {
  id?: string;
  name: string;
  description: string;
  pricing_mode: PricingMode;
  default_unit: Unit;
  default_rate_per_sqft: string;
  default_unit_price: string;
  default_width: string;
  default_height: string;
  is_active: boolean;
  pricing_basis: "manual" | "per_sheet";
  sheet_pricing_profile_id: string;
  sheets_per_copy: string;
  sheet_waste_percent: string;
};

const blankForm: TemplateForm = {
  name: "",
  description: "",
  pricing_mode: "sqft",
  default_unit: "feet",
  default_rate_per_sqft: "",
  default_unit_price: "",
  default_width: "",
  default_height: "",
  is_active: true,
  pricing_basis: "manual",
  sheets_per_copy: "",
  sheet_waste_percent: "0",
  sheet_pricing_profile_id: "",
};

export function ItemTemplatesPage({ navigation }: { navigation?: ReactNode } = {}) {
  const { role } = useAuth();
  const qc = useQueryClient();
  const canAdmin = canManageOperationalSettings(role);
  const sheetProfile = useQuery({
    queryKey: ["sheet-pricing-profile-settings"],
    enabled: canAdmin,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("sheet_pricing_profiles")
        .select("id,name,description,sheet_pricing_tiers(id,min_sheets,max_sheets,price_per_sheet)")
        .eq("active", true).order("effective_from", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [pricingFilter, setPricingFilter] = useState<"all" | PricingMode>("all");
  const [form, setForm] = useState<TemplateForm | null>(null);
  const [materialsForm, setMaterialsForm] = useState<MaterialsForm | null>(null);

  const templates = useQuery({
    queryKey: ["item-templates", search, statusFilter, pricingFilter],
    retry: false,
    queryFn: async () => {
      let query = supabase
        .from("item_templates")
        .select(
          "id, name, description, pricing_mode, default_unit, default_rate_per_sqft, default_unit_price, default_width, default_height, is_active, updated_at",
        )
        .order("is_active", { ascending: false })
        .order("name", { ascending: true });
      if (search.trim()) {
        query = query.or(`name.ilike.%${search.trim()}%,description.ilike.%${search.trim()}%`);
      }
      if (statusFilter !== "all") query = query.eq("is_active", statusFilter === "active");
      if (pricingFilter !== "all") query = query.eq("pricing_mode", pricingFilter);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as TemplateRow[];
    },
  });

  const saveTemplate = useMutation({
    mutationFn: async (draft: TemplateForm) => {
      if (!canAdmin) throw new Error("Only the owner can manage item templates.");
      const payload = toPayload(draft);
      if (draft.id) {
        const current = templates.data?.find((template) => template.id === draft.id);
        const { error } = await supabase.from("item_templates").update(payload).eq("id", draft.id);
        if (error) throw error;
        await logAudit("item_template.updated", "item_template", draft.id, payload, current);
        return;
      }
      const { data, error } = await supabase
        .from("item_templates")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      await logAudit("item_template.created", "item_template", data.id, payload);
    },
    onSuccess: () => {
      toast.success("Item template saved");
      setForm(null);
      qc.invalidateQueries({ queryKey: ["item-templates"] });
      qc.invalidateQueries({ queryKey: ["active-item-templates"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const materials = useQuery({
    queryKey: ["active-materials-for-item-template"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("materials") as any).select("id,name,unit").eq("is_active", true).order("name");
      if (error) throw error;
      return (data ?? []) as Material[];
    },
  });
  const saveMaterials = useMutation({
    mutationFn: async (value: MaterialsForm) => {
      if (!canAdmin) throw new Error("Only an owner or admin can manage template materials.");
      const rows = value.rows.map((row) => ({ material_id: row.materialId, quantity: Number(row.quantity), basis: row.basis }));
      if (rows.some((row) => !row.material_id || !Number.isFinite(row.quantity) || row.quantity <= 0)) throw new Error("Choose a material and enter a positive quantity for every row.");
      if (new Set(rows.map((row) => `${row.material_id}:${row.basis}`)).size !== rows.length) throw new Error("A material can appear only once per basis.");
      const { error } = await (supabase.rpc as any)("save_item_template_material_version", { p_item_template_id: value.template.id, p_components: rows, p_idempotency_key: value.idempotencyKey });
      if (error) throw error;
      await logAudit("item_template_materials.updated", "item_template", value.template.id, rows);
    },
    onSuccess: () => { setMaterialsForm(null); toast.success("Template materials saved"); qc.invalidateQueries({ queryKey: ["item-template-materials"] }); },
    onError: (error: Error) => toast.error(error.message),
  });

  const activeCount = useMemo(
    () => (templates.data ?? []).filter((template) => template.is_active).length,
    [templates.data],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Item Templates"
        description="Pricing defaults and standard materials used for future quotations."
        actions={
          canAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setForm({ ...blankForm })}>
                <PackagePlus className="h-4 w-4" /> New template
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-success" />
              View only
            </div>
          )
        }
      />

      {navigation}

      <Card className="border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-950">
        <strong>How this works:</strong> Sales selects an active template while preparing a quote. When the quote is approved, its material estimate is frozen into the Job Order. Later recipe edits affect new quotes only.
      </Card>
      <Card className="p-4">
        {templates.isError ? (
          <Alert className="mb-4">
            <AlertTitle>Item templates are not set up yet.</AlertTitle>
            <AlertDescription>
              Run the item templates SQL migration, then refresh this page.
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Input
            className="max-w-sm"
            placeholder="Search templates..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
              <SelectTrigger className="w-32" aria-label="Filter by status"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All status</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
            </Select>
            <Select value={pricingFilter} onValueChange={(value) => setPricingFilter(value as typeof pricingFilter)}>
              <SelectTrigger className="w-36" aria-label="Filter by pricing"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All pricing</SelectItem><SelectItem value="sqft">Square foot</SelectItem><SelectItem value="fixed">Fixed unit</SelectItem></SelectContent>
            </Select>
            <div className="text-sm text-muted-foreground">{activeCount} active templates</div>
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto rounded-md border" tabIndex={0} aria-label="Item templates list">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Pricing</TableHead>
              <TableHead>Defaults</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Updated</TableHead>
              {canAdmin ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.isLoading ? (
              <LoadingRow colSpan={canAdmin ? 6 : 5} />
            ) : (templates.data ?? []).length === 0 ? (
              <EmptyState colSpan={canAdmin ? 6 : 5} icon={PackagePlus}>
                No item templates found
              </EmptyState>
            ) : (
              templates.data!.map((template) => (
                <TableRow key={template.id}>
                  <TableCell>
                    <div className="font-medium">{template.name}</div>
                    <div className="text-sm text-muted-foreground">{template.description}</div>
                  </TableCell>
                  <TableCell>
                    {template.pricing_basis === "per_sheet"
                      ? "Printed sheets"
                      : template.pricing_mode === "sqft" ? "Square foot" : "Fixed unit"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {template.pricing_mode === "sqft"
                      ? `${template.default_unit ?? "-"} · ${
                          template.default_rate_per_sqft ?? "-"
                        }/sq ft${formatSize(template)}`
                      : `${peso(template.default_unit_price ?? 0)} each${formatSize(template)}`}
                  </TableCell>
                  <TableCell>
                    <Badge variant={template.is_active ? "default" : "secondary"}>
                      {template.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {fmtDate(template.updated_at)}
                  </TableCell>
                  {canAdmin ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setForm(toForm(template))}><Edit2 className="h-4 w-4" /> Edit</Button>
                        <Button variant="outline" size="sm" onClick={async () => {
                          const { data, error } = await (supabase.from("item_template_materials") as any).select("material_id,quantity,basis,version").eq("item_template_id", template.id).eq("active", true);
                          if (error) { toast.error(error.message); return; }
                          if (new Set((data ?? []).map((row: any) => row.version)).size > 1) { toast.error("This template has conflicting active recipe versions. Ask an administrator to repair it before editing."); return; }
                          const rows = (data ?? []).map((row: any) => ({ materialId: row.material_id, quantity: String(row.quantity), basis: row.basis }));
                          const currentRows = rows.length ? rows : [{ materialId: "", quantity: "", basis: "per_item" as const }];
                          setMaterialsForm({ template, rows: currentRows, initialRows: currentRows, idempotencyKey: crypto.randomUUID() });
                        }}><Wrench className="h-4 w-4" /> Materials / BOM</Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      </Card>

      <TemplateDialog
        form={form}
        sheetProfile={sheetProfile.data}
        busy={saveTemplate.isPending}
        onChange={setForm}
        onClose={() => setForm(null)}
        onSave={() => form && saveTemplate.mutate(form)}
      />
      <MaterialsDialog form={materialsForm} materials={materials.data ?? []} busy={saveMaterials.isPending} onClose={() => setMaterialsForm(null)} onChange={setMaterialsForm} onSave={() => materialsForm && saveMaterials.mutate(materialsForm)} />
    </div>
  );
}

function MaterialsDialog({ form, materials, busy, onClose, onChange, onSave }: { form: MaterialsForm | null; materials: Material[]; busy: boolean; onClose: () => void; onChange: (value: MaterialsForm) => void; onSave: () => void }) {
  const [attempted, setAttempted] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  if (!form) return null;
  const changeRows = (rows: MaterialDraft[]) => onChange({ ...form, rows, idempotencyKey: crypto.randomUUID() });
  const update = (index: number, patch: Partial<MaterialDraft>) => changeRows(form.rows.map((row, current) => current === index ? { ...row, ...patch } : row));
  const errors = materialRowErrors(form.rows);
  const requestClose = () => {
    if (JSON.stringify(form.rows) !== JSON.stringify(form.initialRows) && !window.confirm("Discard unsaved recipe changes?")) return;
    setAttempted(false);
    onClose();
  };
  const submit = () => {
    setAttempted(true);
    if (errors.some(Boolean)) {
      requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    onSave();
  };
  return (
    <Dialog open onOpenChange={(open) => (!open ? requestClose() : undefined)}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-4xl">
        <form className="contents" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <DialogHeader className="shrink-0">
          <DialogTitle>Materials / BOM · {form.template.name}</DialogTitle>
          <DialogDescription>
            Reusable recipe used to estimate materials for future quotes. Existing Job Order plans remain unchanged.
          </DialogDescription>
        </DialogHeader>
        <p id="basis-guidance" className="text-xs text-muted-foreground">
          Basis controls scaling: Per item × finished quantity; Per sq ft × area and quantity; Per line once.
        </p>
        <div className="hidden grid-cols-[minmax(0,1fr)_8rem_9rem_5.5rem] gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid" aria-hidden="true">
          <div>Material</div><div>Quantity</div><div>Basis</div><div />
        </div>
        <div ref={bodyRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-2" tabIndex={0} aria-label="Template materials">
          {form.rows.map((row, index) => (
            <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_8rem_9rem_5.5rem] sm:items-center sm:border-0 sm:p-0">
              <Label className="text-xs sm:hidden">Material</Label>
              <Select value={row.materialId} onValueChange={(value) => update(index, { materialId: value })}>
                <SelectTrigger className="min-h-11" aria-label={`Material ${index + 1}`} aria-invalid={attempted && Boolean(errors[index])}><SelectValue placeholder="Choose material" /></SelectTrigger>
                <SelectContent>{materials.map((material) => <SelectItem key={material.id} value={material.id}>{material.name} · {material.unit}</SelectItem>)}</SelectContent>
              </Select>
              <Label className="text-xs sm:hidden">Quantity</Label>
              <Input className="min-h-11" type="number" min="0.0001" step="0.0001" aria-label={`Quantity for material ${index + 1}`} aria-invalid={attempted && Boolean(errors[index])} value={row.quantity} onChange={(event) => update(index, { quantity: event.target.value })} />
              <Label className="text-xs sm:hidden">Basis</Label>
              <Select value={row.basis} onValueChange={(value) => update(index, { basis: value as MaterialDraft["basis"] })}>
                <SelectTrigger className="min-h-11" aria-label={`Basis for material ${index + 1}`} aria-describedby="basis-guidance"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="per_item">Per item</SelectItem><SelectItem value="per_sqft">Per sq ft</SelectItem><SelectItem value="fixed_per_line">Per line</SelectItem></SelectContent>
              </Select>
              <Button type="button" variant="ghost" className="min-h-11" onClick={() => changeRows(form.rows.filter((_, current) => current !== index))} disabled={form.rows.length === 1}>Remove</Button>
              {attempted && errors[index] ? <p className="text-sm text-destructive sm:col-span-4" role="alert">Row {index + 1}: {errors[index]}</p> : null}
            </div>
          ))}
        </div>
        <Button type="button" className="min-h-11 shrink-0 self-start" variant="outline" onClick={() => changeRows([...form.rows, { materialId: "", quantity: "", basis: "per_item" }])}>Add material line</Button>
        <DialogFooter className="shrink-0 border-t pt-4">
          <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save materials"}</Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function materialRowErrors(rows: MaterialDraft[]) {
  const counts = new Map<string, number>();
  rows.forEach((row) => counts.set(`${row.materialId}:${row.basis}`, (counts.get(`${row.materialId}:${row.basis}`) ?? 0) + 1));
  return rows.map((row) => {
    if (!row.materialId) return "Choose a material.";
    if (!Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0) return "Enter a positive quantity.";
    if ((counts.get(`${row.materialId}:${row.basis}`) ?? 0) > 1) return "This material and basis are already listed.";
    return "";
  });
}

function TemplateDialog({
  form,
  sheetProfile,
  busy,
  onChange,
  onClose,
  onSave,
}: {
  form: TemplateForm | null;
  sheetProfile?: { id: string; name: string } | null;
  busy: boolean;
  onChange: (form: TemplateForm) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  if (!form) return null;
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit item template" : "New item template"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <Field label="Name">
            <Input
              value={form.name}
              onChange={(event) => onChange({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="Pricing">
            <Select
              value={form.pricing_basis === "per_sheet" ? "per_sheet" : form.pricing_mode}
              onValueChange={(value) => onChange({
                ...form,
                pricing_basis: value === "per_sheet" ? "per_sheet" : "manual",
                pricing_mode: value === "sqft" ? "sqft" : "fixed",
                sheet_pricing_profile_id: value === "per_sheet" ? (form.sheet_pricing_profile_id || "") : "",
              })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed unit</SelectItem>
                <SelectItem value="sqft">Square foot</SelectItem>
                <SelectItem value="per_sheet">By printed sheets</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Description">
            <Textarea
              rows={2}
              value={form.description}
              onChange={(event) => onChange({ ...form, description: event.target.value })}
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.is_active ? "active" : "inactive"}
              onValueChange={(value) => onChange({ ...form, is_active: value === "active" })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {form.pricing_mode === "sqft" ? (
            <>
              <Field label="Default unit">
                <Select
                  value={form.default_unit}
                  onValueChange={(value) => onChange({ ...form, default_unit: value as Unit })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="feet">Feet</SelectItem>
                    <SelectItem value="inches">Inches</SelectItem>
                    <SelectItem value="meters">Meters</SelectItem>
                    <SelectItem value="centimeters">Centimeters</SelectItem>
                    <SelectItem value="millimeters">Millimeters</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <NumberInput
                label="Default rate / sq ft"
                value={form.default_rate_per_sqft}
                onChange={(value) => onChange({ ...form, default_rate_per_sqft: value })}
                money
              />
            </>
          ) : (
            <NumberInput
              label="Default unit price"
              value={form.default_unit_price}
              onChange={(value) => onChange({ ...form, default_unit_price: value })}
              money
            />
          )}
          <NumberInput
            label="Default width"
            value={form.default_width}
            onChange={(value) => onChange({ ...form, default_width: value })}
          />
          <NumberInput
            label="Default height"
            value={form.default_height}
            onChange={(value) => onChange({ ...form, default_height: value })}
          />
          {form.pricing_basis === "per_sheet" ? (
            <>
              <Field label="Sheet pricing profile">
                <Select value={form.sheet_pricing_profile_id || (sheetProfile?.id ?? "")} onValueChange={(value) => onChange({ ...form, sheet_pricing_profile_id: value })}>
                  <SelectTrigger><SelectValue placeholder="Choose sheet pricing" /></SelectTrigger>
                  <SelectContent>
                    {sheetProfile ? <SelectItem value={sheetProfile.id}>{sheetProfile.name}</SelectItem> : null}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">The matching price tier is chosen automatically from the planned sheet count.</p>
              </Field>
              <NumberInput label="Sheets per finished copy" value={form.sheets_per_copy} onChange={(value) => onChange({ ...form, sheets_per_copy: value })} />
              <NumberInput label="Waste allowance (%)" value={form.sheet_waste_percent} onChange={(value) => onChange({ ...form, sheet_waste_percent: value })} />
              <p className="text-xs text-muted-foreground sm:col-span-2">Quotes will ask for finished copies and calculate printed sheets automatically.</p>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={busy}>
            {busy ? "Saving..." : "Save template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  money = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  money?: boolean;
}) {
  return (
    <Field label={label}>
      <Input
        type={money ? "text" : "number"}
        inputMode="decimal"
        step="0.01"
        value={money ? formatMoneyInput(value) : value}
        onChange={(event) => {
          const next = money ? normalizeMoneyInput(event.target.value) : event.target.value;
          if (next !== null) onChange(next);
        }}
      />
    </Field>
  );
}

function toForm(template: TemplateRow): TemplateForm {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    pricing_mode: template.pricing_mode,
    default_unit: template.default_unit ?? "feet",
    default_rate_per_sqft: template.default_rate_per_sqft?.toString() ?? "",
    default_unit_price: template.default_unit_price?.toString() ?? "",
    default_width: template.default_width?.toString() ?? "",
    default_height: template.default_height?.toString() ?? "",
    is_active: template.is_active,
    pricing_basis: template.pricing_basis === "per_sheet" ? "per_sheet" : "manual",
    sheets_per_copy: template.sheets_per_copy?.toString() ?? "",
    sheet_waste_percent: template.sheet_waste_percent?.toString() ?? "0",
    sheet_pricing_profile_id: "",
  };
}

function toPayload(form: TemplateForm): TablesInsert<"item_templates"> {
  const name = form.name.trim();
  const description = form.description.trim();
  if (!name) throw new Error("Template name is required.");
  if (!description) throw new Error("Template description is required.");

  const width = parseOptionalPositive(form.default_width, "Default width");
  const height = parseOptionalPositive(form.default_height, "Default height");
  const sheetsPerCopy = form.pricing_basis === "per_sheet" ? parseRequiredPositive(form.sheets_per_copy, "Sheets per finished copy") : null;
  const wastePercent = form.pricing_basis === "per_sheet" ? Number(form.sheet_waste_percent || 0) : 0;
  if (!Number.isFinite(wastePercent) || wastePercent < 0 || wastePercent > 100) throw new Error("Waste allowance must be between 0 and 100%.");
  if (form.pricing_mode === "sqft") {
    const rate = parseRequiredPositive(form.default_rate_per_sqft, "Default rate");
    return {
      name,
      description,
      pricing_mode: "sqft" as const,
      default_unit: form.default_unit,
      default_rate_per_sqft: rate,
      default_unit_price: null,
      default_width: width,
      default_height: height,
      is_active: form.is_active,
      pricing_basis: form.pricing_basis,
      sheets_per_copy: sheetsPerCopy,
      sheet_waste_percent: wastePercent,
      sheet_pricing_profile_id: form.pricing_basis === "per_sheet" ? (form.sheet_pricing_profile_id || null) : null,
    };
  }

  const unitPrice = parseRequiredPositive(form.default_unit_price, "Default unit price");
  return {
    name,
    description,
    pricing_mode: "fixed" as const,
    default_unit: null,
    default_rate_per_sqft: null,
    default_unit_price: unitPrice,
    default_width: width,
    default_height: height,
    is_active: form.is_active,
    pricing_basis: form.pricing_basis,
    sheets_per_copy: sheetsPerCopy,
    sheet_waste_percent: wastePercent,
    sheet_pricing_profile_id: form.pricing_basis === "per_sheet" ? (form.sheet_pricing_profile_id || null) : null,
  };
}

function SheetPricingCard({ profile, onSaved }: { profile: any; onSaved: () => void }) {
  const [rows, setRows] = useState<Array<{ min: string; max: string; price: string }>>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setRows((profile?.sheet_pricing_tiers ?? []).sort((a: any, b: any) => a.min_sheets - b.min_sheets).map((row: any) => ({ min: String(row.min_sheets), max: row.max_sheets == null ? "" : String(row.max_sheets), price: String(row.price_per_sheet) })));
  }, [profile]);
  async function createProfile() {
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).from("sheet_pricing_profiles").insert({
        name: "Default sheet pricing",
        description: "Configure the per-sheet prices used by quotes.",
        active: true,
      }).select("id").single();
      if (error) throw error;
      const starterTiers = [1, 20, 50, 100, 300, 500, 800, 1000].map((min, index, all) => ({
        profile_id: data.id,
        min_sheets: min,
        max_sheets: index === all.length - 1 ? null : all[index + 1] - 1,
        price_per_sheet: 0,
      }));
      const { error: tierError } = await (supabase as any).from("sheet_pricing_tiers").insert(starterTiers);
      if (tierError) throw tierError;
      toast.success("Sheet pricing profile created");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create sheet pricing");
    } finally { setBusy(false); }
  }
  if (!profile) return <Card className="border-amber-200 bg-amber-50 p-4 text-sm"><strong>Sheet pricing is not configured.</strong><p className="mt-1 text-muted-foreground">Create one profile, enter the prices once, and quotes will choose the matching tier automatically.</p><Button className="mt-3" size="sm" onClick={createProfile} disabled={busy}>{busy ? "Creating..." : "Create sheet pricing"}</Button></Card>;
  async function save() {
    setBusy(true);
    try {
      const normalized = rows.map((row) => ({ min_sheets: Number(row.min), max_sheets: row.max ? Number(row.max) : null, price_per_sheet: Number(row.price) }));
      if (normalized.some((row) => !Number.isInteger(row.min_sheets) || row.min_sheets <= 0 || row.price_per_sheet < 0 || (row.max_sheets != null && row.max_sheets < row.min_sheets))) throw new Error("Check the sheet ranges and prices.");
      const { error: delError } = await (supabase as any).from("sheet_pricing_tiers").delete().eq("profile_id", profile.id);
      if (delError) throw delError;
      const { error } = await (supabase as any).from("sheet_pricing_tiers").insert(normalized.map((row) => ({ profile_id: profile.id, ...row })));
      if (error) throw error;
      toast.success("Sheet pricing saved"); onSaved(); setOpen(false);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save sheet pricing"); } finally { setBusy(false); }
  }
  return <Card className="p-4"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">Sheet pricing</h2><p className="mt-1 text-sm text-muted-foreground">{profile.name} · Quotes choose the matching tier automatically.</p></div><Button variant="outline" size="sm" onClick={() => setOpen((value) => !value)}>{open ? "Hide tiers" : "Edit tiers"}</Button></div>{open ? <div className="mt-4 space-y-2"><div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground"><span>From sheets</span><span>To sheets</span><span>Price / sheet</span><span /></div>{rows.map((row, index) => <div key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2"><Input type="number" min="1" value={row.min} onChange={(e) => setRows((all) => all.map((item, i) => i === index ? { ...item, min: e.target.value } : item))} /><Input type="number" min="1" placeholder="No limit" value={row.max} onChange={(e) => setRows((all) => all.map((item, i) => i === index ? { ...item, max: e.target.value } : item))} /><Input type="number" min="0" step="0.01" value={row.price} onChange={(e) => setRows((all) => all.map((item, i) => i === index ? { ...item, price: e.target.value } : item))} /><Button variant="ghost" size="icon" aria-label="Remove tier" onClick={() => setRows((all) => all.filter((_, i) => i !== index))}>×</Button></div>)}<div className="flex justify-between pt-2"><Button variant="ghost" size="sm" onClick={() => setRows((all) => [...all, { min: "", max: "", price: "" }])}>Add tier</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving..." : "Save tiers"}</Button></div></div> : null}</Card>;
}

function parseRequiredPositive(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be greater than 0.`);
  return parsed;
}

function parseOptionalPositive(value: string, label: string) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be greater than 0.`);
  return parsed;
}

function formatSize(template: TemplateRow) {
  if (!template.default_width || !template.default_height) return "";
  return ` · ${template.default_width} × ${template.default_height}`;
}
