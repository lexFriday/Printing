import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Card } from "@/components/ui/card";
import { WorkflowStepper } from "@/components/workflow-stepper";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Plus, Receipt, CheckCircle2, Trash2, Pencil, Printer, MoreHorizontal } from "lucide-react";
import { computeInclusiveVat, computeMaterialAmount } from "@/lib/calc";
import { peso, fmtDate, paymentDateToIso } from "@/lib/format";
import { canAccountingWork, canControlJobs, canManageUsers } from "@/lib/roles";
import { StatusPill as StatusBadge } from "@/components/system";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/hooks/useAuth";
import { JobOrderCorrectionForm } from "@/components/JobOrderCorrectionForm";

export const Route = createFileRoute("/_app/jobs/$id")({
  head: () => ({ meta: [{ title: "Job Order - AutoMate PH" }] }),
  component: JobDetails,
});

const JOB_FLOW = ["pending", "in_production", "ready", "delivered", "completed"] as const;
const JOB_ACTION: Partial<
  Record<(typeof JOB_FLOW)[number], { next: (typeof JOB_FLOW)[number]; label: string }>
> = {
  pending: { next: "in_production", label: "Start Production" },
  in_production: { next: "ready", label: "Mark Ready for Delivery" },
  ready: { next: "delivered", label: "Mark Delivered" },
  delivered: { next: "completed", label: "Complete Job" },
};
const JOB_LABEL: Record<(typeof JOB_FLOW)[number], string> = {
  pending: "Pending",
  in_production: "In Production",
  ready: "Ready for Delivery",
  delivered: "Delivered",
  completed: "Completed",
};
const STATUS_CONFIRMATION: Partial<
  Record<(typeof JOB_FLOW)[number], { title: string; description: string; actionLabel: string }>
> = {
  delivered: {
    title: "Mark as Delivered?",
    description: "Confirm this job has been delivered to the customer.",
    actionLabel: "Mark Delivered",
  },
  completed: {
    title: "Complete Job?",
    description:
      "This closes the production workflow. Accounting can generate the invoice after completion.",
    actionLabel: "Complete Job",
  },
};
const EXPENSE_DIALOG_CLASS = "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl";
const EXPENSE_UNIT_OPTIONS = ["pcs", "sheets", "rolls", "sq ft", "set", "lot", "box", "liters"];
const EXPENSE_DESCRIPTION_OPTIONS = [
  "Sintra board",
  "Sticker",
  "Tarpaulin",
  "Ink",
  "Lamination",
  "Installation labor",
  "Delivery fee",
  "Outsourcing",
];
const JO_APPROVER_OPTIONS = [
  "Louise Relucano",
  "Nikko Relucano",
  "Michaela Corre",
  "Mylene Ibarbia",
  "Jeremy Josef",
  "Michael Aranton",
];

type ExpenseFormInitial = {
  expense_date: string;
  expense_type: string;
  supplier_name: string | null;
  description: string;
  quantity: number | null;
  unit_of_measure: string | null;
  unit_cost: number | null;
  amount: number;
  payment_status: "pending" | "paid";
  paid_at: string | null;
  due_date: string | null;
  reference_no: string | null;
  supplier_document_no: string | null;
  check_number: string | null;
  remarks: string | null;
};

function expenseFormState(expense?: ExpenseFormInitial) {
  return {
    expense_date: expense?.expense_date ?? new Date().toISOString().slice(0, 10),
    expense_type: expense?.expense_type ?? "materials",
    supplier_name: expense?.supplier_name ?? "",
    description: expense?.description ?? "",
    quantity: expense?.quantity?.toString() ?? "",
    unit_of_measure: expense?.unit_of_measure ?? "",
    unit_cost: expense?.unit_cost?.toString() ?? "",
    amount: expense ? String(expense.amount) : "",
    payment_status: expense?.payment_status ?? "pending",
    paid_date: expense?.paid_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    due_date: expense?.due_date ?? "",
    reference_no: expense?.reference_no ?? "",
    supplier_document_no: expense?.supplier_document_no ?? "",
    check_number: expense?.check_number ?? "",
    remarks: expense?.remarks ?? "",
  };
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b pb-3 last:border-b-0 last:pb-0">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-right font-medium">{value}</div>
    </div>
  );
}

function JobStatusActionButton({
  action,
  busy,
  onConfirm,
}: {
  action: { next: (typeof JOB_FLOW)[number]; label: string };
  busy: boolean;
  onConfirm: () => void;
}) {
  const confirmation = STATUS_CONFIRMATION[action.next];
  const buttonContent = (
    <>
      <CheckCircle2 className="h-4 w-4" /> {busy ? "Updating..." : action.label}
    </>
  );

  if (!confirmation) {
    return (
      <Button onClick={onConfirm} disabled={busy}>
        {buttonContent}
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={busy}>{buttonContent}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirmation.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmation.actionLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function JobDetails() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { role } = useAuth();
  const [expOpen, setExpOpen] = useState(false);
  const [editExpenseId, setEditExpenseId] = useState<string | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [jobFormOpen, setJobFormOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [payingExpense, setPayingExpense] = useState<JobExpensePaymentTarget | null>(null);
  const canJobWork = canControlJobs(role);
  const canExpenseWork = canAccountingWork(role);
  const canDeleteExpense = canManageUsers(role);

  const updateSheetUsage = useMutation({
    mutationFn: async ({ lineId, actualSheets }: { lineId: string; actualSheets: number | null }) => {
      if (!canJobWork) throw new Error("You do not have permission to update production usage.");
      const { error } = await supabase.from("job_order_line_items").update({ actual_sheets: actualSheets } as never).eq("id", lineId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job", id] }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save actual sheets"),
  });

  const j = useQuery({
    queryKey: ["job", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_orders")
        .select(
          "*, customer:customers(*), quotation:quotations(quote_number, total_amount, customer_contact_id, contact_name_snapshot, contact_department_snapshot, contact_phone_snapshot, contact_email_snapshot), lines:job_order_line_items(*), expenses:job_expenses(*), invoice:invoices(id, invoice_number, status)",
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const addExpense = useMutation({
    mutationFn: async (f: {
      expense_date: string;
      expense_type: string;
      supplier_name: string;
      description: string;
      quantity: number | null;
      unit_of_measure: string;
      unit_cost: number | null;
      amount: number;
      payment_status: "pending" | "paid";
      paid_date: string;
      due_date: string;
      reference_no: string;
      supplier_document_no: string;
      check_number: string;
      remarks: string;
    }) => {
      if (!canExpenseWork) throw new Error("You do not have permission to perform this action.");
      if (!f.expense_date) throw new Error("Expense date is required.");
      if (f.expense_date > new Date().toISOString().slice(0, 10)) {
        throw new Error("Future expense dates are not allowed.");
      }
      if (!f.description.trim()) throw new Error("Description is required.");
      const amount =
        f.expense_type === "materials" && f.quantity && f.unit_cost
          ? computeMaterialAmount(f.quantity, f.unit_cost)
          : f.amount;
      if (amount <= 0) throw new Error("Amount must be greater than zero.");
      if (f.due_date && f.due_date < f.expense_date) {
        throw new Error("Due date cannot be before the expense date.");
      }
      if (f.payment_status === "paid" && !f.check_number.trim()) {
        throw new Error("Check number is required when an expense is already paid.");
      }
      if (f.payment_status === "paid" && !f.paid_date) {
        throw new Error("Payment date is required when an expense is already paid.");
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase.from("job_expenses").insert({
        expense_date: f.expense_date,
        description: f.description.trim(),
        quantity: f.expense_type === "materials" ? f.quantity : null,
        unit_of_measure: f.expense_type === "materials" ? f.unit_of_measure.trim() || null : null,
        unit_cost: f.expense_type === "materials" ? f.unit_cost : null,
        amount,
        supplier_name: f.supplier_name.trim() || null,
        payment_status: f.payment_status,
        due_date: f.due_date || null,
        paid_at: f.payment_status === "paid" ? paymentDateToIso(f.paid_date) : null,
        reference_no: f.reference_no.trim() || null,
        supplier_document_no: f.supplier_document_no.trim() || null,
        check_number: f.check_number.trim() || null,
        remarks: f.remarks.trim() || null,
        expense_type: f.expense_type as
          | "materials"
          | "labor"
          | "delivery"
          | "installation"
          | "outsourcing"
          | "miscellaneous",
        job_order_id: id,
        created_by: user?.id,
      });
      if (error) throw error;
      await logAudit("expense.added", "job_order", id, f);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", id] });
      setExpOpen(false);
      toast.success("Expense added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteExp = useMutation({
    mutationFn: async (expId: string) => {
      if (!canDeleteExpense) throw new Error("You do not have permission to perform this action.");
      const expense = expenses.find((item) => item.id === expId);
      const { error } = await supabase.from("job_expenses").delete().eq("id", expId);
      if (error) throw error;
      await logAudit("expense.deleted", "job_order", id, expense);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", id] });
      toast.success("Expense deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateExpense = useMutation({
    mutationFn: async ({
      expenseId,
      values,
    }: {
      expenseId: string;
      values: {
        expense_date: string;
        expense_type: string;
        supplier_name: string;
        description: string;
        quantity: number | null;
        unit_of_measure: string;
        unit_cost: number | null;
        amount: number;
        payment_status: "pending" | "paid";
        paid_date: string;
        due_date: string;
        reference_no: string;
        supplier_document_no: string;
        check_number: string;
        remarks: string;
      };
    }) => {
      if (!canExpenseWork) throw new Error("You do not have permission to perform this action.");
      if (!values.expense_date) throw new Error("Expense date is required.");
      if (values.expense_date > new Date().toISOString().slice(0, 10)) {
        throw new Error("Future expense dates are not allowed.");
      }
      if (!values.description.trim()) throw new Error("Description is required.");
      const amount =
        values.expense_type === "materials" && values.quantity && values.unit_cost
          ? computeMaterialAmount(values.quantity, values.unit_cost)
          : values.amount;
      if (amount <= 0) throw new Error("Amount must be greater than zero.");
      if (values.due_date && values.due_date < values.expense_date) {
        throw new Error("Due date cannot be before the expense date.");
      }
      if (values.payment_status === "paid" && !values.check_number.trim()) {
        throw new Error("Check number is required when an expense is already paid.");
      }
      if (values.payment_status === "paid" && !values.paid_date) {
        throw new Error("Payment date is required when an expense is already paid.");
      }
      const current = expenses.find((item) => item.id === expenseId);
      const next = {
        expense_date: values.expense_date,
        expense_type: values.expense_type as
          | "materials"
          | "labor"
          | "delivery"
          | "installation"
          | "outsourcing"
          | "miscellaneous",
        description: values.description.trim(),
        quantity: values.expense_type === "materials" ? values.quantity : null,
        unit_of_measure:
          values.expense_type === "materials" ? values.unit_of_measure.trim() || null : null,
        unit_cost: values.expense_type === "materials" ? values.unit_cost : null,
        amount,
        supplier_name: values.supplier_name.trim() || null,
        payment_status: values.payment_status,
        due_date: values.due_date || null,
        paid_at: values.payment_status === "paid" ? paymentDateToIso(values.paid_date) : null,
        reference_no: values.reference_no.trim() || null,
        supplier_document_no: values.supplier_document_no.trim() || null,
        check_number: values.check_number.trim() || null,
        remarks: values.remarks.trim() || null,
      };
      const { error } = await supabase.from("job_expenses").update(next).eq("id", expenseId);
      if (error) throw error;
      await logAudit("expense.updated", "job_order", id, next, current);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", id] });
      setEditExpenseId(null);
      toast.success("Expense updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateExpensePayment = useMutation({
    mutationFn: async ({
      expenseId,
      payment_status,
      paid_date,
      reference_no,
      supplier_document_no,
      check_number,
    }: {
      expenseId: string;
      payment_status: "pending" | "paid";
      paid_date?: string;
      reference_no?: string;
      supplier_document_no?: string;
      check_number?: string;
    }) => {
      if (!canExpenseWork) throw new Error("You do not have permission to perform this action.");
      if (payment_status === "paid" && !paid_date) throw new Error("Payment date is required.");
      if (payment_status === "paid" && !check_number?.trim()) {
        throw new Error("Check number is required.");
      }
      const current = expenses.find((item) => item.id === expenseId);
      const update =
        payment_status === "paid"
          ? {
              payment_status,
              paid_at: paymentDateToIso(paid_date!),
              reference_no: reference_no?.trim() || null,
              supplier_document_no: supplier_document_no?.trim() || null,
              check_number: check_number?.trim() || null,
            }
          : {
              payment_status,
              paid_at: null,
            };
      const { error } = await supabase.from("job_expenses").update(update).eq("id", expenseId);
      if (error) throw error;
      await logAudit("expense.payment_updated", "job_order", id, update, current);
    },
    onSuccess: (_, vars) => {
      setPayingExpense(null);
      qc.invalidateQueries({ queryKey: ["job", id] });
      toast.success(vars.payment_status === "paid" ? "Expense marked paid" : "Expense reopened");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const advanceStatus = useMutation({
    mutationFn: async () => {
      if (!canJobWork) throw new Error("You do not have permission to perform this action.");
      if (!j.data) throw new Error("No job");
      const { data: latest, error: latestError } = await supabase
        .from("job_orders")
        .select("status")
        .eq("id", id)
        .single();
      if (latestError) throw latestError;

      const currentStatus = latest.status as keyof typeof JOB_ACTION;
      const action = JOB_ACTION[currentStatus];
      if (!action) throw new Error("This job is already completed.");
      const { data, error } = await supabase
        .from("job_orders")
        .update({ status: action.next })
        .eq("id", id)
        .eq("status", currentStatus)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("This job order status changed. Refresh and try again.");
      await logAudit("job_order.status_changed", "job_order", id, {
        old_status: currentStatus,
        new_status: action.next,
      });
    },
    onSuccess: () => {
      qc.refetchQueries({ queryKey: ["job", id] });
      toast.success("Job status updated");
    },
    onError: async (e: Error) => {
      if (e.message.includes("status changed")) {
        await qc.refetchQueries({ queryKey: ["job", id] });
        toast.info("Job status changed. Showing the latest status.");
        return;
      }
      toast.error(e.message);
    },
  });

  const updateJobFormDetails = useMutation({
    mutationFn: async (values: {
      target_completion_date: string;
      client_po_number: string;
      project_manager: string;
      approved_by_name: string;
      dr_number: string;
      installation_date: string;
    }) => {
      if (!canJobWork) throw new Error("You do not have permission to perform this action.");
      if (
        !values.target_completion_date ||
        !values.project_manager.trim() ||
        !values.approved_by_name
      ) {
        throw new Error("Complete Date Requested, Job In-charge, and Approved By before saving.");
      }
      const update = {
        target_completion_date: values.target_completion_date,
        client_po_number: values.client_po_number.trim() || null,
        project_manager: values.project_manager.trim(),
        approved_by_name: values.approved_by_name,
        dr_number: values.dr_number.trim() || null,
        installation_date: values.installation_date || null,
      };
      const { error } = await supabase.from("job_orders").update(update).eq("id", id);
      if (error) throw error;
      await logAudit("job_order.form_details_updated", "job_order", id, update);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", id] });
      setJobFormOpen(false);
      toast.success("Job form details updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const correctBeforeCompletion = useMutation({
    mutationFn: async ({ payload, reason }: { payload: Record<string, unknown>; reason: string }) => {
      if (!canJobWork || !j.data) throw new Error("You do not have permission to correct this Job Order.");
      const { error } = await (supabase.rpc as any)("correct_job_order_before_completion", { p_job_order_id: id, p_payload: payload, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["job", id] }); setCorrectionOpen(false); toast.success("Job Order corrected"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateInvoice = useMutation({
    mutationFn: async (f: {
      invoice_date: string;
      due_date: string | null;
      ewt_enabled: boolean;
      ewt_rate: number;
      lines: Array<{ job_order_line_item_id: string; quantity: number }>;
    }) => {
      if (!canAccountingWork(role)) {
        throw new Error("You do not have permission to perform this action.");
      }
      if (!j.data) throw new Error("No job");
      if (j.data.status !== "completed") {
        throw new Error("Complete the Job Order before generating an invoice.");
      }
      if (!f.invoice_date) throw new Error("Invoice date is required.");
      if (f.due_date && f.due_date < f.invoice_date) {
        throw new Error("Due date cannot be before the invoice date.");
      }
      if (f.lines.length === 0) throw new Error("Select at least one invoice line.");
      const { data, error } = await supabase.rpc("create_job_invoice", {
        invoice_data: {
          job_order_id: j.data.id,
          customer_id: j.data.customer_id,
          customer_contact_id: j.data.customer_contact_id ?? null,
          contact_name_snapshot: j.data.contact_name_snapshot ?? null,
          contact_department_snapshot: j.data.contact_department_snapshot ?? null,
          contact_phone_snapshot: j.data.contact_phone_snapshot ?? null,
          tax_type: j.data.tax_type ?? "non_vat",
          ewt_enabled: j.data.tax_type === "vatable" ? f.ewt_enabled : false,
          ewt_rate: f.ewt_rate || 0.02,
          ewt_treatment_snapshot:
            j.data.tax_type === "vatable" && f.ewt_enabled ? "deducted_from_amount_due" : "reference_only",
          invoice_date: f.invoice_date,
          due_date: f.due_date,
        },
        lines: f.lines,
      });
      if (error) {
        throw error;
      }
      const inv = Array.isArray(data) ? data[0] : data;
      if (!inv?.id) throw new Error("Invoice creation did not return an invoice.");
      await logAudit("invoice.generated", "invoice", inv.id, {
        invoice_number: inv.invoice_number,
        job_number: j.data.job_number,
      });
      return inv;
    },
    onSuccess: (inv) => {
      setInvoiceOpen(false);
      qc.invalidateQueries({ queryKey: ["job", id] });
      toast.success(`Opening invoice ${inv.invoice_number}`);
      nav({ to: "/invoices/$id", params: { id: inv.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (j.isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;
  if (!j.data) return <div>Not found</div>;
  const job = j.data;
  const expenses =
    (job.expenses as Array<{
      id: string;
      expense_date: string;
      expense_type: string;
      supplier_name: string | null;
      description: string;
      amount: number;
      quantity: number | null;
      unit_of_measure: string | null;
      unit_cost: number | null;
      payment_status: "pending" | "paid";
      due_date: string | null;
      paid_at: string | null;
      reference_no: string | null;
      supplier_document_no: string | null;
      check_number: string | null;
      remarks: string | null;
    }>) ?? [];
  const totalExp = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const supplierOptions = Array.from(
    new Set(expenses.map((expense) => expense.supplier_name?.trim()).filter(Boolean) as string[]),
  ).sort((a, b) => a.localeCompare(b));
  const revenue = Number(job.quoted_amount);
  const invoiceRelation = job.invoice as
    | { id: string; invoice_number: string; status: string }
    | { id: string; invoice_number: string; status: string }[]
    | null;
  const existingInv = Array.isArray(invoiceRelation) ? invoiceRelation[0] : invoiceRelation;
  const lines =
    (job.lines as Array<{
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
      sort_order: number | null;
    }>) ?? [];
  const lineSubtotal = lines.reduce((sum, line) => sum + Number(line.line_total || 0), 0);
  const jobVat = computeInclusiveVat(lineSubtotal);
  const displayRevenue =
    job.tax_type === "vatable" && lineSubtotal > 0 ? jobVat.grossTotal : revenue;
  const profit = displayRevenue - totalExp;
  const margin = displayRevenue > 0 ? (profit / displayRevenue) * 100 : 0;
  const statusAction = JOB_ACTION[job.status as keyof typeof JOB_ACTION];

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/jobs">
          {
            <>
              <ArrowLeft className="h-4 w-4" /> All jobs
            </>
          }
        </Link>
      </Button>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex min-w-0 items-center gap-3">
            <h1 className="min-w-0 truncate text-3xl font-semibold" title={job.project_name}>
              {job.project_name}
            </h1>
            <div className="shrink-0">
              <StatusBadge status={job.status} />
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>
              Job Order No. <span className="font-mono text-foreground">{job.job_number}</span>
            </span>
            <span>
              Source Quotation{" "}
              <span className="font-mono text-foreground">
                {(job.quotation as { quote_number: string } | null)?.quote_number ?? "-"}
              </span>
            </span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canJobWork && job.status === "pending" ? (
            <Button onClick={() => advanceStatus.mutate()} disabled={advanceStatus.isPending}>
              {advanceStatus.isPending ? "Starting..." : "Start production"}
            </Button>
          ) : null}
          {canJobWork && statusAction && job.status !== "pending" ? (
            <JobStatusActionButton
              action={statusAction}
              busy={advanceStatus.isPending}
              onConfirm={() => advanceStatus.mutate()}
            />
          ) : null}
          {existingInv && (
            <Button asChild variant="outline">
              <Link to="/invoices/$id" params={{ id: existingInv.id }}>
                View {existingInv.invoice_number}
              </Link>
            </Button>
          )}
          {canExpenseWork && job.status === "completed" && !existingInv ? (
            <div className="flex flex-col items-end gap-1">
              <Button onClick={() => generateInvoice.mutate({ invoice_date: new Date().toISOString().slice(0, 10), due_date: null, ewt_enabled: false, ewt_rate: 0.02, lines: lines.map((line) => ({ job_order_line_item_id: line.id, quantity: Number(line.quantity) })) })} disabled={generateInvoice.isPending}>Convert to invoice</Button>
              <span className="text-xs text-muted-foreground">Use the completed JO to prepare the invoice.</span>
            </div>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="More Job Order actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild><Link to="/jobs/$id/job-order/print" params={{ id }} search={{ fromInvoiceId: undefined }}><Printer className="mr-2 h-4 w-4" />Print Job Order</Link></DropdownMenuItem>
              {canJobWork && job.status !== "completed" && !existingInv ? <DropdownMenuItem onSelect={() => setCorrectionOpen(true)}><Pencil className="mr-2 h-4 w-4" />Edit Job Order</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
          {canJobWork && job.status !== "completed" && !existingInv ? <Dialog open={correctionOpen} onOpenChange={setCorrectionOpen}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>Edit Job Order</DialogTitle></DialogHeader><JobOrderCorrectionForm job={job} lines={lines} busy={correctBeforeCompletion.isPending} onCancel={() => setCorrectionOpen(false)} onSave={(payload, reason) => correctBeforeCompletion.mutate({ payload, reason })} /></DialogContent></Dialog> : null}
          {["ready", "delivered", "completed"].includes(job.status) ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Printer className="h-4 w-4" /> Print Delivery Receipt
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link
                    to="/jobs/$id/delivery-receipt/print"
                    params={{ id }}
                    search={{ priced: false }}
                  >
                    Without prices
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    to="/jobs/$id/delivery-receipt/print"
                    params={{ id }}
                    search={{ priced: true }}
                  >
                    With prices
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      <JobNextAction status={job.status} invoiceNumber={existingInv?.invoice_number} />

      <JobProgress status={job.status} />

      {!canJobWork && !canExpenseWork ? (
        <Alert>
          <AlertTitle>Job order is read-only for your role.</AlertTitle>
          <AlertDescription>
            You do not have permission to update jobs, add expenses, or generate invoices.
          </AlertDescription>
        </Alert>
      ) : null}
      {canJobWork && !canExpenseWork ? (
        <Alert>
          <AlertTitle>Accounting handles expenses and invoices.</AlertTitle>
          <AlertDescription>
            You can move the job through production and print the job order form. Accounting records
            expenses, payments, and invoices.
          </AlertDescription>
        </Alert>
      ) : null}
      {!canJobWork && canExpenseWork ? (
        <Alert>
          <AlertTitle>Job workflow is controlled by owner/admin staff.</AlertTitle>
          <AlertDescription>
            You can record expenses and generate invoices when the job is completed. Owner/admin
            staff move jobs through production statuses.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_repeat(3,minmax(8rem,0.65fr))] xl:items-end">
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">Profit</div>
            <div
              className={`mt-1 text-3xl font-semibold tabular-nums ${
                profit >= 0 ? "text-success" : "text-destructive"
              }`}
            >
              {peso(profit)}
            </div>
          </div>
          <DetailRow label="Revenue quoted" value={peso(displayRevenue)} />
          <DetailRow label="Expenses" value={peso(totalExp)} />
          <DetailRow label="Margin" value={`${margin.toFixed(1)}%`} />
        </div>
      </Card>

      <Card className="p-4">
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(18rem,0.9fr)_minmax(18rem,0.9fr)]">
          <section>
            <h2 className="text-sm font-semibold">Source details</h2>
            <div className="mt-3 space-y-2">
              <DetailRow label="Job number" value={job.job_number} />
              <DetailRow
                label="Source quote"
                value={(job.quotation as { quote_number: string } | null)?.quote_number ?? "-"}
              />
              <DetailRow
                label="Tax mode"
                value={job.tax_type === "vatable" ? "VATable" : "Non-VAT"}
              />
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Production status</h2>
              {canJobWork ? (<>
                <Dialog open={jobFormOpen} onOpenChange={setJobFormOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline">
                      <Pencil className="h-4 w-4" /> Edit details
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Print details for Job Order form</DialogTitle>
                    </DialogHeader>
                    <JobFormDetailsForm
                      job={{
                        target_completion_date: job.target_completion_date,
                        client_po_number: job.client_po_number,
                        project_manager: job.project_manager,
                        approved_by_name: job.approved_by_name,
                        dr_number: job.dr_number,
                        installation_date: job.installation_date,
                      }}
                      busy={updateJobFormDetails.isPending}
                      onSubmit={(values) => updateJobFormDetails.mutate(values)}
                    />
                  </DialogContent>
                </Dialog>
              </>) : null}
            </div>
            <div className="mt-3 space-y-2">
              <DetailRow label="Current status" value={job.status.replaceAll("_", " ")} />
              <DetailRow
                label="Invoice"
                value={existingInv ? existingInv.invoice_number : "Not generated"}
              />
              <DetailRow label="Date requested" value={fmtDate(job.target_completion_date)} />
              <DetailRow label="Job In-charge" value={job.project_manager ?? "-"} />
              <DetailRow label="Approved by" value={job.approved_by_name ?? "-"} />
              {job.client_po_number || job.dr_number || job.installation_date ? (
                <>
                  <div className="pt-2 text-xs font-medium uppercase text-muted-foreground">
                    Optional print references
                  </div>
                  <DetailRow label="Client PO" value={job.client_po_number ?? "-"} />
                  <DetailRow label="DR no." value={job.dr_number ?? "-"} />
                  <DetailRow label="Installation date" value={fmtDate(job.installation_date)} />
                </>
              ) : null}
            </div>
          </section>
        </div>
      </Card>

      <Card>
        <div className="p-4 border-b">
          <h2 className="font-semibold">Line items</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Pricing and tax mode are copied from the approved quotation.
          </p>
        </div>
        <div className="max-h-[24rem] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Sheets</TableHead>
                <TableHead className="text-right">Line total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.filter((line) => line.description !== "[BLANK_LINE]").length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No quotation line items were copied to this job.
                  </TableCell>
                </TableRow>
              ) : null}
              {lines
                .filter((line) => line.description !== "[BLANK_LINE]")
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <div className="font-medium">{line.description}</div>
                      {line.pricing_mode === "sqft" ? (
                        <div className="text-xs text-muted-foreground">
                          {line.width} x {line.height} {line.unit_of_measure} ={" "}
                          {Number(line.computed_sqft ?? 0).toFixed(2)} sq ft @{" "}
                          {peso(line.rate_per_sqft)}/sq ft
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="capitalize text-sm">
                      {(line as any).pricing_basis === "per_sheet" ? "Per sheet" : line.pricing_mode === "sqft" ? "Sq ft" : "Fixed"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(line.quantity)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {peso(line.unit_price)}
                    </TableCell>
                    <TableCell className="text-right">
                      {(line as any).pricing_basis === "per_sheet" ? (
                        <div className="flex min-w-[10rem] flex-col items-end gap-1 text-xs">
                          <span className="text-muted-foreground">Plan: {Number((line as any).planned_sheets ?? 0).toLocaleString()}</span>
                          <Input
                            aria-label={`Actual sheets for ${line.description}`}
                            className="h-8 w-28 text-right"
                            type="number"
                            min="0"
                            defaultValue={(line as any).actual_sheets ?? ""}
                            placeholder="Actual"
                            disabled={!canJobWork || updateSheetUsage.isPending}
                            onBlur={(event) => {
                              const value = event.currentTarget.value.trim();
                              updateSheetUsage.mutate({ lineId: line.id, actualSheets: value === "" ? null : Number(value) });
                            }}
                          />
                        </div>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {peso(line.line_total)}
                    </TableCell>
                  </TableRow>
                ))}
              {lines.filter((line) => line.description !== "[BLANK_LINE]").length > 0 && job.tax_type === "vatable" ? (
                <>
                  <TableRow>
                    <TableCell colSpan={4} className="text-right font-medium">
                      VATable sales
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {peso(lineSubtotal)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={4} className="text-right font-medium">
                      VAT 12%
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {peso(jobVat.vat)}
                    </TableCell>
                  </TableRow>
                </>
              ) : null}
              {lines.length > 0 ? (
                <TableRow className="bg-muted/30">
                  <TableCell colSpan={4} className="text-right font-semibold">
                    Total
                  </TableCell>
                  <TableCell className="text-right text-lg font-semibold tabular-nums">
                    {peso(displayRevenue)}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </Card>

      {false && <Card>
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="font-semibold">Financial expenses</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Record costs and payables here. Material planning, stock, and actual consumption
              are recorded in the Production workspace.
            </p>
          </div>
          {canExpenseWork ? (
            <Dialog open={expOpen} onOpenChange={setExpOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4" /> Add expense
                </Button>
              </DialogTrigger>
              <DialogContent className={EXPENSE_DIALOG_CLASS}>
                <DialogHeader>
                  <DialogTitle>Add expense</DialogTitle>
                </DialogHeader>
                <ExpenseForm
                  supplierOptions={supplierOptions}
                  onSubmit={(v) => addExpense.mutate(v)}
                  busy={addExpense.isPending}
                  submitLabel="Add expense"
                />
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
        <div className="max-h-[28rem] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Supplier / Payee</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No expenses recorded
                  </TableCell>
                </TableRow>
              ) : (
                expenses.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmtDate(e.expense_date)}
                    </TableCell>
                    <TableCell className="capitalize">{e.expense_type}</TableCell>
                    <TableCell>{e.supplier_name || "-"}</TableCell>
                    <TableCell>
                      <div>{e.description}</div>
                      {e.expense_type === "materials" && e.quantity && e.unit_cost ? (
                        <div className="text-xs text-muted-foreground">
                          Qty: {Number(e.quantity)} {e.unit_of_measure || "unit"} | Unit cost:{" "}
                          {peso(e.unit_cost)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={e.payment_status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmtDate(e.due_date)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{peso(e.amount)}</TableCell>
                    <TableCell className="w-[14rem]">
                      <div className="flex justify-end gap-1">
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground"
                          aria-label="Print check voucher"
                          title="Print check voucher"
                        >
                          <Link
                            to="/expenses/$id/check-voucher/print"
                            params={{ id: e.id }}
                            search={{ from: "job", jobId: id, tab: "expenses" }}
                          >
                            <Receipt className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground"
                          aria-label="Print check"
                          title="Print check"
                        >
                          <Link
                            to="/expenses/$id/check/print"
                            params={{ id: e.id }}
                            search={{ from: "job", jobId: id, tab: "expenses" }}
                          >
                            <Printer className="h-4 w-4" />
                          </Link>
                        </Button>
                        {canExpenseWork ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 px-2 text-xs"
                            disabled={updateExpensePayment.isPending}
                            onClick={() => {
                              if (e.payment_status === "paid") {
                                updateExpensePayment.mutate({
                                  expenseId: e.id,
                                  payment_status: "pending",
                                });
                                return;
                              }
                              setPayingExpense({
                                id: e.id,
                                supplier_name: e.supplier_name,
                                amount: Number(e.amount || 0),
                                paid_at: e.paid_at,
                                reference_no: e.reference_no,
                                supplier_document_no: e.supplier_document_no,
                                check_number: e.check_number,
                              });
                            }}
                          >
                            {e.payment_status === "paid" ? "Reopen" : "Pay"}
                          </Button>
                        ) : null}
                        {canExpenseWork ? (
                          <Dialog
                            open={editExpenseId === e.id}
                            onOpenChange={(open) => setEditExpenseId(open ? e.id : null)}
                          >
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground"
                                aria-label="Edit expense"
                                title="Edit expense"
                                onClick={() => setEditExpenseId(e.id)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className={EXPENSE_DIALOG_CLASS}>
                              <DialogHeader>
                                <DialogTitle>Edit material / expense</DialogTitle>
                              </DialogHeader>
                              <ExpenseForm
                                initial={e}
                                supplierOptions={supplierOptions}
                                submitLabel="Update record"
                                busy={updateExpense.isPending}
                                onSubmit={(values) =>
                                  updateExpense.mutate({ expenseId: e.id, values })
                                }
                              />
                            </DialogContent>
                          </Dialog>
                        ) : null}
                        {canDeleteExpense ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label="Delete expense"
                            title="Delete expense"
                            onClick={() => deleteExp.mutate(e.id)}
                            disabled={deleteExp.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
              {expenses.length > 0 && (
                <TableRow className="bg-muted/30">
                  <TableCell colSpan={6} className="text-right font-semibold">
                    Total
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {peso(totalExp)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>}

      {job.internal_notes && (
        <Card className="p-4">
          <div className="text-xs text-muted-foreground mb-1">Internal notes</div>
          <div className="text-sm whitespace-pre-wrap">{job.internal_notes}</div>
        </Card>
      )}
      <Dialog open={!!payingExpense} onOpenChange={(open) => !open && setPayingExpense(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark expense paid</DialogTitle>
          </DialogHeader>
          {payingExpense ? (
            <JobExpensePaymentForm
              expense={payingExpense}
              busy={updateExpensePayment.isPending}
              onSubmit={(values) =>
                updateExpensePayment.mutate({
                  expenseId: payingExpense.id,
                  payment_status: "paid",
                  ...values,
                })
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type JobExpensePaymentTarget = {
  id: string;
  supplier_name: string | null;
  amount: number;
  paid_at: string | null;
  reference_no: string | null;
  supplier_document_no: string | null;
  check_number: string | null;
};

type JobExpensePaymentValues = {
  paid_date: string;
  reference_no: string;
  supplier_document_no: string;
  check_number: string;
};

function JobExpensePaymentForm({
  expense,
  onSubmit,
  busy,
}: {
  expense: JobExpensePaymentTarget;
  onSubmit: (values: JobExpensePaymentValues) => void;
  busy?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    paid_date: expense.paid_at ? expense.paid_at.slice(0, 10) : today,
    reference_no: expense.reference_no ?? "",
    supplier_document_no: expense.supplier_document_no ?? "",
    check_number: expense.check_number ?? "",
  });

  function submit() {
    if (!f.paid_date) return toast.error("Payment date is required");
    if (f.paid_date > today) return toast.error("Future payment dates are not allowed");
    if (!f.check_number.trim()) return toast.error("Check number is required");
    onSubmit(f);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <div className="text-muted-foreground">Payee</div>
        <div className="font-medium">{expense.supplier_name || "Missing payee"}</div>
        <div className="mt-2 text-muted-foreground">Amount</div>
        <div className="font-medium tabular-nums">{peso(expense.amount)}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>
            Payment Date <RequiredMark />
          </Label>
          <Input
            type="date"
            required
            max={today}
            value={f.paid_date}
            onChange={(e) => setF({ ...f, paid_date: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>
            Check No. <RequiredMark />
          </Label>
          <Input
            required
            value={f.check_number}
            onChange={(e) => setF({ ...f, check_number: e.target.value })}
            placeholder="e.g. 0001453178"
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>DR / Invoice No.</Label>
          <Input
            value={f.supplier_document_no}
            onChange={(e) => setF({ ...f, supplier_document_no: e.target.value })}
            placeholder="e.g. 57027"
          />
        </div>
        <div className="space-y-2">
          <Label>Voucher / Ref No.</Label>
          <Input
            value={f.reference_no}
            onChange={(e) => setF({ ...f, reference_no: e.target.value })}
            placeholder="e.g. 022408"
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving..." : "Mark paid"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function JobNextAction({ status, invoiceNumber }: { status: string; invoiceNumber?: string }) {
  if (invoiceNumber) {
    return (
      <Alert>
        <AlertTitle>Invoice Generated</AlertTitle>
        <AlertDescription>
          This job already generated invoice {invoiceNumber}. Continue payment tracking from the
          invoice.
        </AlertDescription>
      </Alert>
    );
  }
  if (status === "completed") {
    return (
      <Alert>
        <AlertTitle>Job Completed</AlertTitle>
        <AlertDescription>
          Production workflow is finished. Convert this Job Order to an invoice when accounting is ready.
        </AlertDescription>
      </Alert>
    );
  }
  if (status === "delivered") {
    return (
      <Alert>
        <AlertTitle>Next Step: Complete Job</AlertTitle>
        <AlertDescription>
          Delivered means the job was released to the customer. Complete the job only when admin and
          billing handoff are also wrapped.
        </AlertDescription>
      </Alert>
    );
  }
  if (status === "pending") {
    return (
      <Alert>
        <AlertTitle>Next Step: Prepare Production</AlertTitle>
        <AlertDescription>
          Open Production materials to select the BOM, check stock, and release this Job Order for
          production.
        </AlertDescription>
      </Alert>
    );
  }
  const action = JOB_ACTION[status as keyof typeof JOB_ACTION];
  return (
    <Alert>
      <AlertTitle>Next Step: {action?.label ?? "Review Job"}</AlertTitle>
      <AlertDescription>
        Complete this step before accounting can generate the invoice.
      </AlertDescription>
    </Alert>
  );
}

function JobProgress({ status }: { status: string }) {
  const current = JOB_FLOW.indexOf(status as (typeof JOB_FLOW)[number]);
  return (
    <Card className="p-4">
      <WorkflowStepper steps={JOB_FLOW.map((step, index) => ({
        label: JOB_LABEL[step],
        state: index < current ? "done" : index === current ? "current" : "waiting",
      }))} />
    </Card>
  );
}

function InvoiceForm({
  lines,
  onSubmit,
  busy,
}: {
  lines: Array<{ id: string; description: string; quantity: number; unit_of_measure?: string | null; line_total: number }>;
  onSubmit: (v: {
    invoice_date: string;
    due_date: string | null;
    ewt_enabled: boolean;
    ewt_rate: number;
    lines: Array<{ job_order_line_item_id: string; quantity: number }>;
  }) => void;
  busy?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    invoice_date: today,
    due_date: "",
  });
  const [selected, setSelected] = useState<Record<string, number>>(
    Object.fromEntries(lines.map((line) => [line.id, Number(line.quantity)])),
  );

  function submit() {
    if (!f.invoice_date) return toast.error("Invoice date is required");
    if (f.due_date && f.due_date < f.invoice_date) {
      return toast.error("Due date cannot be before the invoice date");
    }
    const invoiceLines = Object.entries(selected)
      .filter(([, quantity]) => Number(quantity) > 0)
      .map(([job_order_line_item_id, quantity]) => ({
        job_order_line_item_id,
        quantity: Number(quantity),
      }));
    if (invoiceLines.length === 0) return toast.error("Select at least one invoice line");
    onSubmit({
      invoice_date: f.invoice_date,
      due_date: f.due_date || null,
      ewt_enabled: false,
      ewt_rate: 0.02,
      lines: invoiceLines,
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      <div className="rounded-md border bg-muted/25 p-3 text-sm text-muted-foreground">
        This creates a customer invoice from this Job Order. Select what is being billed now; remaining quantities can be invoiced later.
      </div>
      <div className="space-y-2 rounded-md border p-3">
        <Label>Customer items to bill</Label>
        {lines.map((line) => (
          <label key={line.id} className="flex items-center gap-3 border-t py-2 text-sm">
            <input
              type="checkbox"
              checked={Number(selected[line.id] ?? 0) > 0}
              onChange={(event) =>
                setSelected({ ...selected, [line.id]: event.target.checked ? Number(line.quantity) : 0 })
              }
            />
            <span className="min-w-0 flex-1 truncate">{line.description}</span>
            <Input
              className="h-8 w-24"
              type="number"
              min="0"
              max={line.quantity}
              step="0.01"
              value={selected[line.id] ?? 0}
              onChange={(event) => setSelected({ ...selected, [line.id]: Number(event.target.value) })}
            />
            <span className="text-muted-foreground">of {line.quantity}</span>
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>
            Invoice Date <RequiredMark />
          </Label>
          <Input
            type="date"
            required
            value={f.invoice_date}
            onChange={(e) => setF({ ...f, invoice_date: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Due Date</Label>
          <Input
            type="date"
            min={f.invoice_date}
            value={f.due_date}
            onChange={(e) => setF({ ...f, due_date: e.target.value })}
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? "Creating..." : "Create invoice"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function JobFormDetailsForm({
  job,
  onSubmit,
  busy,
}: {
  job: {
    target_completion_date: string | null;
    client_po_number: string | null;
    project_manager: string | null;
    approved_by_name: string | null;
    dr_number: string | null;
    installation_date: string | null;
  };
  onSubmit: (values: {
    target_completion_date: string;
    client_po_number: string;
    project_manager: string;
    approved_by_name: string;
    dr_number: string;
    installation_date: string;
  }) => void;
  busy?: boolean;
}) {
  const [f, setF] = useState({
    target_completion_date: job.target_completion_date ?? "",
    client_po_number: job.client_po_number ?? "",
    project_manager: job.project_manager ?? "",
    approved_by_name: job.approved_by_name ?? "",
    dr_number: job.dr_number ?? "",
    installation_date: job.installation_date ?? "",
  });
  const [showOptionalReferences, setShowOptionalReferences] = useState(
    Boolean(job.client_po_number || job.dr_number || job.installation_date),
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(f);
      }}
      className="space-y-4"
    >
      <div className="rounded-md border bg-muted/25 p-3 text-sm text-muted-foreground">
        Date Requested and Job In-charge are needed before production. Optional reference numbers
        can be filled later.
      </div>
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Production handoff</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>
              Date Requested <RequiredMark />
            </Label>
            <Input
              type="date"
              required
              value={f.target_completion_date}
              onChange={(e) => setF({ ...f, target_completion_date: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>
              Job In-charge <RequiredMark />
            </Label>
            <Input
              required
              value={f.project_manager}
              onChange={(e) => setF({ ...f, project_manager: e.target.value })}
              placeholder="Person in charge of this job"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>
              Approved By <RequiredMark />
            </Label>
            <Select
              value={f.approved_by_name}
              onValueChange={(value) => setF({ ...f, approved_by_name: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select approver" />
              </SelectTrigger>
              <SelectContent>
                {JO_APPROVER_OPTIONS.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>
      <Collapsible open={showOptionalReferences} onOpenChange={setShowOptionalReferences}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            {showOptionalReferences
              ? "Hide optional print references"
              : "Add optional print references"}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <section className="space-y-3 rounded-md border p-3">
            <h3 className="text-sm font-medium">Optional print references</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Client PO No.</Label>
                <Input
                  value={f.client_po_number}
                  onChange={(e) => setF({ ...f, client_po_number: e.target.value })}
                  placeholder="Client PO number"
                />
                <p className="text-xs text-muted-foreground">
                  Use if the client already provided a PO.
                </p>
              </div>
              <div className="space-y-2">
                <Label>DR No.</Label>
                <Input
                  value={f.dr_number}
                  onChange={(e) => setF({ ...f, dr_number: e.target.value })}
                  placeholder="DR number"
                />
                <p className="text-xs text-muted-foreground">
                  Fill once the delivery receipt number is assigned.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Installation Date</Label>
              <Input
                type="date"
                value={f.installation_date}
                onChange={(e) => setF({ ...f, installation_date: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Use only if installation is part of the job.
              </p>
            </div>
          </section>
        </CollapsibleContent>
      </Collapsible>
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving..." : "Save print details"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ExpenseForm({
  onSubmit,
  busy,
  initial,
  supplierOptions = [],
  submitLabel = "Add expense",
}: {
  onSubmit: (v: {
    expense_date: string;
    expense_type: string;
    supplier_name: string;
    description: string;
    quantity: number | null;
    unit_of_measure: string;
    unit_cost: number | null;
    amount: number;
    payment_status: "pending" | "paid";
    paid_date: string;
    due_date: string;
    reference_no: string;
    supplier_document_no: string;
    check_number: string;
    remarks: string;
  }) => void;
  busy?: boolean;
  supplierOptions?: string[];
  initial?: {
    expense_date: string;
    expense_type: string;
    supplier_name: string | null;
    description: string;
    quantity: number | null;
    unit_of_measure: string | null;
    unit_cost: number | null;
    amount: number;
    payment_status: "pending" | "paid";
    paid_at: string | null;
    due_date: string | null;
    reference_no: string | null;
    supplier_document_no: string | null;
    check_number: string | null;
    remarks: string | null;
  };
  submitLabel?: string;
}) {
  const unitOptionsId = useId();
  const supplierOptionsId = useId();
  const descriptionOptionsId = useId();
  const [f, setF] = useState(() => expenseFormState(initial));
  const today = new Date().toISOString().slice(0, 10);
  const isMaterial = f.expense_type === "materials";
  const materialAmount = computeMaterialAmount(f.quantity, f.unit_cost);
  const shouldShowMoreDetails = Boolean(
    initial?.payment_status === "paid" ||
    initial?.due_date ||
    initial?.reference_no ||
    initial?.supplier_document_no ||
    initial?.check_number ||
    initial?.remarks,
  );
  const [showMoreDetails, setShowMoreDetails] = useState(shouldShowMoreDetails);

  useEffect(() => {
    setF(expenseFormState(initial));
    setShowMoreDetails(shouldShowMoreDetails);
  }, [initial, shouldShowMoreDetails]);

  function submit() {
    if (!f.expense_date) return toast.error("Expense date is required");
    if (f.expense_date > today) return toast.error("Future expense dates are not allowed");
    if (!f.expense_type) return toast.error("Expense type is required");
    if (!f.description.trim()) return toast.error("Description is required");
    if (f.due_date && f.due_date < f.expense_date) {
      return toast.error("Due date cannot be before the expense date");
    }
    const amount = isMaterial ? materialAmount : Number(f.amount);
    if (isMaterial && Number(f.quantity) <= 0)
      return toast.error("Quantity must be greater than zero");
    if (isMaterial && !f.unit_of_measure.trim()) return toast.error("Unit is required");
    if (isMaterial && Number(f.unit_cost) <= 0)
      return toast.error("Unit cost must be greater than zero");
    if (amount <= 0) return toast.error("Amount must be greater than zero");
    if (f.payment_status === "paid" && !f.check_number.trim()) {
      return toast.error("Check number is required when an expense is already paid");
    }
    if (f.payment_status === "paid" && !f.paid_date) {
      return toast.error("Payment date is required when an expense is already paid");
    }
    onSubmit({
      expense_date: f.expense_date,
      expense_type: f.expense_type,
      supplier_name: f.supplier_name,
      description: f.description.trim(),
      quantity: isMaterial ? Number(f.quantity) : null,
      unit_of_measure: isMaterial ? f.unit_of_measure : "",
      unit_cost: isMaterial ? Number(f.unit_cost) : null,
      amount,
      payment_status: f.payment_status as "pending" | "paid",
      paid_date: f.paid_date,
      due_date: f.due_date,
      reference_no: f.reference_no,
      supplier_document_no: f.supplier_document_no,
      check_number: f.check_number,
      remarks: f.remarks,
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>
            Expense Date <RequiredMark />
          </Label>
          <Input
            type="date"
            max={today}
            required
            value={f.expense_date}
            onChange={(e) => setF({ ...f, expense_date: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>
            Expense Type <RequiredMark />
          </Label>
          <Select
            value={f.expense_type}
            onValueChange={(v) =>
              setF({
                ...f,
                expense_type: v,
                quantity: v === "materials" ? f.quantity : "",
                unit_of_measure: v === "materials" ? f.unit_of_measure : "",
                unit_cost: v === "materials" ? f.unit_cost : "",
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="materials">Materials</SelectItem>
              <SelectItem value="labor">Labor</SelectItem>
              <SelectItem value="delivery">Delivery</SelectItem>
              <SelectItem value="installation">Installation</SelectItem>
              <SelectItem value="outsourcing">Outsourcing</SelectItem>
              <SelectItem value="miscellaneous">Miscellaneous</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Supplier / Payee</Label>
        <Input
          list={supplierOptions.length ? supplierOptionsId : undefined}
          value={f.supplier_name}
          onChange={(e) => setF({ ...f, supplier_name: e.target.value })}
          placeholder="Supplier or person paid"
        />
        {supplierOptions.length ? (
          <datalist id={supplierOptionsId}>
            {supplierOptions.map((supplier) => (
              <option key={supplier} value={supplier} />
            ))}
          </datalist>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label>
          Description <RequiredMark />
        </Label>
        <Input
          list={descriptionOptionsId}
          required
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          placeholder="Choose or type description"
        />
        <datalist id={descriptionOptionsId}>
          {EXPENSE_DESCRIPTION_OPTIONS.map((description) => (
            <option key={description} value={description} />
          ))}
        </datalist>
      </div>
      {isMaterial ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>
              Qty <RequiredMark />
            </Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={f.quantity}
              onChange={(e) => setF({ ...f, quantity: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>
              Unit <RequiredMark />
            </Label>
            <Input
              list={unitOptionsId}
              required
              value={f.unit_of_measure}
              onChange={(e) => setF({ ...f, unit_of_measure: e.target.value })}
              placeholder="Choose or type unit"
            />
            <datalist id={unitOptionsId}>
              {EXPENSE_UNIT_OPTIONS.map((unit) => (
                <option key={unit} value={unit} />
              ))}
            </datalist>
          </div>
          <div className="space-y-2">
            <Label>
              Unit Cost <RequiredMark />
            </Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={f.unit_cost}
              onChange={(e) => setF({ ...f, unit_cost: e.target.value })}
            />
          </div>
        </div>
      ) : null}
      <div className="space-y-2">
        <Label>
          {isMaterial ? "Computed Amount (PHP)" : "Amount (PHP)"} <RequiredMark />
        </Label>
        <Input
          type="number"
          step="0.01"
          min="0.01"
          required
          readOnly={isMaterial}
          value={isMaterial ? materialAmount.toFixed(2) : f.amount}
          onChange={(e) => setF({ ...f, amount: e.target.value })}
        />
        {isMaterial ? (
          <p className="text-xs text-muted-foreground">Calculated from Qty x Unit Cost.</p>
        ) : null}
      </div>
      <Collapsible open={showMoreDetails} onOpenChange={setShowMoreDetails}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="outline">
            {showMoreDetails ? "Hide optional details" : "More details"}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <div className="space-y-4 rounded-md border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  Payment Status <RequiredMark />
                </Label>
                <Select
                  value={f.payment_status}
                  onValueChange={(v) => setF({ ...f, payment_status: v as "pending" | "paid" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {f.payment_status === "paid" ? (
                <div className="space-y-2">
                  <Label>
                    Payment Date <RequiredMark />
                  </Label>
                  <Input
                    type="date"
                    required
                    max={today}
                    value={f.paid_date}
                    onChange={(e) => setF({ ...f, paid_date: e.target.value })}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Due Date</Label>
                  <Input
                    type="date"
                    min={f.expense_date}
                    value={f.due_date}
                    onChange={(e) => setF({ ...f, due_date: e.target.value })}
                  />
                </div>
              )}
              {f.payment_status === "paid" ? (
                <div className="space-y-2">
                  <Label>
                    Check No. <RequiredMark />
                  </Label>
                  <Input
                    required
                    value={f.check_number}
                    onChange={(e) => setF({ ...f, check_number: e.target.value })}
                  />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>Voucher / Ref No.</Label>
                <Input
                  value={f.reference_no}
                  onChange={(e) => setF({ ...f, reference_no: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>DR / Invoice No.</Label>
                <Input
                  value={f.supplier_document_no}
                  onChange={(e) => setF({ ...f, supplier_document_no: e.target.value })}
                  placeholder="Supplier document number"
                />
              </div>
            </div>
            {f.payment_status === "paid" ? (
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  min={f.expense_date}
                  value={f.due_date}
                  onChange={(e) => setF({ ...f, due_date: e.target.value })}
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>Remarks</Label>
              <Textarea
                rows={3}
                className="min-h-24 resize-y overflow-hidden"
                value={f.remarks}
                onChange={(e) => setF({ ...f, remarks: e.target.value })}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving..." : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden="true">
      *
    </span>
  );
}
