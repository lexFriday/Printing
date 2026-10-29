import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, CheckCircle2, FileImage, Printer, Upload } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { peso, fmtDate } from "@/lib/format";
import { daysOutstanding, receivableStatus } from "@/lib/calc";
import { StatusPill as StatusBadge } from "@/components/system";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/hooks/useAuth";
import { canAccountingWork } from "@/lib/roles";
import { downloadInvoiceExcel } from "@/lib/invoiceExcelExport";

const PAYMENT_PROOF_BUCKET = "invoice-payment-proofs";
const PAYMENT_PROOF_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PAYMENT_PROOF_MAX_BYTES = 10 * 1024 * 1024;

function paymentErrorMessage(error: unknown) {
  const detail = error instanceof Error ? error.message.toLowerCase() : "";
  if (detail.includes("row-level security") || detail.includes("permission denied")) {
    return "Payment proof upload was rejected. The payment was not recorded. Check your permission and try again.";
  }
  if (detail.includes("storage") || detail.includes("upload")) {
    return "Payment proof could not be uploaded. The payment was not recorded. Check the image and try again.";
  }
  return "Payment could not be recorded. No payment was saved. Please try again.";
}
function validatePaymentProof(file: File) {
  if (!PAYMENT_PROOF_TYPES.includes(file.type)) {
    throw new Error("Proof must be a JPG, PNG, or WEBP image.");
  }
  if (file.size > PAYMENT_PROOF_MAX_BYTES) {
    throw new Error("Proof image must be 10MB or smaller.");
  }
}

async function uploadPaymentProof(invoiceId: string, paymentId: string, file: File) {
  validatePaymentProof(file);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${invoiceId}/${paymentId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from(PAYMENT_PROOF_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return {
    path,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
  };
}

export const Route = createFileRoute("/_app/invoices/$id")({
  head: () => ({ meta: [{ title: "Invoice - AutoMate PH" }] }),
  component: InvoiceDetails,
});

function DetailRow({
  label,
  value,
  valueClassName = "",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b pb-3 last:border-b-0 last:pb-0">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`text-right font-medium capitalize ${valueClassName}`}>{value}</div>
    </div>
  );
}

function InvoiceDetails() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { role } = useAuth();
  const [payOpen, setPayOpen] = useState(false);
  const [ewtPrintOpen, setEwtPrintOpen] = useState(false);
  const [ewtPrintEnabled, setEwtPrintEnabled] = useState(true);
  const [ewtPrintRate, setEwtPrintRate] = useState("0.02");
  const [orNumber, setOrNumber] = useState("");
  const [poNumber, setPoNumber] = useState<string | null>(null);
  const navigate = useNavigate();
  const canWrite = canAccountingWork(role);

  const inv = useQuery({
    queryKey: ["invoice", id],
    queryFn: async () => {
      const [{ data, error }, { data: payments, error: paymentsError }] = await Promise.all([
        (supabase.from("invoices") as any)
          .select(
            "*, customer:customers(*), job_order:job_orders(id, job_number, project_name, client_po_number), quotation:quotations(id, quote_number, project_name), lines:invoice_line_items(*)",
          )
          .eq("id", id)
          .single(),
        supabase
          .from("invoice_payments")
          .select(
            "id, payment_date, amount, remarks, created_at, proof_storage_path, proof_file_name, proof_file_type, proof_file_size",
          )
          .eq("invoice_id", id)
          .order("payment_date", { ascending: false }),
      ]);
      if (error) throw error;
      if (paymentsError) throw paymentsError;
      return { ...data, payments: payments ?? [] };
    },
  });

  const recordPayment = useMutation({
    mutationFn: async (f: {
      payment_date: string;
      amount: number;
      remarks: string;
      proofFile: File | null;
    }) => {
      if (!canWrite) throw new Error("You do not have permission to perform this action.");
      if (!inv.data) throw new Error("No invoice");
      if (!f.payment_date) throw new Error("Payment date is required.");
      if (f.payment_date > new Date().toISOString().slice(0, 10)) {
        throw new Error("Future payment dates are not allowed.");
      }
      if (f.amount <= 0) throw new Error("Payment amount must be greater than zero.");
      const payments = ((inv.data.payments as Array<{ amount: number }> | null) ?? []).reduce(
        (sum, payment) => sum + Number(payment.amount),
        0,
      );
      const amountDue = Number(inv.data.amount_due_snapshot ?? inv.data.invoice_amount);
      const balance = amountDue - payments;
      if (balance <= 0) throw new Error("This invoice has already been paid.");
      if (f.amount > balance) throw new Error("Payment cannot exceed the remaining balance.");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const paymentId = crypto.randomUUID();
      let proof:
        | {
            path: string;
            fileName: string;
            fileType: string;
            fileSize: number;
          }
        | undefined;

      if (f.proofFile) {
        proof = await uploadPaymentProof(id, paymentId, f.proofFile);
      }

      const { error } = await supabase.from("invoice_payments").insert({
        id: paymentId,
        invoice_id: id,
        payment_date: f.payment_date,
        amount: f.amount,
        remarks: f.remarks.trim() || null,
        created_by: user?.id,
        proof_storage_path: proof?.path ?? null,
        proof_file_name: proof?.fileName ?? null,
        proof_file_type: proof?.fileType ?? null,
        proof_file_size: proof?.fileSize ?? null,
      });
      if (error) {
        if (proof?.path) {
          await supabase.storage.from(PAYMENT_PROOF_BUCKET).remove([proof.path]);
        }
        throw error;
      }
      await logAudit("invoice.payment_recorded", "invoice", id, f);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      setPayOpen(false);
      toast.success("Payment recorded");
    },
    onError: (e: Error) => toast.error(paymentErrorMessage(e)),
  });

  const issueInvoice = useMutation({
    mutationFn: async () => {
      if (!canWrite) throw new Error("You do not have permission to issue invoices.");
      const { error } = await (supabase.rpc as any)("issue_draft_invoice", { p_invoice_id: id });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["invoice", id] });
      toast.success("Invoice issued and ready for collection");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const replacePaymentProof = useMutation({
    mutationFn: async (f: { paymentId: string; oldStoragePath: string | null; file: File }) => {
      if (!canWrite) throw new Error("You do not have permission to perform this action.");
      const proof = await uploadPaymentProof(id, f.paymentId, f.file);
      const { error } = await supabase
        .from("invoice_payments")
        .update({
          proof_storage_path: proof.path,
          proof_file_name: proof.fileName,
          proof_file_type: proof.fileType,
          proof_file_size: proof.fileSize,
        })
        .eq("id", f.paymentId)
        .eq("invoice_id", id);

      if (error) {
        await supabase.storage.from(PAYMENT_PROOF_BUCKET).remove([proof.path]);
        throw error;
      }

      if (f.oldStoragePath) {
        await supabase.storage.from(PAYMENT_PROOF_BUCKET).remove([f.oldStoragePath]);
      }

      await logAudit("invoice.payment_proof_replaced", "invoice", id, {
        payment_id: f.paymentId,
        proof_file_name: proof.fileName,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      toast.success("Payment proof replaced");
    },
    onError: (e: Error) => toast.error(paymentErrorMessage(e)),
  });

  const saveOfficialReceipt = useMutation({
    mutationFn: async (value: string) => {
      if (!canWrite) throw new Error("You do not have permission to update this invoice.");
      const normalized = value.trim().toUpperCase();
      if (!normalized) throw new Error("Official Receipt number is required.");
      const { error } = await supabase
        .from("invoices")
        .update({ official_receipt_number: normalized })
        .eq("id", id);
      if (error) throw error;
      await logAudit("invoice.official_receipt_recorded", "invoice", id, {
        official_receipt_number: normalized,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      toast.success("Official Receipt number saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (inv.isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;
  if (!inv.data) return <div>Not found</div>;
  const i = inv.data;
  const jo = i.job_order as {
    id: string;
    job_number: string;
    project_name: string;
    client_po_number: string | null;
  } | null;
  const sourceQuote = i.quotation as {
    id: string;
    quote_number: string;
    project_name: string;
  } | null;

  const savePoNumber = useMutation({
    mutationFn: async (val: string) => {
      if (!canWrite) throw new Error("You do not have permission to update this invoice.");
      let targetJobId = jo?.id;
      if (!targetJobId && i.quotation_id) {
        const { data: matchedJob } = await supabase
          .from("job_orders")
          .select("id")
          .eq("quotation_id", i.quotation_id)
          .maybeSingle();
        if (matchedJob?.id) targetJobId = matchedJob.id;
      }
      if (!targetJobId) {
        toast.info("No linked Job Order found to save PO Number to.");
        return;
      }
      const { error } = await supabase
        .from("job_orders")
        .update({ client_po_number: val.trim() || null })
        .eq("id", targetJobId);
      if (error) throw error;
      await logAudit("invoice.po_number_updated", "invoice", id, { client_po_number: val.trim() || null });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      toast.success("PO Number saved");
    },
    onError: (e: Error) => toast.error(`Failed to save PO: ${e.message}`),
  });
  const lines =
    (i.lines as Array<{
      id: string;
      description: string;
      pricing_mode: string;
      quantity: number;
      unit_price: number;
      line_total: number;
      sort_order: number | null;
    }>) ?? [];
  const payments =
    (i.payments as Array<{
      id: string;
      payment_date: string;
      amount: number;
      remarks: string | null;
      created_at: string;
      proof_storage_path: string | null;
      proof_file_name: string | null;
    }>) ?? [];
  const amountPaid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const grossTotal = Number(i.gross_total_snapshot ?? i.invoice_amount);
  const amountDue = Number(i.amount_due_snapshot ?? i.invoice_amount);
  const vatableSales = Number(i.vatable_sales_snapshot ?? 0);
  const vatAmount = Number(i.vat_amount_snapshot ?? 0);
  const ewtAmount = Number(i.ewt_amount_snapshot ?? 0);
  const ewtEnabled = i.tax_type === "vatable" && Boolean(i.ewt_enabled) && ewtAmount > 0;
  const balance = Math.max(amountDue - amountPaid, 0);
  const isDraft = i.status === "draft";
  const derivedStatus = isDraft ? "draft" : receivableStatus(amountDue, amountPaid, i.due_date);
  const overdueDays = balance > 0 ? daysOutstanding(i.due_date) : null;
  const cust = i.customer as {
    customer_name: string;
    contact_person: string;
    contact_number: string;
    address: string | null;
    email: string | null;
  };
  const downloadExcel = async () => {
    try {
      await downloadInvoiceExcel({
        invoiceNumber: i.invoice_number,
        invoiceDate: i.invoice_date,
        customerName: cust.customer_name,
        customerAddress: cust.address ?? "",
        customerTin: (cust as { tin_number?: string | null }).tin_number ?? "",
        clientPoNumber: jo?.client_po_number ?? "",
        taxType: i.tax_type ?? "non_vat",
        lines: lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity ?? 0),
          unit_price: Number(line.unit_price ?? 0),
          line_total: Number(line.line_total ?? 0),
        })),
        grossTotal,
        vatableSales,
        vatAmount,
        ewtAmount: ewtEnabled ? ewtAmount : 0,
        amountDue,
      });
      toast.success("Excel invoice downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Excel invoice could not be downloaded.");
    }
  };

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/invoices">
          <ArrowLeft className="h-4 w-4" /> All invoices
        </Link>
      </Button>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="break-words text-3xl font-semibold">Invoice {i.invoice_number}</h1>
            <StatusBadge status={derivedStatus} />
          </div>
                    <p className="text-muted-foreground text-sm">
            {jo ? (
              <>
                For job{" "}
                <Link to="/jobs/$id" params={{ id: jo.id }} className="underline">
                  {jo.job_number}
                </Link>{" "}
                - {jo.project_name}
              </>
            ) : sourceQuote ? (
              <>
                From quote{" "}
                <Link to="/quotes/$id" params={{ id: sourceQuote.id }} className="underline">
                  {sourceQuote.quote_number}
                </Link>{" "}
                - {sourceQuote.project_name}
              </>
            ) : (
              <>Standalone invoice for {cust.customer_name}</>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {canWrite && isDraft ? (
            <Button onClick={() => issueInvoice.mutate()} disabled={issueInvoice.isPending}>
              <CheckCircle2 className="h-4 w-4" />
              {issueInvoice.isPending ? "Issuing…" : "Issue invoice"}
            </Button>
          ) : null}
          {canWrite && !isDraft && balance > 0 && (
            <Dialog open={payOpen} onOpenChange={setPayOpen}>
              <DialogTrigger asChild>
                <Button disabled={recordPayment.isPending}>
                  <CheckCircle2 className="h-4 w-4" />{" "}
                  {recordPayment.isPending ? "Recording..." : "Record Payment"}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Record payment</DialogTitle>
                </DialogHeader>
                <PayForm
                  balance={balance}
                  onSubmit={(v) => recordPayment.mutate(v)}
                  busy={recordPayment.isPending}
                />
              </DialogContent>
            </Dialog>
          )}
          {!isDraft ? <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Printer className="h-4 w-4" /> Sales Invoice
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void downloadExcel()}>
                Download Excel invoice
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => setEwtPrintOpen(true)}
                >
                  With EWT
                </button>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  to="/invoices/$id/print"
                  params={{ id }}
                  search={{ includeEwt: false, ewtRate: 0.02 }}
                >
                  Without EWT
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu> : null}
          <Dialog open={ewtPrintOpen} onOpenChange={setEwtPrintOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Print invoice with EWT</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <label className="flex items-start gap-3 rounded-md border bg-muted/20 p-3 text-sm">
                  <Checkbox
                    checked={ewtPrintEnabled}
                    onCheckedChange={(checked) => setEwtPrintEnabled(checked === true)}
                  />
                  <span>
                    <span className="font-medium">Deduct EWT from amount due</span>
                    <span className="block text-muted-foreground">
                      The gross total stays visible, but the customer pays the amount after EWT.
                    </span>
                  </span>
                </label>
                {ewtPrintEnabled ? (
                  <div className="space-y-2">
                    <Label htmlFor="invoice-print-ewt-rate">EWT rate</Label>
                    <Input
                      id="invoice-print-ewt-rate"
                      type="number"
                      min="0"
                      max="1"
                      step="0.0001"
                      value={ewtPrintRate}
                      onChange={(event) => setEwtPrintRate(event.target.value)}
                    />
                  </div>
                ) : null}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEwtPrintOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setEwtPrintOpen(false);
                    navigate({
                      to: "/invoices/$id/print",
                      params: { id },
                      search: {
                        includeEwt: ewtPrintEnabled,
                        ewtRate: ewtPrintEnabled ? Number(ewtPrintRate || 0.02) : 0.02,
                      },
                    });
                  }}
                >
                  Continue to print
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {jo ? (
            <Button asChild variant="outline">
              <Link
                to="/jobs/$id/job-order/print"
                params={{ id: jo.id }}
                search={{ fromInvoiceId: id }}
              >
                <Printer className="h-4 w-4" /> Print Source Job Order
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="p-4">
        <div className="grid gap-4 md:grid-cols-2">
          {/* Client PO Number */}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="invoice-po-number">Client PO Number</Label>
                <span className="text-[10px] font-semibold text-red-600 uppercase bg-red-50 px-1.5 py-0.5 rounded border border-red-100">
                  SI Red Print
                </span>
              </div>
              <Input
                id="invoice-po-number"
                value={poNumber !== null ? poNumber : (jo?.client_po_number || "")}
                onChange={(event) => setPoNumber(event.target.value)}
                placeholder="e.g. 3306"
                disabled={!canWrite}
                className="font-mono font-bold text-red-600"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!canWrite || savePoNumber.isPending}
              onClick={() => savePoNumber.mutate(poNumber !== null ? poNumber : (jo?.client_po_number || ""))}
            >
              {savePoNumber.isPending ? "Saving..." : "Save PO No."}
            </Button>
          </div>

          {/* Official Receipt No. */}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="invoice-or-number">Official Receipt No.</Label>
              <Input
                id="invoice-or-number"
                value={orNumber || i.official_receipt_number || ""}
                onChange={(event) => setOrNumber(event.target.value)}
                placeholder="Enter when collection requires an OR"
                disabled={!canWrite}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!canWrite || saveOfficialReceipt.isPending || !(orNumber || i.official_receipt_number)}
              onClick={() => saveOfficialReceipt.mutate(orNumber || i.official_receipt_number || "")}
            >
              {saveOfficialReceipt.isPending ? "Saving..." : "Save OR No."}
            </Button>
          </div>
        </div>
      </Card>

      {!canWrite ? (
        <Alert>
          <AlertTitle>Invoice is read-only for your role.</AlertTitle>
          <AlertDescription>Accounting records invoice payments.</AlertDescription>
        </Alert>
      ) : null}

      {isDraft ? (
        <Alert>
          <AlertTitle>This invoice is still a draft.</AlertTitle>
          <AlertDescription>
            Review the customer, line items, and totals, then issue it before printing or recording payment.
          </AlertDescription>
        </Alert>
      ) : null}

      {balance <= 0 ? (
        <Alert>
          <AlertTitle>This invoice is paid.</AlertTitle>
          <AlertDescription>
            Additional payments are hidden to preserve financial reporting.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-[minmax(12rem,1fr)_minmax(8rem,0.55fr)_minmax(8rem,0.55fr)] sm:items-end">
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">Balance due</div>
            <div
              className={`mt-1 text-3xl font-semibold tabular-nums ${
                balance > 0 ? "text-destructive" : "text-success"
              }`}
            >
              {peso(balance)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Invoice amount</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{peso(grossTotal)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Amount paid</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{peso(amountPaid)}</div>
          </div>
        </div>
        {i.tax_type === "vatable" ? (
          <div className="mt-4 grid gap-3 border-t pt-4 text-sm sm:grid-cols-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">VATable sales</span>
              <span className="font-medium tabular-nums">{peso(vatableSales)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">VAT 12%</span>
              <span className="font-medium tabular-nums">{peso(vatAmount)}</span>
            </div>
            {ewtEnabled ? (
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">
                  {i.ewt_treatment_snapshot === "deducted_from_amount_due" ? "Less: EWT" : "EWT"}
                </span>
                <span className="font-medium tabular-nums">{peso(ewtAmount)}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card className="p-4">
        <div className="mb-3">
          <h2 className="font-semibold">Billing details</h2>
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(18rem,0.95fr)_minmax(18rem,0.75fr)]">
          <div className="space-y-1.5">
            <div className="text-xs font-medium uppercase text-muted-foreground">Bill to</div>
            <div className="break-words text-lg font-semibold leading-snug">
              {cust.customer_name}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {i.contact_name_snapshot ?? cust.contact_person} {"·"}{" "}
              {i.contact_phone_snapshot ?? cust.contact_number}
            </div>
            {cust.email && <div className="text-sm text-muted-foreground">{cust.email}</div>}
            {cust.address && (
              <div className="max-w-xl break-words text-sm text-muted-foreground">
                {cust.address}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-medium uppercase text-muted-foreground">
              Invoice details
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>Invoice date: {fmtDate(i.invoice_date)}</span>
              {i.due_date ? <span>Due date: {fmtDate(i.due_date)}</span> : null}
              {i.payment_date ? <span>Paid on: {fmtDate(i.payment_date)}</span> : null}
              {overdueDays != null ? <span>Days outstanding: {overdueDays}</span> : null}
            </div>
            <div className="break-words text-lg font-semibold leading-snug">
              {jo ? jo.job_number : "Standalone invoice"}
            </div>
            {jo?.project_name || sourceQuote?.project_name ? (
              <div className="text-sm font-medium text-slate-800">
                <span className="text-muted-foreground font-normal">Project: </span>
                {jo?.project_name || sourceQuote?.project_name}
              </div>
            ) : null}
            {jo?.client_po_number ? (
              <div className="text-xs text-muted-foreground">
                Client PO: <span className="font-mono font-bold text-red-600">{jo.client_po_number}</span>
              </div>
            ) : null}
            <div className="text-sm text-muted-foreground">
              Tax mode: {i.tax_type === "vatable" ? "VATable" : "Non-VAT"}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="p-4 border-b">
          <h2 className="font-semibold">Line items</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {i.quotation_id
              ? "Copied from the approved quotation."
              : jo
                ? "Copied from the completed Job Order."
                : "Entered directly on this invoice."}
          </p>
        </div>
        <div className="max-h-[24rem] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.description}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(l.quantity)}</TableCell>
                    <TableCell className="text-right tabular-nums">{peso(l.unit_price)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {peso(l.line_total)}
                    </TableCell>
                  </TableRow>
                ))}
              {i.tax_type === "vatable" ? (
                <>
                  <TableRow>
                    <TableCell colSpan={3} className="text-right font-medium">
                      VATable sales
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {peso(vatableSales)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={3} className="text-right font-medium">
                      VAT 12%
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {peso(vatAmount)}
                    </TableCell>
                  </TableRow>
                  {ewtEnabled ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-right font-medium">
                        {i.ewt_treatment_snapshot === "deducted_from_amount_due"
                          ? "Less: EWT"
                          : "EWT"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {peso(ewtAmount)}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </>
              ) : null}
              <TableRow className="bg-muted/30">
                <TableCell colSpan={3} className="text-right font-semibold">
                  {i.tax_type === "vatable" &&
                  i.ewt_treatment_snapshot !== "deducted_from_amount_due"
                    ? "Grand total"
                    : "Amount due"}
                </TableCell>
                <TableCell className="text-right text-lg font-semibold tabular-nums">
                  {peso(amountDue)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Card>

      {i.payment_remarks && (
        <Card className="p-4">
          <div className="text-xs text-muted-foreground mb-1">Payment remarks</div>
          <div className="text-sm">{i.payment_remarks}</div>
        </Card>
      )}

      <Card>
        <div className="p-4 border-b">
          <h2 className="font-semibold">Payments</h2>
        </div>
        <div className="max-h-[20rem] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead>Proof</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No payments recorded
                  </TableCell>
                </TableRow>
              ) : (
                payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmtDate(payment.payment_date)}
                    </TableCell>
                    <TableCell>{payment.remarks || "-"}</TableCell>
                    <TableCell>
                      <PaymentProofCell
                        paymentId={payment.id}
                        storagePath={payment.proof_storage_path}
                        fileName={payment.proof_file_name}
                        canReplace={canWrite}
                        busy={replacePaymentProof.isPending}
                        onReplace={(file) =>
                          replacePaymentProof.mutate({
                            paymentId: payment.id,
                            oldStoragePath: payment.proof_storage_path,
                            file,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {peso(payment.amount)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function PayForm({
  balance,
  onSubmit,
  busy,
}: {
  balance: number;
  onSubmit: (v: {
    payment_date: string;
    amount: number;
    remarks: string;
    proofFile: File | null;
  }) => void;
  busy?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    payment_date: today,
    amount: String(balance),
    remarks: "",
    proofFile: null as File | null,
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.payment_date) return toast.error("Payment date is required");
        if (f.payment_date > today) return toast.error("Future payment dates are not allowed");
        const amount = Number(f.amount);
        if (amount <= 0) return toast.error("Payment amount must be greater than zero");
        if (amount > balance) return toast.error("Payment cannot exceed the remaining balance");
        onSubmit({ ...f, amount });
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label>Payment Date *</Label>
        <Input
          type="date"
          max={today}
          required
          value={f.payment_date}
          onChange={(e) => setF({ ...f, payment_date: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label>Amount *</Label>
        <Input
          type="number"
          min="0.01"
          step="0.01"
          max={balance}
          required
          value={f.amount}
          onChange={(e) => setF({ ...f, amount: e.target.value })}
        />
        <div className="text-xs text-muted-foreground">Remaining balance: {peso(balance)}</div>
      </div>
      <div className="space-y-2">
        <Label>Payment remarks (optional)</Label>
        <Textarea
          rows={3}
          value={f.remarks}
          onChange={(e) => setF({ ...f, remarks: e.target.value })}
          placeholder="e.g. BPI deposit, check #1234..."
        />
      </div>
      <div className="space-y-2">
        <Label>Proof of payment (optional)</Label>
        <label className="grid min-h-20 w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-md border border-dashed p-3 text-sm transition-colors hover:bg-muted/40">
          <div className="flex min-w-0 items-center gap-3 overflow-hidden">
            <FileImage className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="truncate font-medium">
                {f.proofFile ? f.proofFile.name : "Attach screenshot or image"}
              </div>
              <div className="text-xs text-muted-foreground">JPG, PNG, or WEBP up to 10MB.</div>
            </div>
          </div>
          <span className="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs">
            <Upload className="h-4 w-4" />
            Choose
          </span>
          <Input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              if (!file) {
                setF({ ...f, proofFile: null });
                return;
              }
              if (!PAYMENT_PROOF_TYPES.includes(file.type)) {
                e.target.value = "";
                toast.error("Proof must be a JPG, PNG, or WEBP image.");
                return;
              }
              if (file.size > PAYMENT_PROOF_MAX_BYTES) {
                e.target.value = "";
                toast.error("Proof image must be 10MB or smaller.");
                return;
              }
              setF({ ...f, proofFile: file });
            }}
          />
        </label>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving..." : "Record payment"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function PaymentProofCell({
  paymentId,
  storagePath,
  fileName,
  canReplace,
  busy,
  onReplace,
}: {
  paymentId: string;
  storagePath: string | null;
  fileName: string | null;
  canReplace: boolean;
  busy?: boolean;
  onReplace: (file: File) => void;
}) {
  const proof = useQuery({
    queryKey: ["invoice-payment-proof", storagePath],
    enabled: Boolean(storagePath),
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(PAYMENT_PROOF_BUCKET)
        .createSignedUrl(storagePath!, 10 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });

  const proofDisplay = !storagePath ? (
    <span className="inline-flex h-8 items-center text-sm text-muted-foreground">No proof</span>
  ) : !proof.data ? (
    <span className="inline-flex h-8 items-center text-sm text-muted-foreground">Loading...</span>
  ) : (
    <a
      href={proof.data}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs hover:bg-muted"
      title={fileName ?? "Proof of payment"}
    >
      <FileImage className="h-4 w-4" />
      View proof
    </a>
  );

  return (
    <div className="flex min-w-max items-center gap-2">
      {proofDisplay}
      {canReplace ? (
        <label
          className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium text-muted-foreground shadow-xs hover:bg-muted hover:text-foreground"
          title={storagePath ? "Replace proof" : "Upload proof"}
          aria-label={storagePath ? "Replace proof" : "Upload proof"}
        >
          <Upload className="h-4 w-4" />
          {storagePath ? "Replace proof" : "Upload proof"}
          <Input
            key={`${paymentId}-${fileName ?? "empty"}`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              e.target.value = "";
              if (!file) return;
              try {
                validatePaymentProof(file);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Invalid proof image.");
                return;
              }
              onReplace(file);
            }}
          />
        </label>
      ) : null}
    </div>
  );
}
