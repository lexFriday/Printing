import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Pencil, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, LoadingRow, PageHeader } from "@/components/system";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { canManageUsers } from "@/lib/roles";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/settings/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers — AutoMate PH" }] }),
  component: SuppliersPage,
});

type Supplier = { id: string; supplier_name: string; tin: string | null; address: string | null; contact_person: string | null; contact_number: string | null; email: string | null; payment_terms: string | null; notes: string | null; is_active: boolean };
type Form = Omit<Supplier, "id" | "is_active"> & { id?: string; is_active: boolean };
const blank: Form = { supplier_name: "", tin: "", address: "", contact_person: "", contact_number: "", email: "", payment_terms: "", notes: "", is_active: true };
const paymentTermPresets = ["COD", "30 days", "50% downpayment, balance upon completion", "Full payment upon completion"];

function SuppliersPage() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const qc = useQueryClient();
  const allowed = canManageUsers(role);
  useEffect(() => {
    if (!allowed) void navigate({ to: "/customers" });
  }, [allowed, navigate]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(blank);
  const suppliers = useQuery({
    queryKey: ["suppliers", search],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id,name,tin_number,address,contact_person,phone,email,payment_terms,active")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((supplier) => ({
        id: supplier.id,
        supplier_name: supplier.name,
        tin: supplier.tin_number,
        address: supplier.address,
        contact_person: supplier.contact_person,
        contact_number: supplier.phone,
        email: supplier.email,
        payment_terms: supplier.payment_terms,
        notes: null,
        is_active: supplier.active,
      })) as Supplier[];
    },
  });
  const rows = useMemo(() => (suppliers.data ?? []).filter((s) => `${s.supplier_name} ${s.tin ?? ""} ${s.contact_person ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())), [search, suppliers.data]);
  const save = async () => {
    if (!form.supplier_name.trim()) return toast.error("Supplier name is required.");
    const databasePayload = {
      name: form.supplier_name.trim(),
      tin_number: form.tin?.trim() || null,
      address: form.address?.trim() || null,
      contact_person: form.contact_person?.trim() || null,
      phone: form.contact_number?.trim() || null,
      email: form.email?.trim() || null,
      payment_terms: form.payment_terms?.trim() || null,
      active: form.is_active,
    };
    const result = form.id
      ? await supabase.from("suppliers").update(databasePayload).eq("id", form.id)
      : await supabase.from("suppliers").insert(databasePayload);
    if (result.error) return toast.error(result.error.message);
    toast.success(form.id ? "Supplier updated." : "Supplier added.");
    setOpen(false); setForm(blank); await qc.invalidateQueries({ queryKey: ["suppliers"] });
  };
  if (!allowed) return null;
  return <div className="space-y-6">
    <PageHeader title="Business Directory" description="Master records used across quotes, invoices, and expenses." actions={<Button onClick={() => { setForm(blank); setOpen(true); }}><Plus className="h-4 w-4" /> New supplier</Button>} />
    <div className="inline-flex rounded-lg border bg-muted/30 p-1" role="tablist" aria-label="Business category"><Button type="button" size="sm" variant="ghost" role="tab" onClick={() => navigate({ to: "/customers" })}>Customers</Button><Button type="button" size="sm" variant="default" role="tab" aria-selected="true">Suppliers</Button></div>
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between"><div className="relative w-full sm:max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search suppliers" className="h-11 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, contact, or TIN" /></div><p className="text-sm text-muted-foreground" aria-live="polite">{suppliers.isLoading ? "Loading suppliers..." : `${rows.length} supplier records`}</p></div>
      <div className="max-h-[calc(100dvh-16rem)] overscroll-contain overflow-auto"><Table className="min-w-[760px]"><TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>TIN</TableHead><TableHead>Contact person</TableHead><TableHead>Number</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{suppliers.isLoading ? <LoadingRow colSpan={7} /> : rows.length === 0 ? <EmptyState colSpan={7}>No suppliers yet</EmptyState> : rows.map((s) => <TableRow key={s.id}><TableCell className="max-w-[18rem] whitespace-nowrap font-medium"><div className="truncate" title={s.supplier_name}>{s.supplier_name}</div></TableCell><TableCell className="font-mono text-xs">{s.tin || "-"}</TableCell><TableCell>{s.contact_person || "-"}</TableCell><TableCell>{s.contact_number || "-"}</TableCell><TableCell className="max-w-[16rem] text-muted-foreground"><div className="truncate" title={s.email ?? ""}>{s.email || "-"}</div></TableCell><TableCell>{s.is_active ? "Active" : "Inactive"}</TableCell><TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => { setForm({ ...s }); setOpen(true); }}><Pencil className="mr-2 h-4 w-4" />Edit</Button></TableCell></TableRow>)}</TableBody></Table></div>
    </Card>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{form.id ? "Edit supplier" : "New supplier"}</DialogTitle></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2 sm:col-span-2"><Label>Supplier name *</Label><Input value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })} /></div><div className="space-y-2"><Label>TIN</Label><Input value={form.tin ?? ""} onChange={(e) => setForm({ ...form, tin: e.target.value })} /></div><div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div><div className="space-y-2 sm:col-span-2"><Label>Address</Label><Input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div><div className="space-y-2"><Label>Contact person</Label><Input value={form.contact_person ?? ""} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div><div className="space-y-2"><Label>Contact number</Label><Input value={form.contact_number ?? ""} onChange={(e) => setForm({ ...form, contact_number: e.target.value })} /></div><div className="space-y-2 sm:col-span-2"><Label>Payment terms</Label><Select value={form.payment_terms && paymentTermPresets.includes(form.payment_terms) ? form.payment_terms : "custom"} onValueChange={(value) => setForm({ ...form, payment_terms: value === "custom" ? (paymentTermPresets.includes(form.payment_terms ?? "") ? "" : form.payment_terms ?? "") : value })}><SelectTrigger><SelectValue placeholder="Choose payment terms" /></SelectTrigger><SelectContent>{paymentTermPresets.map((term) => <SelectItem key={term} value={term}>{term}</SelectItem>)}<SelectItem value="custom">Custom</SelectItem></SelectContent></Select>{(!form.payment_terms || !paymentTermPresets.includes(form.payment_terms)) && <Input value={form.payment_terms ?? ""} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} placeholder="Type custom payment terms" />}<p className="text-xs text-muted-foreground">Choose a common term or select Custom to enter your own.</p></div><div className="space-y-2 sm:col-span-2"><Label>Notes</Label><Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => void save()}>Save supplier</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
