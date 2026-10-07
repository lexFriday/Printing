import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CustomerPicker } from "@/components/CustomerPicker";
import { CustomerContactPicker, type CustomerContact } from "@/components/CustomerContactPicker";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { computeInclusiveVat, computeLine, type Uom } from "@/lib/calc";
import { peso } from "@/lib/format";
import { canCreateCustomerInvoices } from "@/lib/roles";
import { computeStandaloneInvoiceTotals, validateStandaloneInvoiceDraft } from "@/lib/standaloneInvoice";
import { useAuth } from "@/hooks/useAuth";
import { useStickySummary } from "@/hooks/useStickySummary";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/invoices/new")({
  head: () => ({ meta: [{ title: "New invoice - AutoMate PH" }] }),
  component: NewInvoice,
});

type InvoiceLineDraft = {
  description: string;
  pricing_mode: "sqft" | "fixed";
  unit_of_measure: Uom;
  width: string;
  height: string;
  quantity: string;
  rate_per_sqft: string;
  unit_price: string;
};

 

const emptyLine: InvoiceLineDraft = {
  description: "",
  pricing_mode: "fixed",
  unit_of_measure: "feet",
  width: "",
  height: "",
  quantity: "1",
  rate_per_sqft: "",
  unit_price: "",
};

function NewInvoice() {
  const nav = useNavigate();
  const { role } = useAuth();
  const canWrite = canCreateCustomerInvoices(role);
  const today = new Date().toISOString().slice(0, 10);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerContact, setCustomerContact] = useState<CustomerContact | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [taxType, setTaxType] = useState<"vatable" | "non_vat">("non_vat");
  const [ewtEnabled, setEwtEnabled] = useState(false);
  const [lines, setLines] = useState<InvoiceLineDraft[]>([{ ...emptyLine }]);
  useEffect(() => {
    const jobOrderId = new URLSearchParams(window.location.search).get("jobOrderId");
    if (!jobOrderId) return;
    supabase.from("job_orders").select("customer_id, lines:job_order_line_items(*)").eq("id", jobOrderId).single().then(({ data }) => {
      if (!data) return;
      setCustomerId(data.customer_id);
      setLines((data.lines ?? []).map((line: any) => ({ description: line.description, pricing_mode: line.pricing_mode, unit_of_measure: line.unit_of_measure ?? "feet", width: String(line.width ?? ""), height: String(line.height ?? ""), quantity: String(line.quantity), rate_per_sqft: String(line.rate_per_sqft ?? ""), unit_price: String(line.unit_price) })));
    });
  }, []);
  const { slotRef: summarySlotRef, pinned: summaryPinned, style: summaryStyle } = useStickySummary();


  function updateLine(index: number, patch: Partial<InvoiceLineDraft>) {
    setLines((prev) => prev.map((line, idx) => (idx === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    setLines((prev) => {
      const next = prev.filter((_, idx) => idx !== index);
      return next.length > 0 ? next : [{ ...emptyLine }];
    });
  }

  function computed(line: InvoiceLineDraft) {
    if (line.pricing_mode === "sqft") {
      return computeLine({
        pricing_mode: "sqft",
        width: Number(line.width || 0),
        height: Number(line.height || 0),
        unit_of_measure: line.unit_of_measure,
        rate_per_sqft: Number(line.rate_per_sqft || 0),
        quantity: Number(line.quantity || 0),
      });
    }
    return computeLine({
      pricing_mode: "fixed",
      unit_price: Number(line.unit_price || 0),
      quantity: Number(line.quantity || 0),
    });
  }

  const baseTotal = lines.reduce((sum, line) => sum + computed(line).line_total, 0);
  const effectiveEwtEnabled = taxType === "vatable" && ewtEnabled;
  const totals = computeStandaloneInvoiceTotals(baseTotal, taxType, effectiveEwtEnabled, 0.02);
  const { vat, grossTotal, ewt: ewtAmount, amountDue } = totals;

  const createInvoice = useMutation({
    mutationFn: async () => {
      if (!canWrite) throw new Error("You do not have permission to create invoices.");
      const draftErrors = validateStandaloneInvoiceDraft({
        customerId,
        invoiceDate,
        dueDate,
        lines: lines.map((line) => ({ description: line.description, quantity: Number(line.quantity || 0), lineTotal: computed(line).line_total })),
      });
      if (draftErrors.length > 0) throw new Error(draftErrors[0]);

      for (const line of lines) {
        if (!line.description.trim()) throw new Error("Each line needs a description.");
        if (Number(line.quantity || 0) <= 0) throw new Error("Quantity must be greater than zero.");
        if (
          line.pricing_mode === "sqft" &&
          (Number(line.width || 0) <= 0 ||
            Number(line.height || 0) <= 0 ||
            Number(line.rate_per_sqft || 0) <= 0)
        ) {
          throw new Error("Sq ft lines need width, height, and rate.");
        }
        if (line.pricing_mode === "fixed" && Number(line.unit_price || 0) <= 0) {
          throw new Error("Fixed lines need a unit price.");
        }
        if (computed(line).line_total <= 0) throw new Error("Line total must be greater than zero.");
      }

      const linePayload = lines.map((line, idx) => {
        const value = computed(line);
        return {
          description: line.description.trim(),
          pricing_mode: line.pricing_mode,
          unit_of_measure: line.pricing_mode === "sqft" ? line.unit_of_measure : null,
          width: line.pricing_mode === "sqft" ? Number(line.width) : null,
          height: line.pricing_mode === "sqft" ? Number(line.height) : null,
          rate_per_sqft: line.pricing_mode === "sqft" ? Number(line.rate_per_sqft) : null,
          quantity: Number(line.quantity),
          computed_sqft: value.computed_sqft,
          unit_price: value.unit_price,
          line_total: value.line_total,
          sort_order: idx,
        };
      });

      const { data, error } = await supabase.rpc("create_standalone_invoice", {
        invoice_data: {
          customer_id: customerId,
          customer_contact_id: customerContact?.id ?? null,
          contact_name_snapshot: customerContact?.contact_name ?? null,
          contact_department_snapshot: customerContact?.department ?? null,
          contact_phone_snapshot: customerContact?.phone ?? null,
          contact_email_snapshot: customerContact?.email ?? null,
          invoice_date: invoiceDate,
          due_date: dueDate || null,
          invoice_amount: baseTotal,
          tax_type: taxType,
          ewt_enabled: effectiveEwtEnabled,
          ewt_rate: 0.02,
          ewt_treatment_snapshot:
            effectiveEwtEnabled ? "deducted_from_amount_due" : "reference_only",
        },
        lines: linePayload,
      });
      if (error) throw error;
      const invoice = Array.isArray(data) ? data[0] : data;
      if (!invoice?.id) throw new Error("Invoice creation did not return an invoice.");

      await logAudit("invoice.standalone_created", "invoice", invoice.id, {
        invoice_number: invoice.invoice_number,
        customer_id: customerId,
      });
      return invoice;
    },
    onSuccess: (invoice) => {
      toast.success(`Opening invoice ${invoice.invoice_number}`);
      nav({ to: "/invoices/$id", params: { id: invoice.id } });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!canWrite) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>You cannot create invoices.</AlertTitle>
        <AlertDescription>Ask Sales, Accounting, or an admin to create this invoice.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/invoices">
          <ArrowLeft className="h-4 w-4" /> All invoices
        </Link>
      </Button>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Create customer invoice</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Prepare a bill for delivery and collection. This invoice is not a supplier purchase or expense.
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="space-y-3">
          <Card className="rounded-xl border-primary/10 p-4 shadow-sm">
            <div className="mb-3 flex items-start gap-3">
              <StepBadge>1</StepBadge>
              <div>
                <h2 className="font-semibold">Customer and billing details</h2>
              <p className="text-sm text-muted-foreground">
                Choose the customer and set the dates and tax treatment for this invoice.
              </p>
              </div>
            </div>
            <div className="grid items-start gap-x-5 gap-y-3 md:grid-cols-2">
              <div className="space-y-3">
                <div className="space-y-1">
                <Label>Customer</Label>
                <CustomerPicker
                  value={customerId}
                  onChange={(id) => {
                    setCustomerId(id);
                    setCustomerContact(null);
                  }}
                />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="invoice-date">Invoice date</Label>
                  <Input
                    id="invoice-date"
                    type="date"
                    value={invoiceDate}
                    onChange={(event) => setInvoiceDate(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Tax</Label>
                  <Select
                    value={taxType}
                    onValueChange={(value) => {
                      const nextTaxType = value as "vatable" | "non_vat";
                      setTaxType(nextTaxType);
                      if (nextTaxType === "non_vat") setEwtEnabled(false);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="non_vat">Non-VAT</SelectItem>
                      <SelectItem value="vatable">VATable</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-3">
                <CustomerContactPicker
                  customerId={customerId}
                  value={customerContact?.id ?? null}
                  onChange={setCustomerContact}
                  compact
                />
                <div className="space-y-1">
                  <Label htmlFor="invoice-due-date">Due date</Label>
                  <Input
                    id="invoice-due-date"
                    type="date"
                    min={invoiceDate}
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                </div>
              {taxType === "vatable" ? (
                <label className="flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm">
                  <Checkbox
                    checked={ewtEnabled}
                    onCheckedChange={(checked) => setEwtEnabled(checked === true)}
                  />
                  Deduct 2% EWT from amount due
                </label>
              ) : null}
              </div>
            </div>
          </Card>

          <Card className="rounded-xl border-primary/10 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <StepBadge>2</StepBadge>
                <div>
                  <h2 className="font-semibold">Items to bill</h2>
                <p className="text-sm text-muted-foreground">Type the materials, products, or services being billed.</p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}
              >
                <Plus className="h-4 w-4" /> Add line
              </Button>
            </div>

            <div className="space-y-2">
              {lines.map((line, index) => {
                const lineTotal = computed(line).line_total;
                return (
                  <div key={index} className="rounded-md border p-3">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <Label>Item, material, or service</Label>
                        <Input
                          placeholder="e.g. 5 rolls sticker material"
                          value={line.description}
                          onChange={(event) => updateLine(index, { description: event.target.value })}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-6 h-9 w-9"
                        aria-label="Remove line"
                        onClick={() => removeLine(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="space-y-1">
                        <Label>Mode</Label>
                        <Select
                          value={line.pricing_mode}
                          onValueChange={(value) =>
                            updateLine(index, { pricing_mode: value as "sqft" | "fixed" })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fixed">Fixed</SelectItem>
                            <SelectItem value="sqft">Sq ft</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>Qty</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={line.quantity}
                          onChange={(event) => updateLine(index, { quantity: event.target.value })}
                        />
                      </div>
                      {line.pricing_mode === "sqft" ? (
                        <>
                          <div className="space-y-1">
                            <Label>Width</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.0001"
                              value={line.width}
                              onChange={(event) => updateLine(index, { width: event.target.value })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>Height</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.0001"
                              value={line.height}
                              onChange={(event) => updateLine(index, { height: event.target.value })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>Unit</Label>
                            <Select
                              value={line.unit_of_measure}
                              onValueChange={(value) =>
                                updateLine(index, { unit_of_measure: value as Uom })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="feet">Feet</SelectItem>
                                <SelectItem value="inches">Inches</SelectItem>
                                <SelectItem value="millimeters">Millimeters</SelectItem>
                                <SelectItem value="centimeters">Centimeters</SelectItem>
                                <SelectItem value="meters">Meters</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label>Rate</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.rate_per_sqft}
                              onChange={(event) =>
                                updateLine(index, { rate_per_sqft: event.target.value })
                              }
                            />
                          </div>
                        </>
                      ) : (
                        <div className="space-y-1 md:col-span-2">
                          <Label>Unit price</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.unit_price}
                            onChange={(event) => updateLine(index, { unit_price: event.target.value })}
                          />
                        </div>
                      )}
                    </div>
                    <div className="mt-3 text-right text-sm">
                      <span className="text-muted-foreground">Line total </span>
                      <span className="font-medium tabular-nums">{peso(lineTotal)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div ref={summarySlotRef} className="min-w-0 self-start" style={summaryPinned ? { minHeight: 1 } : undefined}>
        <Card
          className="z-10 h-fit w-full rounded-xl border-primary/10 p-4 shadow-sm"
          style={summaryStyle}
        >
          <div className="flex items-center justify-between border-b pb-3">
            <h2 className="font-semibold">Invoice total</h2>
            <span className="text-xs text-muted-foreground">Live</span>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <TotalRow label="Subtotal" value={peso(baseTotal)} />
            {taxType === "vatable" ? (
              <>
                <TotalRow label="VATable sales" value={peso(totals.vatableSales)} />
                <TotalRow label="VAT 12%" value={peso(totals.vat)} />
                {ewtEnabled ? <TotalRow label="EWT 2%" value={`-${peso(ewtAmount)}`} /> : null}
              </>
            ) : null}
            {taxType === "non_vat" && ewtEnabled ? <TotalRow label="EWT 2%" value={`-${peso(ewtAmount)}`} /> : null}
            <div className="border-t pt-3">
              <TotalRow label="Amount due" value={peso(amountDue)} strong />
            </div>
          </div>
          <Button
            className="mt-4 h-10 w-full"
            disabled={createInvoice.isPending}
            onClick={() => createInvoice.mutate()}
          >
            <Save className="h-4 w-4" />
            {createInvoice.isPending ? "Creating..." : "Create Invoice"}
          </Button>
        </Card>
        </div>
      </div>
    </div>
  );
}

function StepBadge({ children }: { children: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
      {children}
    </span>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums ${strong ? "text-lg font-semibold" : "font-medium"}`}>
        {value}
      </span>
    </div>
  );
}
