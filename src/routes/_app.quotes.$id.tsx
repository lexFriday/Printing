import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { WorkflowStepper } from "@/components/workflow-stepper";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Send,
  CheckCircle2,
  XCircle,
  ClipboardList,
  Pencil,
  Printer,
  Receipt,
  RotateCcw,
  MoreHorizontal,
  ShieldAlert,
} from "lucide-react";
import { peso, fmtDate } from "@/lib/format";
import { StatusPill as StatusBadge } from "@/components/system";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { QuoteAttachmentsSection } from "@/components/QuoteAttachmentsSection";
import { useAuth } from "@/hooks/useAuth";
import { canCreateJobOrders, canManageUsers, canReopenQuotes, canSalesWork } from "@/lib/roles";
import { formatTin } from "@/lib/customers";
import { computeInclusiveVat, computeQuoteDisplayTotal } from "@/lib/calc";

export const Route = createFileRoute("/_app/quotes/$id")({
  head: () => ({ meta: [{ title: "Quote - AutoMate PH" }] }),
  component: QuoteDetails,
});

function QuoteDetails() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const qc = useQueryClient();
  const { role, user } = useAuth();
  const [convertOpen, setConvertOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [targetDate, setTargetDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [approvedByName, setApprovedByName] = useState("");
  const [approvedByUserId, setApprovedByUserId] = useState("");
  const [showJobPrintReferences, setShowJobPrintReferences] = useState(false);
  const [clientPoNumber, setClientPoNumber] = useState("");
  const [drNumber, setDrNumber] = useState("");
  const [installationDate, setInstallationDate] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const canWrite = canSalesWork(role);
  const canCreateJobOrder = canCreateJobOrders(role);
  const canReopen = canReopenQuotes(role);
  const canManagerApprove = canReopen;
  const canSetUpSignatures = canManageUsers(role);
  const isEditRoute = pathname.endsWith("/edit");

  const q = useQuery({
    queryKey: ["quote", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotations")
        .select(
          "*, customer:customers(*), lines:quote_line_items(*), job_order:job_orders(id, job_number)",
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const approvers = useQuery({
    queryKey: ["job-order-approvers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, email, signature_url")
        .eq("status", "active")
        .order("display_name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const quoteSigner = useQuery({
    queryKey: ["quote-signer-readiness", q.data?.sales_agent_user_id],
    enabled: Boolean(q.data?.sales_agent_user_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, email, signature_url, status")
        .eq("id", q.data!.sales_agent_user_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const existingInvoiceQuery = useQuery({
    queryKey: ["quote-invoice", id],
    enabled: q.data?.status === "approved",
    queryFn: async () => {
      const { data, error } = await (supabase.from("invoices") as any)
        .select("id,invoice_number,status")
        .eq("quotation_id", id)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; invoice_number: string; status: string } | null;
    },
  });

  const setStatus = useMutation({
    mutationFn: async (status: "pending_manager_approval" | "sent" | "approved" | "rejected") => {
      if (!canWrite) {
        throw new Error("You do not have permission to update quotation status.");
      }
      if (!q.data) throw new Error("No quote");
      const expectedStatus =
        status === "pending_manager_approval"
          ? "draft"
          : status === "sent"
            ? "pending_manager_approval"
            : "sent";
      if (q.data.status !== expectedStatus) {
        throw new Error("This quote is no longer in the correct status for that action.");
      }
      if (status === "pending_manager_approval") {
        if (!q.data.sales_agent_user_id) {
          throw new Error("Select a Sales Agent before submitting this quotation.");
        }
        const { data: signer, error: signerError } = await supabase
          .from("profiles")
          .select("signature_url, status")
          .eq("id", q.data.sales_agent_user_id)
          .maybeSingle();
        if (signerError) throw signerError;
        if (!signer || signer.status !== "active") {
          throw new Error("The selected Sales Agent is not an active user.");
        }
      }
      const patch: {
        status: typeof status;
        sent_at?: string;
        manager_approved_at?: string;
        manager_approved_by_user_id?: string;
        approved_at?: string;
        rejected_at?: string;
      } = { status };
      const now = new Date().toISOString();
      if (status === "pending_manager_approval") patch.sent_at = now;
      if (status === "sent") {
        patch.manager_approved_at = now;
        patch.manager_approved_by_user_id = user?.id;
      }
      if (status === "approved") {
        patch.approved_at = now;
      }
      if (status === "rejected") {
        patch.rejected_at = now;
      }
      const { data, error } = await supabase
        .from("quotations")
        .update(patch)
        .eq("id", id)
        .eq("status", expectedStatus)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("This quote has already moved to another status.");
      await logAudit(`quotation.${status}`, "quotation", id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quote", id] });
      toast.success("Status updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reopen = useMutation({
    mutationFn: async () => {
      if (!canReopen) throw new Error("Only owner or admin staff can reopen quotations.");
      if (!reopenReason.trim()) throw new Error("A correction reason is required.");
      const { error } = await supabase.rpc("reopen_quotation_for_correction", {
        quotation_id: id,
        reason: reopenReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Quote reopened for correction");
      setReopenOpen(false);
      setReopenReason("");
      await qc.invalidateQueries({ queryKey: ["quote", id] });
      nav({ to: "/quotes/$id/edit", params: { id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createInvoice = useMutation({
    mutationFn: async () => {
      if (!canWrite) throw new Error("You do not have permission to create invoices.");
      if (q.data?.status !== "approved") {
        throw new Error("Only approved quotations can create an invoice.");
      }
      const { data, error } = await (supabase.rpc as any)("create_invoice_from_approved_quote", {
        p_quotation_id: id,
      });
      if (error) throw error;
      const invoice = Array.isArray(data) ? data[0] : data;
      if (!invoice?.id) throw new Error("Invoice creation did not return an invoice.");
      return invoice as { id: string; invoice_number: string };
    },
    onSuccess: async (invoice) => {
      await qc.invalidateQueries({ queryKey: ["quote-invoice", id] });
      toast.success(`Draft invoice ${invoice.invoice_number} created`);
      nav({ to: "/invoices/$id", params: { id: invoice.id } });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const convert = useMutation({
    mutationFn: async () => {
      if (!canCreateJobOrder) {
        throw new Error("Only owner or admin staff can create job orders from approved quotes.");
      }
      if (!q.data) throw new Error("No quote");
      if (q.data.status !== "approved") {
        throw new Error("Only approved quotes can be converted to a Job Order.");
      }
      if (!targetDate || !approvedByUserId || !approvedByName) {
        throw new Error("Complete Date Requested and Approved By before creating the job order.");
      }
      const { data: existingJob, error: existingError } = await supabase
        .from("job_orders")
        .select("id, job_number")
        .eq("quotation_id", q.data.id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existingJob) return existingJob;
      const { data, error } = await (supabase.rpc as any)("create_job_order_from_approved_quote", {
        p_quotation_id: q.data.id,
        p_target_completion_date: targetDate,
        p_approved_by_user_id: approvedByUserId,
        p_client_po_number: clientPoNumber.trim() || null,
        p_dr_number: drNumber.trim() || null,
        p_installation_date: installationDate || null,
        p_internal_notes: internalNotes.trim() || null,
      });
      const jo = Array.isArray(data) ? data[0] : data;
      if (error) {
        throw error;
      }
      if (!jo?.id) throw new Error("Job Order creation did not return a record.");
      await logAudit("job_order.created", "job_order", jo.id, {
        job_number: jo.job_number,
        from_quote: q.data.quote_number,
      });
      return jo;
    },
    onSuccess: (jo) => {
      toast.success(`Opening job order ${jo.job_number}`);
      qc.invalidateQueries({ queryKey: ["quote", id] });
      setConvertOpen(false);
      nav({ to: "/jobs/$id", params: { id: jo.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;
  if (isEditRoute) return <Outlet />;
  if (!q.data) return <div>Not found</div>;
  const quote = q.data;
  const existingJo = (quote.job_order as { id: string; job_number: string }[] | null)?.[0];
  const customer = quote.customer as {
    customer_name: string;
    contact_person: string;
    contact_number: string;
    tin_number: string | null;
    address: string | null;
  } | null;
  const workflowSteps = getWorkflowSteps(quote, existingJo);
  const quoteBaseTotal = Number(quote.subtotal || 0) + Number(quote.adjustment_amount || 0);
  const quoteVat = computeInclusiveVat(quoteBaseTotal);
  const quoteDisplayTotal = computeQuoteDisplayTotal(quote);
  const quoteLines = (
    quote.lines as Array<{
      id: string;
      description: string;
      pricing_mode: string;
      width: number | null;
      height: number | null;
      unit_of_measure: string | null;
      computed_sqft: number | null;
      rate_per_sqft: number | null;
      quantity: number;
      unit_price: number;
      line_total: number;
      adjustment_label: string | null;
      adjustment_amount: number | null;
      sort_order: number | null;
    }>
  ).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const itemAdjustmentTotal = quoteLines.reduce(
    (sum, line) => sum + Number(line.adjustment_amount || 0),
    0,
  );
  const displaySubtotal = Number(quote.subtotal || 0) - itemAdjustmentTotal;
  const displayAdjustment = itemAdjustmentTotal + Number(quote.adjustment_amount || 0);
  const canReopenSubmittedQuote =
    canWrite && ["pending_manager_approval", "sent"].includes(quote.status);
  const canReopenApprovedQuote = canReopen && quote.status === "approved" && !existingJo;
  const canReopenQuote = canReopenSubmittedQuote || canReopenApprovedQuote;
  const reopenDialogTitle =
    quote.status === "approved" ? "Reopen approved quote" : "Reopen quote for correction";
  const reopenDialogDescription =
    quote.status !== "approved"
      ? "This returns the quote to Draft so pricing or details can be edited before customer decision."
      : "This returns the approved quote to Draft. It is allowed only before a job order is created.";
  const signerName =
    quoteSigner.data?.display_name ?? quoteSigner.data?.email ?? "No Sales Agent selected";
  const signerReady =
    quoteSigner.data?.status === "active" && Boolean(quoteSigner.data?.signature_url);
  const selectedApprover = approvers.data?.find((entry) => entry.id === approvedByUserId);

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/quotes">
          <ArrowLeft className="h-4 w-4" /> All quotes
        </Link>
      </Button>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="break-words text-3xl font-semibold">{quote.project_name}</h1>
            <StatusBadge status={quote.status} />
          </div>
          <p className="text-muted-foreground font-mono text-sm">{quote.quote_number}</p>
        </div>
        <div className="flex gap-2 flex-wrap sm:justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More quote actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/quotes/$id/print" params={{ id }}>
                  <Printer className="mr-2 h-4 w-4" /> Print Quote
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canWrite && quote.status === "draft" && (
            <Button asChild variant="outline">
              <Link to="/quotes/$id/edit" params={{ id }}>
                <Pencil className="h-4 w-4" /> Edit quote
              </Link>
            </Button>
          )}
          {canWrite && quote.status === "draft" && (
            <>
              <Button
                onClick={() => setStatus.mutate("pending_manager_approval")}
                disabled={setStatus.isPending || quoteSigner.isLoading || !signerReady}
              >
                <Send className="h-4 w-4" /> Submit for manager approval
              </Button>
            </>
          )}
          {quote.status === "pending_manager_approval" && (
            <>
              {canReopenQuote ? (
                <QuoteReopenDialog
                  open={reopenOpen}
                  onOpenChange={setReopenOpen}
                  title={reopenDialogTitle}
                  description={reopenDialogDescription}
                  reason={reopenReason}
                  onReasonChange={setReopenReason}
                  onReopen={() => reopen.mutate()}
                  pending={reopen.isPending}
                />
              ) : null}
              {canManagerApprove ? (
                <Button onClick={() => setStatus.mutate("sent")} disabled={setStatus.isPending}>
                  <CheckCircle2 className="h-4 w-4" /> Manager approve
                </Button>
              ) : null}
            </>
          )}
          {canWrite && quote.status === "sent" && (
            <>
              <Button
                variant="outline"
                onClick={() => setStatus.mutate("rejected")}
                disabled={setStatus.isPending}
              >
                <XCircle className="h-4 w-4" /> Customer rejected
              </Button>
              <Button onClick={() => setStatus.mutate("approved")} disabled={setStatus.isPending}>
                <CheckCircle2 className="h-4 w-4" /> Customer approved
              </Button>
            </>
          )}
          {canReopenApprovedQuote && (
            <QuoteReopenDialog
              open={reopenOpen}
              onOpenChange={setReopenOpen}
              title={reopenDialogTitle}
              description={reopenDialogDescription}
              reason={reopenReason}
              onReasonChange={setReopenReason}
              onReopen={() => reopen.mutate()}
              pending={reopen.isPending}
            />
          )}
          {quote.status === "approved" && existingInvoiceQuery.data ? (
            <Button asChild variant="outline">
              <Link to="/invoices/$id" params={{ id: existingInvoiceQuery.data.id }}>
                <Receipt className="h-4 w-4" /> Open invoice{" "}
                {existingInvoiceQuery.data.invoice_number}
              </Link>
            </Button>
          ) : canWrite && quote.status === "approved" ? (
            <Button
              variant="outline"
              onClick={() => createInvoice.mutate()}
              disabled={createInvoice.isPending || existingInvoiceQuery.isLoading}
            >
              <Receipt className="h-4 w-4" />
              {createInvoice.isPending ? "Creating invoice…" : "Create invoice"}
            </Button>
          ) : null}
          {canCreateJobOrder && quote.status === "approved" && !existingJo && (
            <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
              <DialogTrigger asChild>
                <Button disabled={convert.isPending}>
                  <ClipboardList className="h-4 w-4" /> Convert to Job Order
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create production Job Order</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Add the handoff details production needs before starting.
                  </p>
                  <section className="space-y-3">
                    <h3 className="text-sm font-medium">Production handoff</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="job-order-target-date">
                          Date Requested <RequiredMark />
                        </Label>
                        <Input
                          id="job-order-target-date"
                          type="date"
                          required
                          value={targetDate}
                          onChange={(event) => setTargetDate(event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="job-order-approved-by">
                          Approved By <RequiredMark />
                        </Label>
                        <Select
                          value={approvedByUserId}
                          onValueChange={(profileId) => {
                            const approver = approvers.data?.find(
                              (entry) => entry.id === profileId,
                            );
                            setApprovedByUserId(profileId);
                            setApprovedByName(approver?.display_name ?? approver?.email ?? "");
                          }}
                        >
                          <SelectTrigger id="job-order-approved-by">
                            <SelectValue placeholder="Select approver" />
                          </SelectTrigger>
                          <SelectContent>
                            {(approvers.data ?? []).map((approver) => (
                              <SelectItem
                                key={approver.id}
                                value={approver.id}
                              >
                                {approver.display_name ?? approver.email ?? "Unnamed user"}
                                {!approver.signature_url ? " — Signature missing" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {selectedApprover
                            ? selectedApprover.signature_url
                              ? "Signature ready"
                              : "Signature missing"
                            : "Choose an active user with a saved signature."}
                        </p>
                      </div>
                    </div>
                  </section>
                  <Collapsible
                    open={showJobPrintReferences}
                    onOpenChange={setShowJobPrintReferences}
                  >
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        {showJobPrintReferences
                          ? "Hide optional print references"
                          : "Add optional print references"}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-3">
                      <section className="space-y-3 rounded-md border p-3">
                        <h3 className="text-sm font-medium">Optional print references</h3>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label>Client PO No.</Label>
                            <Input
                              value={clientPoNumber}
                              onChange={(event) => setClientPoNumber(event.target.value)}
                              placeholder="Client PO number"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>DR No.</Label>
                            <Input
                              value={drNumber}
                              onChange={(event) => setDrNumber(event.target.value)}
                              placeholder="DR number"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Installation date</Label>
                            <Input
                              type="date"
                              value={installationDate}
                              onChange={(event) => setInstallationDate(event.target.value)}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Internal notes</Label>
                          <Textarea
                            rows={3}
                            value={internalNotes}
                            onChange={(event) => setInternalNotes(event.target.value)}
                          />
                        </div>
                      </section>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => convert.mutate()}
                    disabled={convert.isPending}
                  >
                    {convert.isPending ? "Creating..." : "Create Job Order"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {existingJo && (
            <Button asChild variant="outline">
              <Link to="/jobs/$id" params={{ id: existingJo.id }}>
                View Job Order {existingJo.job_number}
              </Link>
            </Button>
          )}
        </div>
      </div>

      {!canWrite ? (
        <Alert>
          <AlertTitle>Quote is read-only for your role.</AlertTitle>
          <AlertDescription>
            You do not have permission to submit, approve, reject, edit, or convert quotations.
          </AlertDescription>
        </Alert>
      ) : null}

      {canWrite && quote.status === "draft" ? (
        <Alert variant={signerReady ? "default" : "destructive"}>
          {signerReady ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          <AlertTitle>{signerReady ? "Signature ready" : "Signature missing"}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {quote.sales_agent_user_id
                ? `${signerName}${signerReady ? " is ready for document signing." : " needs a signature before this quote can be submitted."}`
                : "Select a Sales Agent before this quote can be submitted."}
            </span>
            {!signerReady && canSetUpSignatures ? (
              <Button asChild size="sm" variant="outline">
                <Link to="/settings/users">Set up signature</Link>
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {canWrite && !canCreateJobOrder && quote.status === "approved" && !existingJo ? (
        <Alert>
          <AlertTitle>
            Only owner or admin staff can create job orders from approved quotes.
          </AlertTitle>
          <AlertDescription>
            Sales can prepare quotations and record customer approval. Ask the owner or admin staff
            to create the job order for production.
          </AlertDescription>
        </Alert>
      ) : null}

      <QuoteNextAction
        status={quote.status}
        existingJobNumber={existingJo?.job_number}
        canWrite={canWrite}
        canCreateJobOrder={canCreateJobOrder}
      />

      <Card className="p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-[minmax(12rem,1fr)_minmax(8rem,0.45fr)_minmax(8rem,0.45fr)] sm:items-end">
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">Quote total</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">
              {peso(quoteDisplayTotal)}
            </div>
          </div>
          <DetailRow
            label="VAT mode"
            value={quote.tax_type === "vatable" ? "VATable" : "Non-VAT"}
          />
          <DetailRow label="Workflow" value={quote.status.replaceAll("_", " ")} />
        </div>
      </Card>

      <Card className="p-3">
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(18rem,0.9fr)_minmax(18rem,0.9fr)]">
          <section>
            <h2 className="text-sm font-semibold">Customer</h2>
            <div className="mt-3 space-y-1.5">
              <div className="break-words text-lg font-semibold leading-snug">
                {customer?.customer_name || "-"}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>TIN: {formatTin(customer?.tin_number) || "-"}</span>
                <span>
                  Contact: {quote.contact_name_snapshot ?? customer?.contact_person ?? "-"} /{" "}
                  {quote.contact_phone_snapshot ?? customer?.contact_number ?? "-"}
                </span>
              </div>
              <div className="break-words text-sm text-muted-foreground">
                {customer?.address || "-"}
              </div>
            </div>
          </section>

          <section className="lg:border-l lg:pl-4">
            <h2 className="text-sm font-semibold">Quote details</h2>
            <div className="mt-3 space-y-1.5">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>Quote date: {fmtDate(quote.quote_date)}</span>
                <span>Terms: {quote.terms || "-"}</span>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">Sales Agent</div>
                <div className="break-words text-lg font-semibold leading-snug">
                  {quote.sales_agent || "-"}
                </div>
              </div>
              {quote.remarks ? (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Remarks</div>
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {quote.remarks}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold">Workflow</h2>
          <p className="text-xs text-muted-foreground">Approval path from quote to job order.</p>
        </div>
        <WorkflowStepper steps={workflowSteps} />
      </Card>

      <Card>
        <div className="border-b p-4">
          <h2 className="font-semibold">Line items</h2>
          <p className="mt-1 text-sm text-muted-foreground">Quoted products and services.</p>
        </div>
        <div className="max-h-[24rem] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Line total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quoteLines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="font-medium">{l.description}</div>
                    {l.pricing_mode === "sqft" && (
                      <div className="text-xs text-muted-foreground">
                        {l.width}x{l.height} {l.unit_of_measure} /{" "}
                        {Number(l.computed_sqft ?? 0).toFixed(2)} sq ft @ {peso(l.rate_per_sqft)}
                        /sq ft
                      </div>
                    )}
                    {Number(l.adjustment_amount ?? 0) !== 0 ? (
                      <div className="text-xs text-muted-foreground">
                        {l.adjustment_label || "Adjustment"}: {peso(l.adjustment_amount)}
                      </div>
                    ) : null}
                    <div className="mt-3">
                      <QuoteAttachmentsSection
                        quotationId={id}
                        quoteLineItemId={l.id}
                        title="Reference images"
                        description="Attached to this item."
                        compact
                        allowUpload={false}
                        hideWhenEmpty
                      />
                    </div>
                  </TableCell>
                  <TableCell className="capitalize text-sm">
                    {l.pricing_mode === "sqft" ? "Sq ft" : "Fixed"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{Number(l.quantity)}</TableCell>
                  <TableCell className="text-right tabular-nums">{peso(l.unit_price)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {peso(l.line_total)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/30">
                <TableCell colSpan={4} className="text-right font-semibold">
                  Subtotal
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {peso(displaySubtotal)}
                </TableCell>
              </TableRow>
              {displayAdjustment !== 0 ? (
                <TableRow className="bg-muted/30">
                  <TableCell colSpan={4} className="text-right font-semibold">
                    {quote.adjustment_label || "Adjustment"}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {peso(displayAdjustment)}
                  </TableCell>
                </TableRow>
              ) : null}
              {quote.tax_type === "vatable" ? (
                <>
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={4} className="text-right font-semibold">
                      VATable Sales
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {peso(quoteVat.vatableSales)}
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={4} className="text-right font-semibold">
                      VAT 12%
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {peso(quoteVat.vat)}
                    </TableCell>
                  </TableRow>
                </>
              ) : null}
              <TableRow className="bg-muted/30">
                <TableCell colSpan={4} className="text-right font-semibold">
                  Total
                </TableCell>
                <TableCell className="text-right text-lg font-semibold tabular-nums">
                  {peso(quoteDisplayTotal)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function DetailRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value?: string | null;
  multiline?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm font-medium ${multiline ? "whitespace-pre-wrap" : "truncate"}`}>
        {value || "-"}
      </div>
    </div>
  );
}

type WorkflowState = "done" | "current" | "waiting" | "blocked";

type WorkflowStep = {
  label: string;
  value: string;
  state: WorkflowState;
};

function WorkflowStepCard({ index, label, value, state }: WorkflowStep & { index: number }) {
  const markerClasses: Record<WorkflowState, string> = {
    done: "border-emerald-600 bg-emerald-600 text-white",
    current:
      "border-blue-600 bg-blue-50 text-blue-700 ring-4 ring-blue-100 motion-safe:animate-pulse",
    waiting: "border-slate-300 bg-white text-slate-500",
    blocked: "border-red-600 bg-red-50 text-red-700 ring-4 ring-red-100",
  };

  return (
    <div className="relative z-20 min-w-0 flex-1 bg-transparent sm:min-h-[4.75rem] sm:text-center">
      <div className="flex items-start gap-2 sm:flex-col sm:items-center sm:gap-1">
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-all duration-500 ease-out ${markerClasses[state]}`}
          aria-label={`Step ${index}: ${state}`}
        >
          {state === "done" ? <CheckCircle2 className="size-4" /> : index}
        </span>
        <div className="min-w-0 pt-0.5 sm:pt-0">
          <div className="text-sm font-semibold leading-5">{label}</div>
          {state !== "done" ? (
            <div className="mt-1 sm:mt-0.5">
              <WorkflowStatePill state={state} />
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-0.5 text-xs leading-4 text-muted-foreground sm:mt-1">{value}</div>
    </div>
  );
}

function WorkflowStatePill({ state }: { state: WorkflowState }) {
  const classes: Record<WorkflowState, string> = {
    done: "border-emerald-200 bg-emerald-50 text-emerald-700",
    current: "border-blue-200 bg-blue-50 text-blue-700",
    waiting: "border-slate-200 bg-slate-50 text-slate-600",
    blocked: "border-red-200 bg-red-50 text-red-700",
  };
  const labels: Record<WorkflowState, string> = {
    done: "Completed",
    current: "Current",
    waiting: "Waiting",
    blocked: "Blocked",
  };

  return (
    <span className={`rounded-full border px-1.5 py-0.5 text-[11px] font-medium ${classes[state]}`}>
      {labels[state]}
    </span>
  );
}

function getWorkflowSteps(
  quote: {
    status: string;
    sent_at: string | null;
    manager_approved_at?: string | null;
    approved_at: string | null;
    rejected_at: string | null;
  },
  existingJo?: { job_number: string },
): WorkflowStep[] {
  const rejected = quote.status === "rejected";
  const submitted =
    !!quote.sent_at ||
    [
      "pending_manager_approval",
      "pending_customer_approval",
      "sent",
      "approved",
      "rejected",
    ].includes(quote.status);
  const managerDone =
    !!quote.manager_approved_at ||
    ["pending_customer_approval", "sent", "approved", "rejected"].includes(quote.status);
  const customerDone = ["approved", "rejected"].includes(quote.status);

  return [
    {
      label: "Submitted",
      state: submitted ? "done" : "current",
      value: quote.sent_at ? fmtDate(quote.sent_at) : "Not submitted",
    },
    {
      label: "Manager approval",
      state: managerDone
        ? "done"
        : quote.status === "pending_manager_approval"
          ? "current"
          : "waiting",
      value: quote.manager_approved_at
        ? fmtDate(quote.manager_approved_at)
        : quote.status === "pending_manager_approval"
          ? "Waiting for owner/admin"
          : "Not yet reviewed",
    },
    {
      label: "Customer approval",
      state: rejected
        ? "blocked"
        : customerDone
          ? "done"
          : ["pending_customer_approval", "sent"].includes(quote.status)
            ? "current"
            : "waiting",
      value: rejected
        ? fmtDate(quote.rejected_at)
        : quote.approved_at
          ? fmtDate(quote.approved_at)
          : "Waiting for customer decision",
    },
    {
      label: "Job order",
      state: existingJo
        ? "done"
        : rejected
          ? "blocked"
          : quote.status === "approved"
            ? "current"
            : "waiting",
      value: existingJo?.job_number ?? (rejected ? "Quote rejected" : "Not yet created"),
    },
  ];
}

function QuoteNextAction({
  status,
  existingJobNumber,
  canWrite,
  canCreateJobOrder,
}: {
  status: string;
  existingJobNumber?: string;
  canWrite: boolean;
  canCreateJobOrder: boolean;
}) {
  if (status === "draft") {
    return (
      <Alert>
        <AlertTitle>Next Step: Submit for Manager Approval</AlertTitle>
        <AlertDescription>
          {canWrite
            ? "Review pricing, edit any draft details if needed, then submit the quotation for owner/admin approval."
            : "This draft must be reviewed and submitted by a sales or admin staff user."}
        </AlertDescription>
      </Alert>
    );
  }
  if (status === "pending_manager_approval") {
    return (
      <Alert>
        <AlertTitle>Next Step: Manager Approval</AlertTitle>
        <AlertDescription>
          Owner or admin staff must approve this quotation before the customer decision is recorded.
        </AlertDescription>
      </Alert>
    );
  }
  if (status === "sent") {
    return (
      <Alert>
        <AlertTitle>Next Step: Record Customer Decision</AlertTitle>
        <AlertDescription>
          {canWrite
            ? "Record the customer decision. Reopen only if the quote needs correction before approval."
            : "A sales or admin staff user must record whether the customer approved or rejected this quote."}
        </AlertDescription>
      </Alert>
    );
  }
  if (status === "pending_customer_approval") {
    return (
      <Alert>
        <AlertTitle>Next Step: Record Customer Decision</AlertTitle>
        <AlertDescription>
          {canWrite
            ? "Record whether the customer approved or rejected this quote."
            : "A sales or admin staff user must record whether the customer approved or rejected this quote."}
        </AlertDescription>
      </Alert>
    );
  }
  if (status === "approved" && !existingJobNumber) {
    return (
      <Alert>
        <AlertTitle>Next Step: Convert To Job Order</AlertTitle>
        <AlertDescription>
          {canWrite
            ? canCreateJobOrder
              ? "This quote is approved and ready to become the job order source record."
              : "Only owner or admin staff can create job orders from approved quotes."
            : "This approved quote is ready for the owner or admin staff to convert to a job order."}
        </AlertDescription>
      </Alert>
    );
  }
  if (status === "approved" && existingJobNumber) {
    return (
      <Alert>
        <AlertTitle>Job Order Created</AlertTitle>
        <AlertDescription>
          This quote already created job order {existingJobNumber}. Continue work from the job
          order.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <AlertTitle>No Next Action</AlertTitle>
      <AlertDescription>
        This quote was rejected. Create a new quote if the customer requests updated pricing.
      </AlertDescription>
    </Alert>
  );
}

function QuoteReopenDialog({
  menu = false,
  open,
  onOpenChange,
  title,
  description,
  reason,
  onReasonChange,
  onReopen,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  reason: string;
  onReasonChange: (reason: string) => void;
  onReopen: () => void;
  pending: boolean;
  menu?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {menu ? (
          <DropdownMenuItem onSelect={(event) => event.preventDefault()} disabled={pending}>
            <RotateCcw className="mr-2 h-4 w-4" /> Reopen for Correction
          </DropdownMenuItem>
        ) : (
          <Button variant="outline" disabled={pending}>
            <RotateCcw className="h-4 w-4" /> Reopen for Correction
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{description}</p>
          <Label>
            Correction reason <RequiredMark />
          </Label>
          <Textarea
            rows={3}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Briefly explain what needs to be corrected."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onReopen} disabled={pending}>
            {pending ? "Reopening..." : "Reopen Quote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden="true">
      *
    </span>
  );
}
