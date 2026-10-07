import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { peso, fmtDate, fmtDateTime, paymentDateToIso } from "@/lib/format";
import {
  computeMaterialAmount,
  computeQuoteDisplayTotal,
  daysOutstanding,
  receivableStatus,
} from "@/lib/calc";
import {
  AccessDenied,
  EmptyState,
  LoadingRow,
  StatusPill as StatusBadge,
} from "@/components/system";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Download,
  FileX2,
  FileCheck2,
  FileText,
  Lightbulb,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Truck,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { canManageMoneyOut, canViewFullReports, canViewMoneyWork } from "@/lib/roles";
import { toast } from "sonner";

const paymentTermPresets = [
  "COD",
  "30 days",
  "50% downpayment, balance upon completion",
  "Full payment upon completion",
];
import {
  DISBURSEMENT_CATEGORIES,
  DISBURSEMENT_SUBCATEGORIES,
  categoryLabel,
  subcategoryLabel,
  type DisbursementCategory,
  type DisbursementSubcategory,
} from "@/lib/financeCategories";
import {
  buildCashSalesWorkbookBlob,
  buildDisbursementWorkbookBlob,
  buildPettyCashWorkbookBlob,
} from "@/lib/excelExport";
import {
  parsePendingExpenseFile,
  pendingExpenseTemplateCsv,
  rejectedExpenseCsv,
  type PendingExpenseImportRow,
} from "@/lib/pendingExpenseImport";
import {
  getVoucherChanges,
  requiresVoucherCorrectionReason,
  type VoucherFields,
} from "@/lib/checkVoucherRevision";
import { buildProjectExpenseRows, summarizeProjectProfitability } from "@/lib/projectExpenseRows";

export const Route = createFileRoute("/_app/reports")({
  head: () => ({ meta: [{ title: "Reports — AutoMate PH" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    tab: isReportTab(search.tab) ? search.tab : "pnl",
    focus: search.focus === "pending-expenses" ? "pending-expenses" : undefined,
  }),
  component: Reports,
});

const REPORT_VERSION = "v4-petty-cash-funding";
const REPORT_TABS = [
  "pnl",
  "disbursements",
  "cash-sales",
  "profit",
  "monitoring",
  "quotes",
  "invoices",
  "receivables",
  "payables",
  "petty-cash",
] as const;
type ReportTab = (typeof REPORT_TABS)[number];
const REPORT_PANEL_CLASS = "report-panel mt-0";
const EXPENSE_DIALOG_CLASS = "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl";
const DELIVERY_PROVIDERS = [
  "Transportify",
  "Lalamove",
  "InDrive",
  "Grab",
  "Truck contractor",
] as const;
const REPORT_TAB_CLASS =
  "min-h-10 rounded-lg px-3 text-sm transition-[background-color,color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] data-[state=active]:shadow-sm";
const REPORT_GROUPS = [
  {
    label: "Profit",
    tabs: [
      ["pnl", "Monthly Profit"],
      ["profit", "Project Profitability"],
    ],
  },
  {
    label: "Operations",
    tabs: [
      ["monitoring", "Project Monitoring"],
      ["quotes", "Quote History"],
      ["invoices", "Invoice Report"],
    ],
  },
  {
    label: "Money In",
    tabs: [
      ["receivables", "Receivables"],
      ["cash-sales", "Cash sales"],
    ],
  },
  {
    label: "Money Out",
    tabs: [
      ["payables", "General Expenses"],
      ["disbursements", "Check Disbursements"],
      ["petty-cash", "Petty cash"],
    ],
  },
] as const satisfies ReadonlyArray<{
  label: string;
  tabs: ReadonlyArray<readonly [ReportTab, string]>;
}>;
const REPORT_DESCRIPTIONS: Record<ReportTab, string> = {
  pnl: "Check revenue, expenses, and net profit for the selected date range.",
  profit: "Compare job revenue, expenses, profit, and margin.",
  monitoring: "Review quote, job, invoice, payment, and expense progress by project.",
  quotes: "Review quotation history and customer approval status.",
  invoices: "Review generated invoices, payment status, and balances.",
  receivables: "Follow up unpaid invoices and customer balances.",
  "cash-sales": "Review paid cash sales imported from the financial records.",
  payables: "Record company-wide and bulk expenses such as materials, utilities, and bills.",
  "petty-cash": "Track cash advances, receipts, and one final CV.",
  disbursements: "Review expenses paid by check and print their voucher or check documents.",
};

function Reports() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { tab: requestedReport, focus } = Route.useSearch();
  const { role } = useAuth();
  const canViewReports = canViewFullReports(role) || canViewMoneyWork(role);
  const isAdminScope = canViewFullReports(role);
  const visibleReportGroups = isAdminScope
    ? REPORT_GROUPS
    : REPORT_GROUPS.filter((group) => group.label === "Money In" || group.label === "Money Out");
  const visibleTabs = new Set(
    visibleReportGroups.flatMap((group) => group.tabs.map(([tab]) => tab)),
  );
  const activeReport = visibleTabs.has(requestedReport)
    ? requestedReport
    : visibleReportGroups[0].tabs[0][0];
  const activeGroup =
    visibleReportGroups.find((group) => group.tabs.some(([tab]) => tab === activeReport)) ??
    visibleReportGroups[0];
  const activeReportTitle =
    activeGroup.tabs.find(([tab]) => tab === activeReport)?.[1] ?? activeGroup.tabs[0][1];
  const activeReportDescription = REPORT_DESCRIPTIONS[activeReport];
  const canWrite = canManageMoneyOut(role);
  const canConfirmProjectCosts = role === "owner" || role === "admin";
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseImportOpen, setExpenseImportOpen] = useState(false);
  const [expenseImportContext, setExpenseImportContext] = useState<"expenses" | "petty-cash">(
    "expenses",
  );
  const [expenseImportRows, setExpenseImportRows] = useState<PendingExpenseImportRow[]>([]);
  const [expenseImportBusy, setExpenseImportBusy] = useState(false);
  const [pettyCashAttachmentBusy, setPettyCashAttachmentBusy] = useState(false);
  const [includePossibleDuplicates, setIncludePossibleDuplicates] = useState(false);
  const [expenseImportBatchId, setExpenseImportBatchId] = useState("none");
  const [cashSaleOpen, setCashSaleOpen] = useState(false);
  const [payingPayable, setPayingPayable] = useState<PayablePaymentTarget | null>(null);
  const [editingExpense, setEditingExpense] = useState<PendingExpenseEditTarget | null>(null);
  const [allocationExpense, setAllocationExpense] = useState<any | null>(null);
  const [reportSearch, setReportSearch] = useState("");
  const [profitabilityFilter, setProfitabilityFilter] = useState<
    "all" | "with-costs" | "no-costs" | "profitable" | "loss"
  >("all");
  const [pettyCashSearchScope, setPettyCashSearchScope] = useState<
    "all" | "number" | "job" | "project" | "transaction"
  >("all");
  const [pettyCashStatusFilter, setPettyCashStatusFilter] = useState("all");
  const [editingVoucher, setEditingVoucher] = useState<VoucherEditTarget | null>(null);
  const [pendingExpenseGroup, setPendingExpenseGroup] = useState<
    "all" | "needs-allocation" | "needs-payment"
  >("all");
  const [pettyCashOpen, setPettyCashOpen] = useState(false);
  const [editingPettyCashBatch, setEditingPettyCashBatch] = useState<any | null>(null);
  const [pettyCashForm, setPettyCashForm] = useState({
    custodian_name: "",
    cash_received: "",
    funding_date: dateInputValue(new Date()),
    funding_source: "BDO",
    funding_reference: "",
    job_order_id: "",
  });
  const [pettyCashCustomFundingSource, setPettyCashCustomFundingSource] = useState("");
  const [pettyCashCvBatch, setPettyCashCvBatch] = useState<{
    id: string;
    cash_received: number;
    receipts_total: number;
    receipt_count: number;
  } | null>(null);
  const [pettyCashCvReference, setPettyCashCvReference] = useState("");
  const [pettyCashSettlementBatch, setPettyCashSettlementBatch] = useState<any | null>(null);
  const [pettyCashSettlementForm, setPettyCashSettlementForm] = useState({
    cash_returned_amount: "",
    cash_returned_reference: "",
  });
  const [pettyCashDetailsBatch, setPettyCashDetailsBatch] = useState<any | null>(null);
  const [pettyCashAttachmentToRemove, setPettyCashAttachmentToRemove] = useState<{ batch: any; attachment: any } | null>(null);
  const [pettyCashReceiptBatch, setPettyCashReceiptBatch] = useState<any | null>(null);
  const [pettyCashFundingBatch, setPettyCashFundingBatch] = useState<any | null>(null);
  const [pettyCashFundingForm, setPettyCashFundingForm] = useState({
    amount: "",
    funding_date: dateInputValue(new Date()),
    funding_source: "",
    funding_reference: "",
  });
  const [profitabilityDetail, setProfitabilityDetail] = useState<any | null>(null);
  const now = new Date();
  const today = dateInputValue(now);
  const firstDay = dateInputValue(new Date(now.getFullYear(), 0, 1));
  const matchesReportSearch = useCallback(
    (...values: unknown[]) => {
      const terms = reportSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (terms.length === 0) return true;

      const searchableText = values
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ")
        .replace(/[^a-z0-9₱.]+/g, " ");

      return terms.every((term) => searchableText.includes(term));
    },
    [reportSearch],
  );
  const matchesPettyCashSearch = useCallback(
    (batch: any) => {
      const terms = reportSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (terms.length === 0) return true;
      const receipts = Array.isArray(batch.receipts) ? batch.receipts : [];
      const jobText = [
        batch.job_order?.job_number,
        ...receipts.flatMap((receipt: any) => [
          receipt.job_order?.job_number,
          ...(receipt.allocations ?? []).map((allocation: any) => allocation.job_order?.job_number),
        ]),
      ].join(" ");
      const projectText = [
        batch.job_order?.project_name,
        ...receipts.flatMap((receipt: any) => [
          receipt.job_order?.project_name,
          ...(receipt.allocations ?? []).map(
            (allocation: any) => allocation.job_order?.project_name,
          ),
        ]),
      ].join(" ");
      const transactionText = receipts
        .flatMap((receipt: any) => [
          receipt.description,
          receipt.supplier_name,
          receipt.disbursement_category,
          receipt.disbursement_subcategory,
          receipt.payment_source,
          receipt.payment_method,
          receipt.reference_no,
          receipt.supplier_document_no,
        ])
        .join(" ");
      const values = {
        number: batch.petty_cash_number,
        job: jobText,
        project: projectText,
        transaction: transactionText,
        all: [
          batch.petty_cash_number,
          batch.custodian_name,
          batch.funding_source,
          batch.funding_reference,
          batch.status,
          jobText,
          projectText,
          transactionText,
        ].join(" "),
      };
      const searchableText = values[pettyCashSearchScope]
        .toLowerCase()
        .replace(/[^a-z0-9₱.]+/g, " ");
      return terms.every((term) => searchableText.includes(term.replace(/[^a-z0-9₱.]+/g, " ")));
    },
    [pettyCashSearchScope, reportSearch],
  );
  useEffect(() => {
    setReportSearch("");
  }, [activeReport]);
  const [dateFrom, setDateFrom] = useState(firstDay);
  const [dateTo, setDateTo] = useState(today);
  const [dateRangePreset, setDateRangePreset] = useState("year-to-date");

  const applyDateRangePreset = (preset: string) => {
    const current = new Date();
    const end = dateInputValue(current);
    let start = firstDay;

    if (preset === "this-month") {
      start = dateInputValue(new Date(current.getFullYear(), current.getMonth(), 1));
    } else if (preset === "last-month") {
      start = dateInputValue(new Date(current.getFullYear(), current.getMonth() - 1, 1));
      setDateTo(dateInputValue(new Date(current.getFullYear(), current.getMonth(), 0)));
    } else if (preset === "this-quarter") {
      start = dateInputValue(
        new Date(current.getFullYear(), Math.floor(current.getMonth() / 3) * 3, 1),
      );
    } else if (preset === "all-time") {
      start = "2000-01-01";
    }

    setDateFrom(start);
    if (preset !== "last-month") setDateTo(end);
    setDateRangePreset(preset);
  };
  const profit = useQuery({
    queryKey: ["report-profit", REPORT_VERSION, dateFrom, dateTo],
    retry: false,
    enabled: canViewReports,
    queryFn: async () => {
      const [
        { data: jobs, error: jobsError },
        { data: exps, error: expensesError },
        { data: allocations, error: allocationsError },
        { data: pettyBatches, error: pettyBatchesError },
        { data: pettyFundingEvents, error: pettyFundingEventsError },
      ] = await Promise.all([
        supabase
          .from("job_orders")
          .select(
            "id, job_number, project_name, quoted_amount, tax_type, target_completion_date, status, customer:customers(id, customer_name)",
          )
          .order("created_at", { ascending: false }),
        (supabase as any)
          .from("job_expenses")
          .select(
            "id, job_order_id, petty_cash_batch_id, project_cost_confirmed_at, created_at, expense_date, supplier_name, description, reference_no, supplier_document_no, payment_status, payment_method, payment_source, payment_source_reference, amount, expense_type, disbursement_category, disbursement_subcategory",
          ),
        (supabase as any)
          .from("job_expense_allocations")
          .select("job_expense_id, job_order_id, allocated_amount, confirmed_at"),
        (supabase as any).from("petty_cash_batches").select("id, job_order_id, cash_received"),
        (supabase as any).from("petty_cash_funding_events").select("petty_cash_batch_id, amount"),
      ]);
      if (jobsError) throw jobsError;
      if (expensesError) throw expensesError;
      if (allocationsError && allocationsError.code !== "42P01") throw allocationsError;
      if (pettyBatchesError) throw pettyBatchesError;
      if (pettyFundingEventsError) throw pettyFundingEventsError;
      const scopedExpenses = (exps ?? []).filter((expense: any) =>
        inDateRange(expense.expense_date, dateFrom, dateTo),
      );
      const scopedExpenseIds = new Set(scopedExpenses.map((expense: any) => expense.id));
      const scopedAllocations = (allocations ?? []).filter((allocation: any) =>
        scopedExpenseIds.has(allocation.job_expense_id),
      );
      const projectExpenseRows = buildProjectExpenseRows(scopedExpenses, scopedAllocations);
      const summaries = summarizeProjectProfitability(jobs ?? [], projectExpenseRows);
      const expensesById = new Map(scopedExpenses.map((expense: any) => [expense.id, expense]));
      return (jobs ?? []).map((job) => {
        const summary = summaries.find((item) => item.jobOrderId === job.id)!;
        const projectRows = projectExpenseRows.filter((row) => row.jobOrderId === job.id);
        const linkedBatches = (pettyBatches ?? []).filter(
          (batch: any) => batch.job_order_id === job.id,
        );
        const pettyCashReleased = linkedBatches.reduce(
          (total: number, batch: any) =>
            total +
            Number(batch.cash_received ?? 0) +
            (pettyFundingEvents ?? [])
              .filter((event: any) => event.petty_cash_batch_id === batch.id)
              .reduce((sum: number, event: any) => sum + Number(event.amount ?? 0), 0),
          0,
        );
        const pettyCashSpent = scopedExpenses
          .filter(
            (expense: any) =>
              expense.job_order_id === job.id && Boolean(expense.petty_cash_batch_id),
          )
          .reduce((total: number, expense: any) => total + Number(expense.amount ?? 0), 0);
        const expenseBreakdown = projectRows.reduce<Record<string, number>>((totals, row) => {
          totals[row.category] = (totals[row.category] ?? 0) + row.projectAmount;
          return totals;
        }, {});
        const paymentSourceBreakdown = projectRows.reduce<Record<string, number>>((totals, row) => {
          const expense: any = expensesById.get(row.expenseId);
          const source = expense?.payment_source || expense?.payment_method || "Unspecified";
          totals[source] = (totals[source] ?? 0) + row.projectAmount;
          return totals;
        }, {});
        const lastCostRecordedAt =
          projectRows
            .map((row) => (expensesById.get(row.expenseId) as any)?.created_at ?? null)
            .filter(Boolean)
            .sort((a, b) => String(b).localeCompare(String(a)))[0] ?? null;
        return {
          ...job,
          expenses: summary.totalCost,
          profit: summary.profit,
          margin: summary.marginPercent,
          pettyCashReleased,
          pettyCashSpent,
          pettyCashBalance: pettyCashReleased > 0 ? pettyCashReleased - pettyCashSpent : null,
          lastCostRecordedAt,
          expenseBreakdown,
          paymentSourceBreakdown,
          expenseTrail: projectRows
            .map((row) => {
              const expense: any = expensesById.get(row.expenseId);
              return {
                id: row.expenseId,
                date: expense?.expense_date ?? null,
                recordedAt: expense?.created_at ?? null,
                supplier: expense?.supplier_name ?? null,
                description: expense?.description ?? "Expense",
                reference: expense?.reference_no ?? null,
                document: expense?.supplier_document_no ?? null,
                paymentSource: expense?.payment_source ?? expense?.payment_method ?? null,
                paymentSourceReference: expense?.payment_source_reference ?? null,
                pettyCashBatchId: expense?.petty_cash_batch_id ?? null,
                category: row.category,
                amount: row.projectAmount,
                isShared: row.isShared,
              };
            })
            .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
        };
      });
    },
  });

  const quotes = useQuery({
    queryKey: ["report-quotes", REPORT_VERSION],
    retry: false,
    enabled: canViewReports,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotations")
        .select(
          "id, quote_number, project_name, subtotal, adjustment_amount, total_amount, tax_type, status, quote_date, customer:customers(id, customer_name)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const invoices = useQuery({
    queryKey: ["report-invoices", REPORT_VERSION],
    retry: false,
    enabled: canViewReports,
    queryFn: async () => {
      const { data: invoices, error } = await supabase
        .from("invoices")
        .select(
          "id, invoice_number, official_receipt_number, invoice_date, due_date, invoice_amount, amount_due_snapshot, tax_type, status, customer:customers(id, customer_name), job_order:job_orders(id, project_name)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;

      if (!invoices?.length) return [];

      const { data: payments, error: paymentsError } = await supabase
        .from("invoice_payments")
        .select("invoice_id, amount")
        .in(
          "invoice_id",
          invoices.map((invoice) => invoice.id),
        );
      if (paymentsError) throw paymentsError;

      const paymentMap = new Map<string, number>();
      (payments ?? []).forEach((payment) =>
        paymentMap.set(
          payment.invoice_id,
          (paymentMap.get(payment.invoice_id) ?? 0) + Number(payment.amount),
        ),
      );
      return (invoices ?? []).map((invoice) => ({
        ...invoice,
        amountPaid: paymentMap.get(invoice.id) ?? 0,
      }));
    },
  });

  const payables = useQuery({
    queryKey: ["report-payables", REPORT_VERSION],
    retry: false,
    enabled: canViewReports,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_expenses")
        .select(
          "id, general_expense_number, supplier_id, supplier_name, description, expense_date, expense_type, disbursement_category, disbursement_subcategory, quantity, unit_of_measure, unit_cost, job_order_id, project_cost_confirmed_at, petty_cash_batch_id, due_date, paid_at, amount, tax_amount, tax_type, payment_status, payment_state, payment_method, payment_source, payment_source_reference, reference_no, supplier_document_no, supplier_tin, supplier_address, check_date, check_number, remarks, voucher_printed_at, voucher_print_count, job_order:job_orders(job_number, project_name)",
        )
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      const rows: any[] = data ?? [];
      if (!rows.length) return rows;
      const { data: allocations, error: allocationError } = await (supabase as any)
        .from("job_expense_allocations")
        .select(
          "job_expense_id, job_order_id, allocated_amount, confirmed_at, job_order:job_orders(job_number, project_name)",
        )
        .in(
          "job_expense_id",
          rows.map((row: any) => row.id),
        );
      if (allocationError && allocationError.code !== "42P01") throw allocationError;
      return rows.map((row: any) => ({
        ...row,
        allocations: (allocations ?? []).filter(
          (allocation: any) => allocation.job_expense_id === row.id,
        ),
      }));
    },
  });

  const jobOrderLookup = useQuery({
    queryKey: ["expense-import-job-orders"],
    enabled: (expenseImportOpen || pettyCashOpen) && canViewReports,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_orders")
        .select("id, job_number, project_name, customer:customers(customer_name)")
        .order("job_number", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const pettyCashBatches = useQuery({
    queryKey: ["petty-cash-batches"],
    enabled: (activeReport === "petty-cash" || expenseImportOpen) && canViewReports,
    queryFn: async () => {
      const { data: batches, error } = await supabase
        .from("petty_cash_batches")
        .select("*, job_order:job_orders(job_number, project_name)")
        .order("funding_date", { ascending: false });
      if (error) throw error;
      const ids = (batches ?? []).map((batch) => batch.id);
      const [expenseResult, fundingResult, attachmentResult] = ids.length
        ? await Promise.all([
            (supabase as any)
              .from("job_expenses")
              .select(
                "id, petty_cash_batch_id, expense_date, expense_type, supplier_id, supplier_name, description, amount, disbursement_category, disbursement_subcategory, quantity, unit_of_measure, unit_cost, tax_amount, tax_type, payment_status, payment_method, payment_state, payment_source, payment_source_reference, due_date, reference_no, supplier_document_no, supplier_tin, supplier_address, check_date, check_number, remarks, job_order_id, project_cost_confirmed_at, job_order:job_orders(job_number, project_name)",
              )
              .in("petty_cash_batch_id", ids),
            (supabase as any)
              .from("petty_cash_funding_events")
              .select(
                "id, petty_cash_batch_id, funding_date, amount, funding_source, funding_reference, created_at",
              )
              .in("petty_cash_batch_id", ids),
            (supabase as any)
              .from("petty_cash_batch_attachments")
              .select(
                "id, petty_cash_batch_id, storage_path, file_name, file_type, file_size, created_at",
              )
              .in("petty_cash_batch_id", ids)
              .order("created_at", { ascending: false }),
          ])
        : [
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
          ];
      const expenses = expenseResult.data;
      const expenseError = expenseResult.error;
      const fundingEvents: any[] = fundingResult.data ?? [];
      const fundingError = fundingResult.error;
      const attachments: any[] = attachmentResult.data ?? [];
      const attachmentError = attachmentResult.error;
      if (expenseError) throw expenseError;
      if (fundingError) throw fundingError;
      if (attachmentError) throw attachmentError;
      const receiptIds = (expenses ?? []).map((expense: any) => expense.id);
      const { data: receiptAllocations, error: allocationError } = receiptIds.length
        ? await (supabase as any)
            .from("job_expense_allocations")
            .select(
              "job_expense_id, job_order_id, allocated_amount, job_order:job_orders(job_number, project_name)",
            )
            .in("job_expense_id", receiptIds)
        : { data: [], error: null };
      if (allocationError) throw allocationError;
      const byBatch = new Map<string, { total: number; count: number; receipts: any[] }>();
      (expenses ?? []).forEach((expense: any) => {
        if (!expense.petty_cash_batch_id) return;
        if (expense.payment_status !== "paid") return;
        const current = byBatch.get(expense.petty_cash_batch_id) ?? {
          total: 0,
          count: 0,
          receipts: [] as any[],
        };
        current.total += Number(expense.amount ?? 0);
        current.count += 1;
        current.receipts.push(expense);
        byBatch.set(expense.petty_cash_batch_id, current);
      });
      return (batches ?? []).map((batch) => ({
        ...batch,
        funding_events: fundingEvents.filter(
          (event: any) => event.petty_cash_batch_id === batch.id,
        ),
        attachments: attachments.filter(
          (attachment: any) => attachment.petty_cash_batch_id === batch.id,
        ),
        funding_total:
          Number(batch.cash_received ?? 0) +
          fundingEvents
            .filter((event: any) => event.petty_cash_batch_id === batch.id)
            .reduce((total: number, event: any) => total + Number(event.amount ?? 0), 0),
        receipts: (byBatch.get(batch.id)?.receipts ?? []).map((receipt) => ({
          ...receipt,
          allocations: (receiptAllocations ?? []).filter(
            (allocation: any) => allocation.job_expense_id === receipt.id,
          ),
        })),
        receipts_total: byBatch.get(batch.id)?.total ?? 0,
        receipt_count: byBatch.get(batch.id)?.count ?? 0,
      }));
    },
  });

  const filteredPettyCashBatches = useMemo(
    () => (pettyCashBatches.data ?? []).filter((batch) =>
      (pettyCashStatusFilter === "all" || batch.status === pettyCashStatusFilter) && matchesPettyCashSearch(batch),
    ),
    [matchesPettyCashSearch, pettyCashBatches.data, pettyCashStatusFilter],
  );

  const historicalEntries = useQuery({
    queryKey: ["report-historical-entries", REPORT_VERSION],
    retry: false,
    enabled: canViewReports,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legacy_accounting_entries")
        .select(
          "id, entry_type, entry_date, reference_no, document_no, counterparty_name, description, expense_type, gross_amount, vat_amount, ewt_amount, tin, address",
        )
        .order("entry_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const cashSales = useQuery({
    queryKey: ["report-cash-sales", REPORT_VERSION],
    retry: false,
    enabled: canViewReports,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_sales")
        .select(
          "id, or_number, collection_date, customer_name, invoice_reference, description, gross_amount, vat_amount",
        )
        .order("collection_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const voucherRevisions = useQuery({
    queryKey: ["report-voucher-revisions", REPORT_VERSION],
    retry: false,
    enabled: canViewReports,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("check_voucher_revisions")
        .select("id, job_expense_id, changed_at, reason, previous_values, new_values")
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const historicalPnl = useQuery({
    queryKey: ["report-historical-pnl", REPORT_VERSION],
    retry: false,
    enabled: canViewReports,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legacy_profit_loss_monthly")
        .select("period_start, gross_revenue, operating_expenses, net_profit")
        .order("period_start", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const receivables = useMemo(
    () =>
      (invoices.data ?? []).map((invoice) => {
        const amountPaid = invoice.amountPaid;
        const amountDue = Number(invoice.amount_due_snapshot ?? invoice.invoice_amount);
        const balance = Math.max(amountDue - amountPaid, 0);
        return {
          ...invoice,
          amountPaid,
          amountDue,
          balance,
          derivedStatus: receivableStatus(amountDue, amountPaid, invoice.due_date),
          daysOutstanding: balance > 0 ? daysOutstanding(invoice.due_date) : null,
        };
      }),
    [invoices.data],
  );

  const reportInvoices = useMemo(
    () =>
      (invoices.data ?? []).filter((invoice) =>
        inDateRange(invoice.invoice_date, dateFrom, dateTo),
      ),
    [dateFrom, dateTo, invoices.data],
  );
  const reportExpenses = useMemo(
    () =>
      (payables.data ?? []).filter((expense) =>
        inDateRange(expense.expense_date, dateFrom, dateTo),
      ),
    [dateFrom, dateTo, payables.data],
  );
  const historicalReportEntries = useMemo(
    () =>
      (historicalEntries.data ?? []).filter((entry) =>
        inDateRange(entry.entry_date, dateFrom, dateTo),
      ),
    [dateFrom, dateTo, historicalEntries.data],
  );
  const historicalRevenue = useMemo(
    () => historicalReportEntries.filter((entry) => entry.entry_type === "revenue"),
    [historicalReportEntries],
  );
  const currentCashSales = useMemo(
    () =>
      (cashSales.data ?? []).filter((entry) =>
        inDateRange(entry.collection_date, dateFrom, dateTo),
      ),
    [cashSales.data, dateFrom, dateTo],
  );
  const cashSaleRows = useMemo(
    () => [
      ...currentCashSales.map((entry) => ({
        id: `manual-${entry.id}`,
        date: entry.collection_date,
        company: entry.customer_name || entry.description,
        or_number: entry.or_number,
        invoice: entry.invoice_reference,
        reference: [entry.or_number, entry.invoice_reference].filter(Boolean).join(" / "),
        source: "Manual OR",
        tin: "",
        address: entry.description,
        gross_amount: Number(entry.gross_amount || 0),
        vat_amount: Number(entry.vat_amount || 0),
        ewt_amount: 0,
      })),
      ...historicalRevenue.map((entry) => ({
        id: `historical-${entry.id}`,
        date: entry.entry_date,
        company: entry.counterparty_name,
        or_number: entry.reference_no,
        invoice: entry.document_no,
        reference: fallbackText(entry.reference_no || entry.document_no),
        source: fallbackText(entry.tin),
        tin: fallbackText(entry.tin),
        address: fallbackText(entry.address),
        gross_amount: Number(entry.gross_amount || 0),
        vat_amount: Number(entry.vat_amount || 0),
        ewt_amount: Number(entry.ewt_amount || 0),
      })),
      ...reportInvoices
        .filter((invoice) => invoice.official_receipt_number)
        .map((invoice) => ({
          id: `invoice-${invoice.id}`,
          date: invoice.invoice_date,
          company: invoice.customer?.customer_name ?? "Customer",
          or_number: invoice.official_receipt_number,
          invoice: invoice.invoice_number,
          reference: [invoice.official_receipt_number, invoice.invoice_number]
            .filter(Boolean)
            .join(" / "),
          source: "Customer invoice",
          tin: "",
          address: "",
          gross_amount: Number(invoice.invoice_amount || 0),
          vat_amount:
            invoice.tax_type === "vatable"
              ? Number(invoice.invoice_amount || 0) -
                Number(invoice.amount_due_snapshot || invoice.invoice_amount || 0)
              : 0,
          ewt_amount: 0,
        })),
    ],
    [currentCashSales, historicalRevenue, reportInvoices],
  );
  const voucherRevisionMap = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        id: string;
        changed_at: string;
        reason: string;
        previous_values: unknown;
        new_values: unknown;
      }>
    >();
    for (const revision of voucherRevisions.data ?? []) {
      const revisions = map.get(revision.job_expense_id) ?? [];
      revisions.push({
        id: revision.id,
        changed_at: revision.changed_at,
        reason: revision.reason,
        previous_values: revision.previous_values,
        new_values: revision.new_values,
      });
      map.set(revision.job_expense_id, revisions);
    }
    return map;
  }, [voucherRevisions.data]);
  const historicalExpenses = useMemo(
    () => historicalReportEntries.filter((entry) => entry.entry_type === "expense"),
    [historicalReportEntries],
  );
  const historicalPnlRows = useMemo(
    () =>
      (historicalPnl.data ?? []).filter((row) => inDateRange(row.period_start, dateFrom, dateTo)),
    [dateFrom, dateTo, historicalPnl.data],
  );
  const historicalPnlPeriods = useMemo(
    () => new Set(historicalPnlRows.map((row) => row.period_start.slice(0, 7))),
    [historicalPnlRows],
  );
  const currentReportInvoices = useMemo(
    () =>
      reportInvoices.filter(
        (invoice) => !historicalPnlPeriods.has(invoice.invoice_date.slice(0, 7)),
      ),
    [historicalPnlPeriods, reportInvoices],
  );
  const currentReportExpenses = useMemo(
    () =>
      reportExpenses.filter(
        (expense) => !historicalPnlPeriods.has(expense.expense_date.slice(0, 7)),
      ),
    [historicalPnlPeriods, reportExpenses],
  );
  const currentHistoricalEntries = useMemo(
    () =>
      historicalReportEntries.filter(
        (entry) => !historicalPnlPeriods.has((entry.entry_date ?? "").slice(0, 7)),
      ),
    [historicalPnlPeriods, historicalReportEntries],
  );
  const disbursements = useMemo(
    () =>
      (payables.data ?? []).filter(
        (expense) =>
          expense.payment_status === "paid" &&
          expense.payment_method === "check" &&
          inDateRange((expense.paid_at ?? expense.expense_date) as string, dateFrom, dateTo),
      ),
    [dateFrom, dateTo, payables.data],
  );
  const filteredReceivables = useMemo(
    () =>
      receivables.filter(
        (invoice) =>
          inDateRange(invoice.invoice_date, dateFrom, dateTo) &&
          matchesReportSearch(
            invoice.invoice_number,
            invoice.customer?.customer_name,
            invoice.job_order?.project_name,
          ),
      ),
    [dateFrom, dateTo, matchesReportSearch, receivables],
  );
  const agingGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        customer: NonNullable<(typeof filteredReceivables)[number]["customer"]>;
        invoices: typeof filteredReceivables;
      }
    >();
    filteredReceivables.forEach((invoice) => {
      const key = invoice.customer?.id ?? "unknown";
      const group = groups.get(key) ?? {
        customer: invoice.customer ?? { id: "unknown", customer_name: "Unknown customer" },
        invoices: [],
      };
      group.invoices.push(invoice);
      groups.set(key, group);
    });
    return Array.from(groups.values()).sort((a, b) =>
      (a.customer.customer_name ?? "").localeCompare(b.customer.customer_name ?? ""),
    );
  }, [filteredReceivables]);
  const agingTotals = useMemo(
    () =>
      filteredReceivables.reduce(
        (totals, invoice) => {
          totals.original += invoice.amountDue;
          totals.paid += invoice.amountPaid;
          totals.balance += invoice.balance;
          totals[agingBucket(invoice.due_date)] += invoice.balance;
          return totals;
        },
        {
          original: 0,
          paid: 0,
          balance: 0,
          current: 0,
          days1to30: 0,
          days31to60: 0,
          days61to90: 0,
          over90: 0,
        },
      ),
    [filteredReceivables],
  );
  const filteredDisbursements = useMemo(
    () =>
      disbursements.filter((expense) =>
        matchesReportSearch(
          expense.supplier_name,
          expense.description,
          expense.reference_no,
          expense.supplier_document_no,
          expense.check_number,
          expense.payment_source,
          expense.disbursement_category,
        ),
      ),
    [disbursements, matchesReportSearch],
  );
  const filteredCashSaleRows = useMemo(
    () =>
      cashSaleRows.filter((entry) =>
        matchesReportSearch(entry.company, entry.or_number, entry.invoice, entry.reference),
      ),
    [cashSaleRows, matchesReportSearch],
  );
  const filteredHistoricalExpenses = useMemo(
    () =>
      historicalExpenses.filter((entry) =>
        matchesReportSearch(
          entry.counterparty_name,
          entry.description,
          entry.reference_no,
          entry.document_no,
        ),
      ),
    [historicalExpenses, matchesReportSearch],
  );
  const visibleHistoricalDisbursements = [] as typeof filteredHistoricalExpenses;
  const filteredMonthlyProfitRows = useMemo(
    () => ({
      historicalPnl: historicalPnlRows.filter((row) =>
        matchesReportSearch(
          "Historical P&L",
          row.period_start,
          "Imported monthly financial result",
          "Workbook",
        ),
      ),
      invoices: currentReportInvoices.filter((invoice) =>
        matchesReportSearch(
          "Revenue",
          invoice.invoice_date,
          invoice.invoice_number,
          invoice.customer?.customer_name,
        ),
      ),
      expenses: currentReportExpenses.filter((expense) =>
        matchesReportSearch(
          "Expense",
          expense.expense_date,
          expense.description,
          expense.reference_no,
          expense.supplier_name,
        ),
      ),
      historical: currentHistoricalEntries.filter((entry) =>
        matchesReportSearch(
          entry.entry_type,
          entry.entry_date,
          entry.description,
          entry.counterparty_name,
          entry.reference_no,
          entry.document_no,
        ),
      ),
    }),
    [
      currentHistoricalEntries,
      currentReportExpenses,
      currentReportInvoices,
      historicalPnlRows,
      matchesReportSearch,
    ],
  );
  const pendingExpenses = useMemo(
    () =>
      (payables.data ?? []).filter((expense) =>
        expense.payment_state
          ? !["cleared", "cancelled"].includes(expense.payment_state)
          : expense.payment_status === "pending",
      ),
    [payables.data],
  );
  const filteredProfitability = useMemo(
    () =>
      (profit.data ?? []).filter((job) => {
        if (!matchesReportSearch(job.project_name, job.job_number, job.customer?.customer_name)) {
          return false;
        }
        if (profitabilityFilter === "with-costs") return Number(job.expenses) > 0;
        if (profitabilityFilter === "no-costs") return Number(job.expenses) === 0;
        if (profitabilityFilter === "profitable") return Number(job.profit) >= 0;
        if (profitabilityFilter === "loss") return Number(job.profit) < 0;
        return true;
      }),
    [matchesReportSearch, profit.data, profitabilityFilter],
  );
  const generalExpenses = useMemo(
    () =>
      (payables.data ?? []).filter(
        (expense) =>
          expense.payment_method !== "petty_cash" && expense.disbursement_category !== "petty_cash",
      ),
    [payables.data],
  );
  const unallocatedGeneralExpenseAmount = useCallback((expense: any) => {
    if (expense.job_order_id) return 0;
    const allocated = (expense.allocations ?? []).reduce(
      (sum: number, allocation: { allocated_amount: number }) =>
        sum + Number(allocation.allocated_amount || 0),
      0,
    );
    return Math.max(0, Number(expense.amount || 0) - allocated);
  }, []);
  const generalExpenseSummary = useMemo(
    () =>
      generalExpenses.reduce(
        (summary, expense) => {
          summary.total += Number(expense.amount ?? 0);
          if (expense.payment_status !== "paid") {
            summary.pendingCount += 1;
            summary.pendingTotal += Number(expense.amount ?? 0);
          }
          const unallocated = unallocatedGeneralExpenseAmount(expense);
          if (unallocated > 0.009) {
            summary.unallocatedCount += 1;
            summary.unallocatedTotal += unallocated;
          }
          return summary;
        },
        { total: 0, pendingCount: 0, pendingTotal: 0, unallocatedCount: 0, unallocatedTotal: 0 },
      ),
    [generalExpenses, unallocatedGeneralExpenseAmount],
  );
  const filteredGeneralExpenses = useMemo(
    () =>
      generalExpenses.filter((expense) => {
        if (pendingExpenseGroup === "needs-payment") return expense.payment_status !== "paid";
        if (pendingExpenseGroup === "needs-allocation") {
          return unallocatedGeneralExpenseAmount(expense) > 0.009;
        }
        return true;
      }),
    [generalExpenses, pendingExpenseGroup, unallocatedGeneralExpenseAmount],
  );
  const overviewMetrics = useMemo(
    () => ({
      openQuotes: (quotes.data ?? []).filter(
        (quote) => quote.status !== "approved" && quote.status !== "rejected",
      ),
      activeJobs: (profit.data ?? []).filter((job) => job.status !== "completed"),
      unpaidInvoices: receivables.filter((invoice) => invoice.balance > 0),
      pendingExpenses,
    }),
    [pendingExpenses, profit.data, quotes.data, receivables],
  );
  const pnl = useMemo(() => {
    const revenue = currentReportInvoices.reduce(
      (sum, invoice) => sum + Number(invoice.amount_due_snapshot ?? invoice.invoice_amount ?? 0),
      0,
    );
    const expenses = currentReportExpenses.reduce(
      (sum, expense) => sum + Number(expense.amount || 0),
      0,
    );
    const cashSalesRevenue = currentCashSales.reduce(
      (sum, entry) => sum + Number(entry.gross_amount || 0),
      0,
    );
    const historicalRevenueTotal = currentHistoricalEntries
      .filter((entry) => entry.entry_type === "revenue")
      .reduce((sum, entry) => sum + Number(entry.gross_amount || 0), 0);
    const historicalExpenseTotal = currentHistoricalEntries
      .filter((entry) => entry.entry_type === "expense")
      .reduce((sum, entry) => sum + Number(entry.gross_amount || 0), 0);
    const importedSummaryRevenue = historicalPnlRows.reduce(
      (sum, row) => sum + Number(row.gross_revenue || 0),
      0,
    );
    const importedSummaryExpenses = historicalPnlRows.reduce(
      (sum, row) => sum + Number(row.operating_expenses || 0),
      0,
    );
    return {
      revenue: revenue + cashSalesRevenue + historicalRevenueTotal + importedSummaryRevenue,
      expenses: expenses + historicalExpenseTotal + importedSummaryExpenses,
      net:
        revenue +
        cashSalesRevenue +
        historicalRevenueTotal +
        importedSummaryRevenue -
        expenses -
        historicalExpenseTotal -
        importedSummaryExpenses,
    };
  }, [
    currentCashSales,
    currentHistoricalEntries,
    currentReportExpenses,
    currentReportInvoices,
    historicalPnlRows,
  ]);

  const isRefreshing =
    profit.isFetching ||
    quotes.isFetching ||
    invoices.isFetching ||
    payables.isFetching ||
    cashSales.isFetching ||
    historicalEntries.isFetching;
  function runReports() {
    qc.invalidateQueries({ queryKey: ["report-profit", REPORT_VERSION] });
    qc.invalidateQueries({ queryKey: ["report-quotes", REPORT_VERSION] });
    qc.invalidateQueries({ queryKey: ["report-invoices", REPORT_VERSION] });
    qc.invalidateQueries({ queryKey: ["report-payables", REPORT_VERSION] });
    qc.invalidateQueries({ queryKey: ["report-cash-sales", REPORT_VERSION] });
    qc.invalidateQueries({ queryKey: ["report-historical-entries", REPORT_VERSION] });
  }

  function downloadReportCsv() {
    const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;
    if (activeReport === "disbursements") {
      const workbook = buildDisbursementWorkbookBlob(
        filteredDisbursements.map((expense) => ({
          expense_date: expense.expense_date,
          reference_no: expense.reference_no,
          supplier_name: expense.supplier_name,
          description: expense.description,
          disbursement_category: expense.disbursement_category,
          disbursement_subcategory: expense.disbursement_subcategory,
          supplier_document_no: expense.supplier_document_no,
          check_number: expense.check_number,
          check_date: expense.check_date,
          supplier_tin: expense.supplier_tin,
          supplier_address: expense.supplier_address,
          amount: Number(expense.amount || 0),
          tax_amount: Number(expense.tax_amount || 0),
          job_number: (expense.job_order as { job_number?: string } | null)?.job_number ?? null,
          project_name:
            (expense.job_order as { project_name?: string } | null)?.project_name ?? null,
        })),
      );
      downloadBlob(workbook, `Cash-Disbursement-${dateFrom}-to-${dateTo}.xlsx`);
      return;
    }

    if (activeReport === "cash-sales") {
      const workbook = buildCashSalesWorkbookBlob(
        filteredCashSaleRows.map((entry) => ({
          or_number: entry.or_number,
          date: entry.date ?? "",
          company: entry.company,
          amount_paid: entry.gross_amount,
          invoice: entry.invoice,
          input_vat: entry.vat_amount,
          ewt: entry.ewt_amount,
          tin: entry.tin,
          address: entry.address,
        })),
      );
      downloadBlob(workbook, `Cash-Sales-${dateFrom}-to-${dateTo}.xlsx`);
      return;
    }

    if (activeReport === "receivables") {
      const rows = [
        [
          "Customer",
          "Invoice #",
          "Invoice date",
          "Due date",
          "Aging",
          "Original",
          "Paid",
          "Open balance",
        ],
        ...agingGroups.flatMap((group) => [
          [
            group.customer.customer_name ?? "Unknown customer",
            "",
            "",
            "",
            "Customer subtotal",
            String(group.invoices.reduce((sum, invoice) => sum + invoice.amountDue, 0)),
            String(group.invoices.reduce((sum, invoice) => sum + invoice.amountPaid, 0)),
            String(group.invoices.reduce((sum, invoice) => sum + invoice.balance, 0)),
          ],
          ...group.invoices.map((invoice) => [
            group.customer.customer_name ?? "Unknown customer",
            invoice.invoice_number,
            invoice.invoice_date,
            invoice.due_date ?? "",
            agingBucketLabel(invoice.due_date),
            String(invoice.amountDue),
            String(invoice.amountPaid),
            String(invoice.balance),
          ]),
        ]),
        [
          "Grand total",
          "",
          "",
          "",
          "",
          String(agingTotals.original),
          String(agingTotals.paid),
          String(agingTotals.balance),
        ],
      ];
      downloadCsv(
        rows.map((row) => row.map(csvCell).join(",")).join("\n"),
        `Receivables-Aging-${dateFrom}-to-${dateTo}.csv`,
      );
      return;
    }

    if (activeReport === "payables") {
      const total = filteredGeneralExpenses.reduce(
        (sum, expense) => sum + Number(expense.amount ?? 0),
        0,
      );
      const rows = [
        ["Supplier / Payee", "Details", "Due date", "Status", "Amount"],
        ...filteredGeneralExpenses.map((expense) => [
          expense.supplier_name || "-",
          expense.description || "-",
          expense.due_date ?? "",
          expense.payment_status || "Pending",
          String(Number(expense.amount ?? 0)),
        ]),
        [],
        ["Total pending expenses", "", "", "", String(total)],
      ];
      downloadCsv(
        rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
        `General-Expenses-${dateFrom}-to-${dateTo}.csv`,
      );
      return;
    }

    if (activeReport === "petty-cash") {
      const rows: string[][] = [
        [
          "Date",
          "Type",
          "Description / supplier",
          "Category",
          "Job Order",
          "Tax",
          "Money in",
          "Money out",
          "Running balance",
        ],
      ];
      const transactions: any[] = [];
      (pettyCashBatches.data ?? []).forEach((batch) => {
        transactions.push({
          date: batch.funding_date,
          type: "Cash added",
          description: `${batch.funding_source} · ${batch.funding_reference}`,
          category: "Funding",
          job: "—",
          tax: 0,
          moneyIn: Number(batch.cash_received ?? 0),
          moneyOut: 0,
        });
        (batch.receipts ?? []).forEach((receipt: any) =>
          transactions.push({
            date: receipt.expense_date,
            type: "Receipt",
            description: `${receipt.supplier_name || "Receipt"} · ${receipt.description}`,
            category: receipt.disbursement_category || "Other",
            job: receipt.job_order?.job_number || "General expense",
            tax: Number(receipt.tax_amount ?? 0),
            moneyIn: 0,
            moneyOut: Number(receipt.amount ?? 0),
          }),
        );
        const cashReturned = Number((batch as any).cash_returned_amount ?? 0);
        if (cashReturned > 0) {
          transactions.push({
            date: (batch as any).settled_at ?? batch.closed_at ?? batch.funding_date,
            type: "Cash returned",
            description: (batch as any).cash_returned_reference || "Cash returned to company",
            category: "Settlement",
            job: "—",
            tax: 0,
            moneyIn: 0,
            moneyOut: cashReturned,
          });
        }
      });
      transactions.sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
      let runningBalance = 0;
      transactions.forEach((transaction) => {
        runningBalance += transaction.moneyIn - transaction.moneyOut;
        transaction.runningBalance = runningBalance;
        rows.push([
          transaction.date ?? "",
          transaction.type,
          transaction.description,
          transaction.category,
          transaction.job,
          String(transaction.tax),
          String(transaction.moneyIn),
          String(transaction.moneyOut),
          String(runningBalance),
        ]);
      });
      rows.push(
        [],
        [
          "Total",
          "",
          "",
          "",
          "",
          "",
          String(transactions.reduce((sum, item) => sum + item.moneyIn, 0)),
          String(transactions.reduce((sum, item) => sum + item.moneyOut, 0)),
          String(runningBalance),
        ],
      );
      const projectTotals = new Map<string, { count: number; total: number }>();
      (pettyCashBatches.data ?? []).forEach((batch) =>
        (batch.receipts ?? []).forEach((receipt: any) => {
          const job = receipt.job_order?.job_number || "General expense";
          const current = projectTotals.get(job) ?? { count: 0, total: 0 };
          current.count += 1;
          current.total += Number(receipt.amount ?? 0);
          projectTotals.set(job, current);
        }),
      );
      rows.push(
        [],
        ["By Job Order / project", "", "", "", "", "", "", "", ""],
        ["Job Order", "", "", "", "Receipt count", "", "", "Total", ""],
      );
      projectTotals.forEach((value, job) =>
        rows.push([job, "", "", "", String(value.count), "", "", String(value.total), ""]),
      );
      const workbook = buildPettyCashWorkbookBlob(
        transactions.map((transaction) => ({
          date: transaction.date ?? "",
          type: transaction.type,
          description: transaction.description,
          category: transaction.category,
          job_number: transaction.job,
          project_name: transaction.project ?? "",
          supplier_name: transaction.supplier ?? "",
          tax_amount: transaction.tax,
          money_in: transaction.moneyIn,
          money_out: transaction.moneyOut,
          running_balance: transaction.runningBalance ?? 0,
        })),
        transactions.reduce((sum, transaction) => sum + transaction.moneyIn, 0),
      );
      downloadBlob(workbook, `Petty-Cash-${dateFrom}-to-${dateTo}.xlsx`);
      return;
    }

    const table = document.querySelector<HTMLTableElement>(".report-table-scroll table");
    if (!table) {
      toast.error("The report is still loading. Please try again.");
      return;
    }

    const rows = Array.from(table.rows).map((row) =>
      Array.from(row.cells).map((cell) =>
        csvCell(cell.textContent?.trim().replace(/\s+/g, " ") ?? ""),
      ),
    );
    const csv = [
      [csvCell(activeReportTitle)],
      [csvCell(`${fmtDate(dateFrom)} to ${fmtDate(dateTo)}`)],
      [],
      ...rows,
    ]
      .map((row) => row.join(","))
      .join("\r\n");
    downloadCsv(
      csv,
      `${activeReportTitle.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}-${dateFrom}-to-${dateTo}.csv`,
    );
  }

  const addGeneralExpense = useMutation({
    mutationFn: async (f: GeneralExpenseFormValues) => {
      if (!canWrite) throw new Error("You do not have permission to perform this action.");
      if (!f.expense_date) throw new Error("Date is required.");
      if (!f.description.trim()) throw new Error("Description is required.");
      if (f.due_date && f.due_date < f.expense_date) {
        throw new Error("Due date cannot be before the expense date.");
      }
      const amount =
        f.expense_type === "materials" && f.quantity && f.unit_cost
          ? computeMaterialAmount(f.quantity, f.unit_cost)
          : f.amount;
      if (amount <= 0) throw new Error("Amount must be greater than zero.");
      if (f.tax_amount < 0) throw new Error("Tax cannot be negative.");
      if (f.disbursement_category === "direct_materials" && !f.petty_cash_batch_id) {
        if (!f.supplier_name.trim())
          throw new Error("Company name is required for direct materials.");
        if (!f.supplier_tin.trim()) throw new Error("TIN is required for direct materials.");
        if (!f.supplier_address.trim())
          throw new Error("Address is required for direct materials.");
      }
      if (f.payment_method === "check" && f.payment_status === "paid" && !f.check_number.trim()) {
        throw new Error("Check number is required when an expense is already paid.");
      }
      if (f.payment_method === "check" && f.payment_status === "paid" && !f.check_date) {
        throw new Error("Check date is required when an expense is already paid.");
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const expenseId = crypto.randomUUID();
      let proofPath: string | null = null;
      if (f.payment_proof_file) {
        const extension = f.payment_proof_file.name.split(".").pop()?.toLowerCase() || "bin";
        proofPath = `${user?.id ?? "unknown"}/${expenseId}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("disbursement-payment-proofs")
          .upload(proofPath, f.payment_proof_file, { upsert: false });
        if (uploadError) throw uploadError;
      }
      const expensePayload = {
        id: expenseId,
        job_order_id: f.job_order_id,
        petty_cash_batch_id: f.petty_cash_batch_id,
        supplier_id: f.supplier_id,
        expense_date: f.expense_date,
        expense_type: f.expense_type,
        disbursement_category: f.disbursement_category,
        disbursement_subcategory: f.disbursement_subcategory || null,
        supplier_name: f.supplier_name.trim().toUpperCase() || null,
        description: f.description.trim(),
        quantity: f.expense_type === "materials" ? f.quantity : null,
        unit_of_measure: f.expense_type === "materials" ? f.unit_of_measure.trim() || null : null,
        unit_cost: f.expense_type === "materials" ? f.unit_cost : null,
        amount,
        tax_amount: f.tax_amount,
        tax_type: f.tax_type,
        payment_status: f.payment_status,
        payment_method: f.payment_method === "unpaid" ? null : f.payment_method,
        payment_state: f.payment_state,
        payment_source: f.payment_method === "unpaid" ? null : f.payment_source.trim() || null,
        payment_source_reference:
          f.payment_method === "unpaid" ? null : f.payment_source_reference.trim() || null,
        payment_proof_storage_path: proofPath,
        payment_proof_file_name: f.payment_proof_file?.name ?? null,
        payment_proof_file_type: f.payment_proof_file?.type ?? null,
        payment_proof_file_size: f.payment_proof_file?.size ?? null,
        receipt_missing_reason: f.receipt_missing_reason || null,
        payment_released_at: ["released", "cleared"].includes(f.payment_state)
          ? new Date().toISOString()
          : null,
        due_date: f.due_date || null,
        paid_at: f.payment_status === "paid" ? new Date().toISOString() : null,
        reference_no: f.reference_no.trim() || null,
        supplier_document_no: f.supplier_document_no.trim() || null,
        supplier_tin: f.supplier_tin.trim() || null,
        supplier_address: f.supplier_address.trim() || null,
        check_date:
          f.payment_method === "check" && ["released", "cleared"].includes(f.payment_state)
            ? f.check_date
            : null,
        check_number:
          f.payment_method === "check" && ["released", "cleared"].includes(f.payment_state)
            ? f.check_number.trim() || null
            : null,
        remarks: f.remarks.trim() || null,
      };
      const { error } = await (supabase as any).rpc("create_job_expense_with_allocations", {
        p_expense: expensePayload,
        p_allocations: f.allocation_mode === "shared" ? f.allocations : [],
      });
      if (error) {
        if (proofPath) {
          await supabase.storage.from("disbursement-payment-proofs").remove([proofPath]);
        }
        throw error;
      }
    },
    onSuccess: (_, values) => {
      setExpenseOpen(false);
      qc.invalidateQueries({ queryKey: ["report-payables", REPORT_VERSION] });
      qc.invalidateQueries({ queryKey: ["report-profit", REPORT_VERSION] });
      qc.invalidateQueries({ queryKey: ["petty-cash-batches"] });
      toast.success(
        values.payment_method === "petty_cash"
          ? "Petty-cash receipt added"
          : "General expense added",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updatePayableStatus = useMutation({
    mutationFn: async ({
      id,
      payment_status,
      reference_no,
      supplier_document_no,
      check_date,
      check_number,
    }: {
      id: string;
      payment_status: "pending" | "paid";
      reference_no?: string;
      supplier_document_no?: string;
      check_date?: string;
      check_number?: string;
    }) => {
      if (!canWrite) throw new Error("You do not have permission to perform this action.");
      if (payment_status === "paid" && !check_number?.trim()) {
        throw new Error("Check number is required.");
      }
      if (payment_status === "paid" && !check_date) throw new Error("Check date is required.");
      const update =
        payment_status === "paid"
          ? {
              payment_status,
              // Check Disbursements is a report over this same expense. Marking it paid here
              // must therefore identify the payment as a check rather than create another record.
              payment_method: "check" as const,
              payment_state: "released" as const,
              payment_released_at: new Date().toISOString(),
              paid_at: new Date().toISOString(),
              reference_no: reference_no?.trim() || null,
              supplier_document_no: supplier_document_no?.trim() || null,
              check_date,
              check_number: check_number?.trim() || null,
            }
          : {
              payment_status,
              payment_state: "pending" as const,
              payment_released_at: null,
              paid_at: null,
              check_date: check_date || null,
            };
      const { error } = await supabase.from("job_expenses").update(update).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      setPayingPayable(null);
      qc.invalidateQueries({ queryKey: ["report-payables", REPORT_VERSION] });
      qc.invalidateQueries({ queryKey: ["report-profit", REPORT_VERSION] });
      qc.invalidateQueries({ queryKey: ["dashboard", REPORT_VERSION] });
      toast.success(
        vars.payment_status === "paid"
          ? "Check payment recorded. It now appears in Check Disbursements."
          : "Payable reopened",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updatePendingExpense = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: GeneralExpenseFormValues }) => {
      if (!canWrite) throw new Error("You do not have permission to perform this action.");
      if (!values.expense_date) throw new Error("Date is required.");
      if (!values.description.trim()) throw new Error("Description is required.");
      if (values.due_date && values.due_date < values.expense_date) {
        throw new Error("Due date cannot be before the expense date.");
      }
      if (values.amount <= 0) throw new Error("Amount must be greater than zero.");
      if (values.tax_amount < 0) throw new Error("Tax cannot be negative.");
      if (values.disbursement_category === "direct_materials") {
        if (!values.supplier_name.trim())
          throw new Error("Company name is required for direct materials.");
        if (!values.supplier_tin.trim()) throw new Error("TIN is required for direct materials.");
        if (!values.supplier_address.trim())
          throw new Error("Address is required for direct materials.");
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("job_expenses")
        .update({
          job_order_id: values.job_order_id,
          petty_cash_batch_id: values.petty_cash_batch_id,
          supplier_id: values.supplier_id,
          expense_date: values.expense_date,
          expense_type: values.expense_type,
          disbursement_category: values.disbursement_category,
          disbursement_subcategory: values.disbursement_subcategory || null,
          supplier_name: values.supplier_name.trim().toUpperCase() || null,
          description: values.description.trim(),
          quantity: values.expense_type === "materials" ? values.quantity : null,
          unit_of_measure:
            values.expense_type === "materials" ? values.unit_of_measure.trim() || null : null,
          unit_cost: values.expense_type === "materials" ? values.unit_cost : null,
          amount: values.amount,
          tax_amount: values.tax_amount,
          tax_type: values.tax_type,
          due_date: values.due_date || null,
          reference_no: values.reference_no.trim() || null,
          supplier_document_no: values.supplier_document_no.trim() || null,
          supplier_tin: values.supplier_tin.trim() || null,
          supplier_address: values.supplier_address.trim() || null,
          remarks: values.remarks.trim() || null,
        })
        .eq("id", id)
        .eq("payment_status", "pending")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("This expense is no longer pending.");
      const { error: allocationError } = await (supabase as any).rpc(
        "replace_job_expense_allocations",
        {
          p_expense_id: id,
          p_allocations: values.allocation_mode === "shared" ? values.allocations : [],
        },
      );
      if (allocationError) throw allocationError;
    },
    onSuccess: () => {
      setEditingExpense(null);
      qc.invalidateQueries({ queryKey: ["report-payables", REPORT_VERSION] });
      qc.invalidateQueries({ queryKey: ["report-profit", REPORT_VERSION] });
      qc.invalidateQueries({ queryKey: ["dashboard", REPORT_VERSION] });
      toast.success("Pending expense updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmExpenseAllocations = useMutation({
    mutationFn: async ({
      expenseId,
      expenseAmount,
      allocations,
    }: {
      expenseId: string;
      expenseAmount: number;
      allocations: Array<{ job_order_id: string; allocated_amount: number }>;
    }) => {
      if (!canWrite) throw new Error("You do not have permission to confirm allocations.");
      const total = allocations.reduce((sum, allocation) => sum + allocation.allocated_amount, 0);
      if (
        allocations.some(
          (allocation) => !allocation.job_order_id || allocation.allocated_amount <= 0,
        )
      ) {
        throw new Error("Each confirmed Job Order amount must be greater than zero.");
      }
      if (total - expenseAmount > 0.009) {
        throw new Error("Confirmed allocation cannot exceed the original expense amount.");
      }
      const jobOrderIds = allocations.map((allocation) => allocation.job_order_id);
      if (new Set(jobOrderIds).size !== jobOrderIds.length) {
        throw new Error("Choose each Job Order only once.");
      }
      const { error } = await (supabase as any).rpc("replace_job_expense_allocations", {
        p_expense_id: expenseId,
        p_allocations: allocations,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAllocationExpense(null);
      qc.invalidateQueries({ queryKey: ["report-payables", REPORT_VERSION] });
      qc.invalidateQueries({ queryKey: ["report-profit", REPORT_VERSION] });
      qc.invalidateQueries({ queryKey: ["petty-cash-batches"] });
      toast.success(
        "Allocation saved. It needs Operations confirmation before it affects profitability.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmExpenseProjectCost = useMutation({
    mutationFn: async (expenseId: string) => {
      if (!canConfirmProjectCosts) {
        throw new Error("Only an Owner or Admin can confirm a cost for Project Profitability.");
      }
      const { error } = await (supabase as any).rpc("confirm_expense_project_cost", {
        p_expense_id: expenseId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-payables", REPORT_VERSION] });
      qc.invalidateQueries({ queryKey: ["report-profit", REPORT_VERSION] });
      qc.invalidateQueries({ queryKey: ["petty-cash-batches"] });
      toast.success("Cost confirmed for Project Profitability");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const downloadExpenseImportFile = useCallback((content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleExpenseImportFile = useCallback(
    async (file: File) => {
      try {
        const rows = await parsePendingExpenseFile(file);
        if (rows.length === 0) throw new Error("No receipt rows were found. The file must contain DATE, PETTY CASH, and AMOUNT columns.");
        const jobs = new Map(
          (jobOrderLookup.data ?? []).map((job) => [job.job_number.toLowerCase(), job.id]),
        );
        const existing = new Set(
          (payables.data ?? []).map((expense) =>
            [
              expense.expense_date,
              expense.supplier_name ?? "",
              expense.description,
              Number(expense.amount).toFixed(2),
              expense.supplier_document_no ?? "",
            ].join("|"),
          ),
        );
        rows.forEach((row) => {
          if (expenseImportContext === "petty-cash") {
            if (expenseImportBatchId === "none") {
              row.errors.push("Open a petty cash batch before importing receipts.");
            }
            row.disbursement_category = "petty_cash";
            if (!row.receipt_missing_reason)
              row.receipt_missing_reason = "Imported from cash disbursement workbook";
          } else if (row.disbursement_category === "petty_cash") {
            row.errors.push(
              "Import petty-cash receipts from their open batch, not General Expenses.",
            );
          }
          if (row.job_number) {
            row.job_order_id = jobs.get(row.job_number.toLowerCase()) ?? null;
            if (!row.job_order_id) row.errors.push("Job Order not found");
          }
          const key = [
            row.expense_date,
            row.supplier_name,
            row.description,
            Number(row.amount).toFixed(2),
            row.supplier_document_no,
          ].join("|");
          if (existing.has(key)) row.duplicate = true;
        });
        setExpenseImportRows(rows);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "We could not read that file.");
        setExpenseImportRows([]);
      }
    },
    [expenseImportBatchId, expenseImportContext, jobOrderLookup.data, payables.data],
  );

  const importPendingExpenses = async () => {
    if (!canWrite) return toast.error("You do not have permission to import expenses.");
    if (expenseImportContext === "petty-cash" && expenseImportBatchId === "none") {
      return toast.error("Open a petty cash batch before importing receipts.");
    }
    const validRows = expenseImportRows.filter((row) => row.errors.length === 0);
    const rowsToImport = validRows.filter((row) => includePossibleDuplicates || !row.duplicate);
    if (rowsToImport.length === 0) return toast.error("Fix the rows marked Needs attention first.");
    setExpenseImportBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const selectedPettyCashBatch = (pettyCashBatches.data ?? []).find(
        (batch) => batch.id === expenseImportBatchId,
      );
      const isPettyCashImport = Boolean(selectedPettyCashBatch);
      const expensePayload = rowsToImport.map((row) => ({
        job_order_id: row.job_order_id,
        petty_cash_batch_id: expenseImportBatchId === "none" ? null : expenseImportBatchId,
        expense_date: row.expense_date,
        expense_type: row.expense_type,
        disbursement_category:
          row.disbursement_category ||
          (row.expense_type === "materials" ? "direct_materials" : "other"),
        disbursement_subcategory: row.disbursement_subcategory || null,
        payment_source: isPettyCashImport
          ? (selectedPettyCashBatch?.funding_source ?? null)
          : row.payment_source || null,
        supplier_name: row.supplier_name.toUpperCase() || null,
        description: row.description,
        quantity: row.expense_type === "materials" ? row.quantity : null,
        unit_of_measure: row.expense_type === "materials" ? row.unit_of_measure || null : null,
        unit_cost: row.expense_type === "materials" ? row.unit_cost : null,
        amount: row.amount,
        tax_amount: 0,
        payment_status: isPettyCashImport ? "paid" : "pending",
        payment_state: isPettyCashImport ? "cleared" : "pending",
        payment_method: isPettyCashImport ? "petty_cash" : "check",
        receipt_missing_reason: isPettyCashImport ? row.receipt_missing_reason : null,
        due_date: row.due_date || null,
        supplier_document_no: row.supplier_document_no || null,
        supplier_tin: row.supplier_tin || null,
        supplier_address: row.supplier_address || null,
        remarks: row.remarks || null,
        created_by: user?.id,
      }));

      // Keep large workbook imports below the local PostgREST request limit.
      // The preview can contain thousands of rows, but one giant INSERT is
      // rejected by the API before any rows are saved.
      const chunkSize = 200;
      for (let index = 0; index < expensePayload.length; index += chunkSize) {
        const chunk = expensePayload.slice(index, index + chunkSize);
        const { error } = await (supabase as any).from("job_expenses").insert(chunk as any);
        if (error) {
          throw new Error(
            `Import failed at rows ${index + 1}-${index + chunk.length}: ${error.message}`,
          );
        }
      }
      const total = rowsToImport.reduce((sum, row) => sum + row.amount, 0);
      setExpenseImportRows([]);
      setExpenseImportOpen(false);
      await qc.invalidateQueries({ queryKey: ["report-payables", REPORT_VERSION] });
      await qc.invalidateQueries({ queryKey: ["report-profit", REPORT_VERSION] });
      toast.success(
        `${rowsToImport.length} ${isPettyCashImport ? "petty-cash receipts" : "general expenses"} added. Total: ${peso(total)}.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We could not import these expenses.");
    } finally {
      setExpenseImportBusy(false);
    }
  };

  const createPettyCashBatch = async () => {
    const fundingSource =
      pettyCashForm.funding_source === "Other"
        ? pettyCashCustomFundingSource.trim()
        : pettyCashForm.funding_source;
    if (
      !canWrite ||
      !pettyCashForm.custodian_name.trim() ||
      !pettyCashForm.cash_received ||
      !fundingSource ||
      !pettyCashForm.funding_reference.trim()
    ) {
      return toast.error("Enter the custodian, cash received, and funding reference.");
    }
    const amount = Number(pettyCashForm.cash_received);
    if (!Number.isFinite(amount) || amount <= 0)
      return toast.error("Cash received must be greater than zero.");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const payload = {
      ...pettyCashForm,
      funding_source: fundingSource,
      custodian_name: pettyCashForm.custodian_name.trim(),
      cash_received: amount,
      job_order_id: pettyCashForm.job_order_id || null,
    };
    const { error } = editingPettyCashBatch
      ? await (supabase as any)
          .from("petty_cash_batches")
          .update(payload)
          .eq("id", editingPettyCashBatch.id)
      : await (supabase as any)
          .from("petty_cash_batches")
          .insert({ ...payload, created_by: user?.id });
    if (error) return toast.error(error.message);
    setPettyCashOpen(false);
    setEditingPettyCashBatch(null);
    setPettyCashForm({
      custodian_name: "",
      cash_received: "",
      funding_date: dateInputValue(new Date()),
      funding_source: "BDO",
      funding_reference: "",
      job_order_id: "",
    });
    setPettyCashCustomFundingSource("");
    await qc.invalidateQueries({ queryKey: ["petty-cash-batches"] });
    toast.success(editingPettyCashBatch ? "Petty cash batch updated" : "Petty cash batch created");
  };

  const addPettyCashFunding = async () => {
    const amount = Number(pettyCashFundingForm.amount);
    if (!canWrite || !pettyCashFundingBatch) return;
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !pettyCashFundingForm.funding_source.trim() ||
      !pettyCashFundingForm.funding_reference.trim()
    ) {
      return toast.error("Enter the amount, funding source, and reference.");
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await (supabase as any).from("petty_cash_funding_events").insert({
      petty_cash_batch_id: pettyCashFundingBatch.id,
      funding_date: pettyCashFundingForm.funding_date,
      amount,
      funding_source: pettyCashFundingForm.funding_source.trim(),
      funding_reference: pettyCashFundingForm.funding_reference.trim(),
      created_by: user?.id,
    });
    if (error) return toast.error(error.message);
    setPettyCashFundingBatch(null);
    setPettyCashFundingForm({
      amount: "",
      funding_date: dateInputValue(new Date()),
      funding_source: "",
      funding_reference: "",
    });
    await qc.invalidateQueries({ queryKey: ["petty-cash-batches"] });
    toast.success("Cash added to the batch");
  };

  const settleAndClosePettyCashBatch = async () => {
    if (!canWrite || !pettyCashSettlementBatch) return;
    const cashReturned = Number(pettyCashSettlementForm.cash_returned_amount);
    if (!Number.isFinite(cashReturned) || cashReturned < 0) {
      return toast.error("Enter the cash returned to close this batch.");
    }
    const { error } = await (supabase as any).rpc("settle_and_close_petty_cash_batch", {
      p_batch_id: pettyCashSettlementBatch.id,
      p_cash_returned_amount: cashReturned,
      p_cash_returned_reference: pettyCashSettlementForm.cash_returned_reference,
    });
    if (error) return toast.error(error.message);
    setPettyCashSettlementBatch(null);
    setPettyCashSettlementForm({ cash_returned_amount: "", cash_returned_reference: "" });
    await qc.invalidateQueries({ queryKey: ["petty-cash-batches"] });
    toast.success("Petty-cash batch settled and closed");
  };

  const createPettyCashCv = async () => {
    if (!pettyCashCvBatch || !pettyCashCvReference.trim())
      return toast.error("Enter the CV reference number.");
    const { error } = await supabase
      .from("petty_cash_batches")
      .update({
        status: "cv_created",
        cv_reference_no: pettyCashCvReference.trim(),
        cv_created_at: new Date().toISOString(),
      })
      .eq("id", pettyCashCvBatch.id)
      .eq("status", "closed")
      .is("cv_reference_no", null);
    if (error) return toast.error(error.message);
    setPettyCashCvBatch(null);
    setPettyCashCvReference("");
    await qc.invalidateQueries({ queryKey: ["petty-cash-batches"] });
    toast.success("One CV recorded for this petty cash batch");
  };

  const uploadPettyCashBatchImage = async (batch: any, file: File) => {
    if (!canWrite || !batch?.id) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return toast.error("Upload a JPG, PNG, or WEBP image.");
    }
    if (file.size > 10 * 1024 * 1024) {
      return toast.error("Image must be 10MB or smaller.");
    }
    setPettyCashAttachmentBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const storagePath = `${batch.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("petty-cash-batch-attachments")
        .upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data: insertedAttachment, error: insertError } = await (supabase as any)
        .from("petty_cash_batch_attachments")
        .insert({
          petty_cash_batch_id: batch.id,
          storage_path: storagePath,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          created_by: user?.id,
        })
        .select(
          "id, petty_cash_batch_id, storage_path, file_name, file_type, file_size, created_at",
        )
        .single();
      if (insertError) {
        await supabase.storage.from("petty-cash-batch-attachments").remove([storagePath]);
        throw insertError;
      }
      await qc.invalidateQueries({ queryKey: ["petty-cash-batches"] });
      setPettyCashDetailsBatch((current: any) =>
        current?.id === batch.id
          ? { ...current, attachments: [insertedAttachment, ...(current.attachments ?? [])] }
          : current,
      );
      toast.success("Image added to this petty-cash batch");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We could not upload that image.");
    } finally {
      setPettyCashAttachmentBusy(false);
    }
  };

  const openPettyCashBatchImage = async (attachment: any) => {
    const { data, error } = await supabase.storage
      .from("petty-cash-batch-attachments")
      .createSignedUrl(attachment.storage_path, 600);
    if (error || !data?.signedUrl) return toast.error("We could not open that image.");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const removePettyCashBatchImage = async (batch: any, attachment: any) => {
    if (!canWrite) return;
    setPettyCashAttachmentBusy(true);
    try {
      const { error: storageError } = await supabase.storage
        .from("petty-cash-batch-attachments")
        .remove([attachment.storage_path]);
      if (storageError) throw storageError;
      const { error } = await (supabase as any)
        .from("petty_cash_batch_attachments")
        .delete()
        .eq("id", attachment.id);
      if (error) throw error;
      setPettyCashDetailsBatch((current: any) => current?.id === batch.id
        ? { ...current, attachments: (current.attachments ?? []).filter((item: any) => item.id !== attachment.id) }
        : current);
      await qc.invalidateQueries({ queryKey: ["petty-cash-batches"] });
      toast.success("Image removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We could not remove that image.");
    } finally {
      setPettyCashAttachmentBusy(false);
    }
  };

  const exportPettyCashBatchExcel = async (batch: any) => {
    const attachments = await Promise.all(
      (batch.attachments ?? []).map(async (attachment: any) => {
        const { data } = await supabase.storage
          .from("petty-cash-batch-attachments")
          .createSignedUrl(attachment.storage_path, 3600);
        let image = "";
        if (data?.signedUrl) {
          try {
            const response = await fetch(data.signedUrl);
            const blob = await response.blob();
            image = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result ?? ""));
              reader.onerror = () => resolve("");
              reader.readAsDataURL(blob);
            });
          } catch { /* keep export usable when an image cannot be fetched */ }
        }
        return { name: attachment.file_name, url: data?.signedUrl ?? "", image };
      }),
    );
    const esc = (value: unknown) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] ?? char));
    const total = (batch.receipts ?? []).reduce((sum: number, receipt: any) => sum + Number(receipt.amount ?? 0), 0);
    const starting = Number(batch.funding_total ?? batch.cash_received ?? 0);
    const rows = (batch.receipts ?? []).map((receipt: any) => { const allocation = receipt.allocations?.length > 1 ? "Shared across JOs" : receipt.allocations?.[0]?.job_order?.job_number || receipt.job_order?.job_number || "Company expense"; return `<tr><td>${esc(receipt.expense_date)}</td><td>${esc([receipt.supplier_name, receipt.description, receipt.supplier_document_no ? `Document: ${receipt.supplier_document_no}` : ""].filter(Boolean).join(" ") || "—")}</td><td>${esc(allocation)}</td><td class="amount">${Number(receipt.amount ?? 0).toFixed(2)}</td></tr>`; }).join("");
    const images = attachments.filter((attachment) => attachment.image).map((attachment) => `<div><strong>${esc(attachment.name)}</strong><br><img src="${attachment.image}" style="max-width:500px;max-height:700px;"></div>`).join("");
    const balance = starting - total;
    const html = `<html><head><meta charset="utf-8"><style>body{font-family:Arial;margin:24px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #777;padding:7px;vertical-align:top;word-wrap:break-word}th{background:#e8eef5}.amount{text-align:right;width:18%}.date{width:20%}.negative{color:#c00000;font-weight:bold}h2,h3{text-align:center;margin:4px}.meta{text-align:center;margin:8px 0 16px}.summary{margin-top:16px;margin-left:auto;width:55%}.summary td:first-child{font-weight:bold}.image{max-width:640px;max-height:900px;display:block;margin:8px 0 20px}</style></head><body><h2>ARLECHINO CONCEPTS INC</h2><h3>PETTY CASH</h3><div class="meta"><b>Petty cash no.:</b> ${esc(batch.petty_cash_number)} &nbsp; <b>Custodian:</b> ${esc(batch.custodian_name)} &nbsp; <b>Report date:</b> ${esc(batch.funding_date)}</div><table><thead><tr><th class="date">DATE</th><th>PETTY CASH</th><th class="amount">AMOUNT</th></tr></thead><tbody><tr><td></td><td><b>PETTY CASH (${esc(batch.funding_date)})</b></td><td class="amount">${starting.toFixed(2)}</td></tr>${rows}</tbody></table><table class="summary"><tr><td>Total</td><td class="amount">${total.toFixed(2)}</td></tr><tr><td>Petty Cash — ${esc(batch.funding_source)}${batch.funding_reference ? ` (${esc(batch.funding_reference)})` : ""}</td><td class="amount">${starting.toFixed(2)}</td></tr><tr><td>Cash Balance</td><td class="amount ${balance < 0 ? "negative" : ""}">${balance.toFixed(2)}</td></tr></table><h3>Uploaded supporting images</h3>${images || "<p>No images uploaded.</p>"}</body></html>`;
    const printHtml = html.replace(
      "<head>",
      "<head><style>@page{size:A4 portrait;margin:12mm}body{max-width:760px;font-size:11px}table{max-width:760px;font-size:10px}th,td{padding:3px 5px;line-height:1.1}.summary{page-break-before:always;page-break-inside:avoid;break-inside:avoid;display:table}.summary tr{page-break-inside:avoid;break-inside:avoid}</style>",
    ).replace('<th class="amount">AMOUNT</th>', '<th>ALLOCATION</th><th class="amount">AMOUNT</th>');
    downloadBlob(new Blob([printHtml], { type: "text/html;charset=utf-8" }), `${batch.petty_cash_number || "petty-cash-batch"}.html`);
  };

  const addCashSale = useMutation({
    mutationFn: async (f: CashSaleFormValues) => {
      if (!canWrite) throw new Error("You do not have permission to perform this action.");
      if (!f.or_number.trim()) throw new Error("OR number is required.");
      if (!f.collection_date) throw new Error("Collection date is required.");
      if (!f.description.trim()) throw new Error("Description is required.");
      if (f.gross_amount <= 0) throw new Error("Gross amount must be greater than zero.");
      if (f.vat_amount < 0) throw new Error("VAT cannot be negative.");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase.from("cash_sales").insert({
        or_number: f.or_number.trim(),
        collection_date: f.collection_date,
        customer_name: f.customer_name.trim() || null,
        invoice_reference: f.invoice_reference.trim() || null,
        description: f.description.trim(),
        gross_amount: f.gross_amount,
        vat_amount: f.vat_amount,
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setCashSaleOpen(false);
      qc.invalidateQueries({ queryKey: ["report-cash-sales", REPORT_VERSION] });
      toast.success("Cash sale added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateVoucherDetails = useMutation({
    mutationFn: async ({
      target,
      values,
    }: {
      target: VoucherEditTarget;
      values: VoucherEditValues;
    }) => {
      if (!canWrite) throw new Error("You do not have permission to perform this action.");
      const next: VoucherFields = {
        ...target,
        supplier_name: values.supplier_name.trim() || null,
        amount: values.amount,
        description: values.description.trim(),
        check_date: values.check_date || null,
        supplier_document_no: values.supplier_document_no.trim() || null,
        check_number: values.check_number.trim() || null,
      };
      if (next.amount <= 0) throw new Error("Amount must be greater than zero.");
      if (!next.description.trim()) throw new Error("Details are required.");
      if (!next.check_number?.trim()) throw new Error("Check number is required.");
      if (!next.check_date) throw new Error("Check date is required.");
      const changes = getVoucherChanges(target, next);
      if (changes.length === 0) return;
      if (requiresVoucherCorrectionReason(target, next) && !values.correction_reason.trim()) {
        throw new Error("Correction reason is required after printing.");
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (target.voucher_printed_at) {
        const { error: revisionError } = await supabase.from("check_voucher_revisions").insert({
          job_expense_id: target.id,
          changed_by: user?.id,
          reason: values.correction_reason.trim(),
          previous_values: Object.fromEntries(
            changes.map((change) => [change.field, change.previous]),
          ),
          new_values: Object.fromEntries(changes.map((change) => [change.field, change.next])),
        });
        if (revisionError) throw revisionError;
      }
      const { error } = await supabase
        .from("job_expenses")
        .update({
          supplier_name: next.supplier_name,
          amount: next.amount,
          description: next.description,
          check_date: next.check_date,
          supplier_document_no: next.supplier_document_no,
          check_number: next.check_number,
        })
        .eq("id", target.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditingVoucher(null);
      qc.invalidateQueries({ queryKey: ["report-payables", REPORT_VERSION] });
      qc.invalidateQueries({ queryKey: ["report-voucher-revisions", REPORT_VERSION] });
      toast.success("Voucher details updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!canViewReports) {
    return (
      <AccessDenied
        title="Limited read-only access"
        description="Reports include financial data and are available to accounting, owner, and admin staff users."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Reports</h1>
          <p className="text-muted-foreground mt-1">
            Review financial performance, receivables, expenses, and operational activity.
          </p>
        </div>
        <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
          <Button
            className="w-full sm:w-auto"
            onClick={runReports}
            disabled={isRefreshing}
            variant="outline"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Run Report
          </Button>
          {isAdminScope ? (
            <Button asChild className="w-full sm:w-auto">
              <Link to="/quotes/new" search={{ customerId: undefined }}>
                <Plus className="h-4 w-4" /> New Quote
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <section aria-labelledby="reports-overview-title">
        <div className="mb-3">
          <h2 id="reports-overview-title" className="text-xl font-semibold">
            Overview
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Quick totals before you open a detailed report.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <OverviewMetric
            label="Open quotes"
            count={overviewMetrics.openQuotes.length}
            amount={overviewMetrics.openQuotes.reduce(
              (sum, quote) => sum + Number(quote.total_amount ?? 0),
              0,
            )}
            to="/quotes"
          />
          <OverviewMetric
            label="Active jobs"
            count={overviewMetrics.activeJobs.length}
            amount={overviewMetrics.activeJobs.reduce(
              (sum, job) => sum + Number(job.quoted_amount ?? 0),
              0,
            )}
            to="/reports"
            search={{ tab: "monitoring", focus: undefined }}
          />
          <OverviewMetric
            label="Unpaid invoices"
            count={overviewMetrics.unpaidInvoices.length}
            amount={overviewMetrics.unpaidInvoices.reduce(
              (sum, invoice) => sum + invoice.balance,
              0,
            )}
            to="/reports"
            search={{ tab: "receivables", focus: undefined }}
          />
          <OverviewMetric
            label="Pending expenses"
            count={overviewMetrics.pendingExpenses.length}
            amount={overviewMetrics.pendingExpenses.reduce(
              (sum, expense) => sum + Number(expense.amount ?? 0),
              0,
            )}
            to="/reports"
            search={{ tab: "payables", focus: "pending-expenses" }}
          />
        </div>
      </section>

      <Card className="reports-card p-3 sm:p-4">
        <style>{`
          @media print {
            body { background: white !important; }
            aside, header, .report-actions, .print\\:hidden { display: none !important; }
            main, .print\\:block { padding: 0 !important; margin: 0 !important; }
            .reports-card { box-shadow: none !important; border: 0 !important; }
            .report-panel { min-height: auto !important; }
          }
        `}</style>
        <Tabs
          value={activeReport}
          onValueChange={(tab) =>
            navigate({
              to: "/reports",
              search: { tab: isReportTab(tab) ? tab : "pnl", focus: undefined },
              replace: true,
              resetScroll: false,
            })
          }
        >
          <div className="mb-4 border-b pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Active report
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight">{activeReportTitle}</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  {activeReportDescription}
                </p>
              </div>
            </div>
          </div>
          <div className="report-actions mb-2 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-end">
            <div className="grid min-w-0 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="report-date-range">Date range</Label>
                <Select value={dateRangePreset} onValueChange={applyDateRangePreset}>
                  <SelectTrigger id="report-date-range" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="this-month">This month</SelectItem>
                    <SelectItem value="last-month">Last month</SelectItem>
                    <SelectItem value="this-quarter">This quarter</SelectItem>
                    <SelectItem value="year-to-date">Year to date</SelectItem>
                    <SelectItem value="all-time">All time</SelectItem>
                    <SelectItem value="custom">Custom range</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="report-date-from">From</Label>
                <Input
                  id="report-date-from"
                  type="date"
                  value={dateFrom}
                  max={dateTo}
                  aria-label="Report start date"
                  className="h-11 cursor-pointer text-base shadow-sm transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 sm:text-sm"
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setDateRangePreset("custom");
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="report-date-to">To</Label>
                <Input
                  id="report-date-to"
                  type="date"
                  value={dateTo}
                  min={dateFrom}
                  max={today}
                  aria-label="Report end date"
                  className="h-11 cursor-pointer text-base shadow-sm transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 sm:text-sm"
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setDateRangePreset("custom");
                  }}
                />
              </div>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              {activeReport !== "petty-cash" ? (
                <div className="relative min-w-0">
                  <Label htmlFor="report-search" className="sr-only">
                    Search report
                  </Label>
                  <Input
                    id="report-search"
                    value={reportSearch}
                    onChange={(e) => setReportSearch(e.target.value)}
                    placeholder="Search this report"
                    className="h-11"
                  />
                </div>
              ) : (
                <div />
              )}
              <Button
                variant="outline"
                className="h-11 w-full whitespace-nowrap"
                onClick={downloadReportCsv}
              >
                <Download className="h-4 w-4" /> Export
              </Button>
              <ReportPrimaryAction
                activeReport={activeReport}
                canWrite={canWrite}
                cashSaleOpen={cashSaleOpen}
                setCashSaleOpen={setCashSaleOpen}
                expenseOpen={expenseOpen}
                setExpenseOpen={setExpenseOpen}
                addCashSale={addCashSale}
                addGeneralExpense={addGeneralExpense}
              />
            </div>
          </div>
          <div className="report-actions mb-2 min-h-6" aria-live="polite">
            <div
              className={`inline-flex h-6 items-center gap-2 rounded-full border bg-background px-2.5 text-xs text-muted-foreground shadow-sm transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                isRefreshing ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Updating reports
            </div>
          </div>
          <div className="hidden print:block mb-4">
            <h2 className="text-xl font-semibold">{activeReportTitle}</h2>
            <p className="text-sm text-muted-foreground">
              {fmtDate(dateFrom)} to {fmtDate(dateTo)}
            </p>
          </div>
          <div className="report-actions mb-5 space-y-3">
            <div className="rounded-xl border bg-background p-2">
              <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Report area
              </div>
              <div className="grid gap-1 sm:grid-cols-4" aria-label="Report groups">
                {visibleReportGroups.map((group) => {
                  const active = group.label === activeGroup.label;

                  return (
                    <button
                      key={group.label}
                      type="button"
                      className={`min-h-10 rounded-xl px-3 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] ${
                        active
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      aria-pressed={active}
                      onClick={() =>
                        navigate({
                          to: "/reports",
                          search: { tab: group.tabs[0][0], focus: undefined },
                          replace: true,
                          resetScroll: false,
                        })
                      }
                    >
                      {group.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <TabsList
              className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-muted p-1"
              aria-label={`${activeGroup.label} reports`}
            >
              {activeGroup.tabs.map(([tab, label]) => (
                <TabsTrigger key={tab} className={REPORT_TAB_CLASS} value={tab}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="pnl" className={REPORT_PANEL_CLASS}>
            <ReportHeading title="Monthly Profit Report" />
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <SummaryCard label="Revenue" value={peso(pnl.revenue)} />
              <SummaryCard label="Expenses" value={peso(pnl.expenses)} />
              <SummaryCard
                label="Profit"
                value={peso(pnl.net)}
                tone={pnl.net >= 0 ? "good" : "bad"}
              />
            </div>
            <div className="report-table-scroll max-h-[34rem] overscroll-contain overflow-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.isLoading ||
                  payables.isLoading ||
                  historicalEntries.isLoading ||
                  historicalPnl.isLoading ? (
                    <LoadingRow colSpan={6}>Generating report...</LoadingRow>
                  ) : filteredMonthlyProfitRows.invoices.length === 0 &&
                    filteredMonthlyProfitRows.expenses.length === 0 &&
                    filteredMonthlyProfitRows.historical.length === 0 &&
                    filteredMonthlyProfitRows.historicalPnl.length === 0 ? (
                    <EmptyState colSpan={5} icon={BarChart3}>
                      No profit data for this period.
                    </EmptyState>
                  ) : (
                    <>
                      {filteredMonthlyProfitRows.historicalPnl.map((row) => (
                        <TableRow key={`historical-pnl-${row.period_start}`} className="align-top">
                          <TableCell>Historical P&amp;L</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {fmtDate(row.period_start)}
                          </TableCell>
                          <TableCell className="max-w-[320px] whitespace-normal break-words">
                            Imported monthly financial result
                          </TableCell>
                          <TableCell className="font-mono text-xs">Workbook</TableCell>
                          <TableCell
                            className={`text-right tabular-nums ${
                              Number(row.net_profit) < 0 ? "text-destructive" : ""
                            }`}
                          >
                            {Number(row.net_profit) < 0
                              ? `-${peso(Math.abs(Number(row.net_profit)))}`
                              : peso(row.net_profit)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredMonthlyProfitRows.invoices.map((invoice) => (
                        <TableRow key={`invoice-${invoice.id}`} className="align-top">
                          <TableCell>Revenue</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {fmtDate(invoice.invoice_date)}
                          </TableCell>
                          <TableCell className="max-w-[260px] whitespace-normal break-words">
                            Invoice to{" "}
                            {(invoice.customer as { customer_name: string } | null)
                              ?.customer_name ?? "Customer"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            <ReportLink to="/invoices/$id" params={{ id: invoice.id }}>
                              {invoice.invoice_number}
                            </ReportLink>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {peso(invoice.amount_due_snapshot ?? invoice.invoice_amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredMonthlyProfitRows.expenses.map((expense) => (
                        <TableRow key={`expense-${expense.id}`} className="align-top">
                          <TableCell>Expense</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {fmtDate(expense.expense_date)}
                          </TableCell>
                          <TableCell className="max-w-[320px] whitespace-normal break-words">
                            {expense.description}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {expense.reference_no || "-"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-destructive">
                            -{peso(expense.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredMonthlyProfitRows.historical.map((entry) => (
                        <TableRow key={`historical-${entry.id}`} className="align-top">
                          <TableCell>
                            {entry.entry_type === "revenue"
                              ? "Historical revenue"
                              : "Historical expense"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {fmtDate(entry.entry_date)}
                          </TableCell>
                          <TableCell className="max-w-[320px]">
                            <span
                              className="block max-w-[320px] truncate"
                              title={entry.description || entry.counterparty_name}
                            >
                              {entry.description || entry.counterparty_name}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {entry.reference_no || entry.document_no || "-"}
                          </TableCell>
                          <TableCell
                            className={`text-right tabular-nums ${
                              entry.entry_type === "expense" ? "text-destructive" : ""
                            }`}
                          >
                            {entry.entry_type === "expense"
                              ? `-${peso(entry.gross_amount)}`
                              : peso(entry.gross_amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="disbursements" className={REPORT_PANEL_CLASS}>
            <ReportHeading title="Check Disbursements" />
            <div className="mb-4 grid max-w-xl grid-cols-2 gap-3">
              <Card className="min-w-0 p-3">
                <div className="text-xs text-muted-foreground">Checks issued</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">
                  {disbursements.length}
                </div>
              </Card>
              <Card className="min-w-0 p-3">
                <div className="text-xs text-muted-foreground">Total checks issued</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">
                  {peso(
                    disbursements.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
                  )}
                </div>
              </Card>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              This is a history of expenses paid by check. When Finance records a check payment on a
              General Expense, it automatically appears here; no duplicate entry is needed.
            </p>
            <div className="space-y-3 md:hidden">
              {payables.isLoading || historicalEntries.isLoading ? (
                <Card className="p-4 text-sm text-muted-foreground">Generating report...</Card>
              ) : filteredDisbursements.length === 0 &&
                visibleHistoricalDisbursements.length === 0 ? (
                <Card className="p-4 text-sm text-muted-foreground">
                  No check disbursements for this period.
                </Card>
              ) : (
                <>
                  {filteredDisbursements.map((p) => (
                    <CheckDisbursementCard
                      key={p.id}
                      expense={p}
                      tab={activeReport}
                      onEdit={
                        canWrite
                          ? () =>
                              setEditingVoucher({
                                id: p.id,
                                supplier_name: p.supplier_name,
                                amount: Number(p.amount || 0),
                                description: p.description,
                                check_date: p.check_date,
                                supplier_document_no: p.supplier_document_no,
                                check_number: p.check_number,
                                voucher_printed_at: p.voucher_printed_at,
                                voucher_print_count: Number(p.voucher_print_count ?? 0),
                              })
                          : undefined
                      }
                    />
                  ))}
                  {visibleHistoricalDisbursements.map((entry) => (
                    <Card key={`historical-disbursement-${entry.id}`} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium">
                            {entry.counterparty_name || "Historical financial record"}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {entry.description || "Imported check record"}
                          </div>
                        </div>
                        <div className="shrink-0 text-right font-medium tabular-nums">
                          {peso(entry.gross_amount)}
                        </div>
                      </div>
                      <div className="mt-3 text-sm text-muted-foreground">
                        Paid {fmtDate(entry.entry_date)}
                      </div>
                    </Card>
                  ))}
                </>
              )}
            </div>
            <div className="report-table-scroll -mx-3 hidden max-h-[34rem] max-w-full overscroll-contain overflow-x-auto overflow-y-auto px-3 md:mx-0 md:block md:px-0">
              <table className="w-full min-w-[940px] caption-bottom text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead>Paid date</TableHead>
                    <TableHead>Expense</TableHead>
                    <TableHead>Payee</TableHead>
                    <TableHead>Check details</TableHead>
                    <TableHead>Project use</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right report-actions">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payables.isLoading || historicalEntries.isLoading ? (
                    <LoadingRow colSpan={7}>Generating report...</LoadingRow>
                  ) : filteredDisbursements.length === 0 &&
                    visibleHistoricalDisbursements.length === 0 ? (
                    <EmptyState colSpan={7} icon={Receipt}>
                      No check disbursements for this period.
                    </EmptyState>
                  ) : (
                    <>
                      {filteredDisbursements.map((p) => (
                        <TableRow key={p.id} className="align-top">
                          <TableCell className="text-sm text-muted-foreground">
                            {fmtDate(p.paid_at ?? p.expense_date)}
                          </TableCell>
                          <TableCell className="max-w-[300px] whitespace-normal break-words">
                            <ExpenseDescription expense={p} />
                            <div className="mt-1 text-xs text-muted-foreground">
                              {categoryLabel(p.disbursement_category)}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[220px] whitespace-normal break-words">
                            <div className="font-medium">
                              {p.supplier_name || "No payee recorded"}
                            </div>
                            {p.disbursement_subcategory ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {subcategoryLabel(p.disbursement_subcategory)}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="min-w-[180px] text-sm">
                            <div className="font-medium">
                              Check #{p.check_number || "Not recorded"}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {[
                                p.payment_source,
                                fmtDate(p.check_date ?? p.paid_at ?? p.expense_date),
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[220px] whitespace-normal break-words">
                            {p.job_order_id ? (
                              <ReportLink to="/jobs/$id" params={{ id: p.job_order_id }}>
                                {p.job_order
                                  ? `${(p.job_order as { job_number: string; project_name: string }).job_number} · ${(p.job_order as { job_number: string; project_name: string }).project_name}`
                                  : "View Job Order"}
                              </ReportLink>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                Arlechino company expense
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <div>{peso(p.amount)}</div>
                            {Number(p.tax_amount ?? 0) > 0 ? (
                              <div className="text-xs text-muted-foreground">
                                Tax {peso(p.tax_amount)}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right report-actions">
                            <PrintExpenseLinks
                              id={p.id}
                              tab={activeReport}
                              onEdit={
                                canWrite
                                  ? () =>
                                      setEditingVoucher({
                                        id: p.id,
                                        supplier_name: p.supplier_name,
                                        amount: Number(p.amount || 0),
                                        description: p.description,
                                        check_date: p.check_date,
                                        supplier_document_no: p.supplier_document_no,
                                        check_number: p.check_number,
                                        voucher_printed_at: p.voucher_printed_at,
                                        voucher_print_count: Number(p.voucher_print_count ?? 0),
                                      })
                                  : undefined
                              }
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                      {visibleHistoricalDisbursements.map((entry) => (
                        <TableRow key={`historical-disbursement-${entry.id}`} className="align-top">
                          <TableCell className="text-sm text-muted-foreground">
                            {fmtDate(entry.entry_date)}
                          </TableCell>
                          <TableCell className="max-w-[300px] whitespace-normal break-words">
                            <div>{entry.description || "Historical financial record"}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Imported record
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[220px] whitespace-normal break-words">
                            <div className="font-medium">
                              {entry.counterparty_name || "No payee recorded"}
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[180px] text-xs text-muted-foreground">
                            {entry.reference_no
                              ? `Voucher / ref: ${entry.reference_no}`
                              : "Check details unavailable"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            Imported record
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {peso(entry.gross_amount)}
                          </TableCell>
                          <TableCell className="text-right report-actions">-</TableCell>
                        </TableRow>
                      ))}
                    </>
                  )}
                </TableBody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="profit" className={REPORT_PANEL_CLASS}>
            <ReportHeading title="Project Profitability" />
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Select value={profitabilityFilter} onValueChange={(value) => setProfitabilityFilter(value as typeof profitabilityFilter)}>
                <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  <SelectItem value="with-costs">With costs</SelectItem>
                  <SelectItem value="no-costs">No costs yet</SelectItem>
                  <SelectItem value="profitable">Profitable</SelectItem>
                  <SelectItem value="loss">Needs attention</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">{filteredProfitability.length} projects</span>
            </div>
            <div className="report-table-scroll max-h-[34rem] overscroll-contain overflow-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Result</TableHead>
                    <TableHead>Last cost recorded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profit.isLoading ? (
                    <LoadingRow colSpan={5}>Generating report...</LoadingRow>
                  ) : profit.isError ? (
                    <EmptyState colSpan={6} icon={AlertCircle}>
                      {reportError(profit.error)}
                    </EmptyState>
                  ) : (profit.data ?? []).length === 0 ? (
                    <EmptyState colSpan={6} icon={BarChart3}>
                      No projects have reportable revenue yet. Create or approve a Job Order, then
                      return here to review its margin.
                    </EmptyState>
                  ) : filteredProfitability.length === 0 ? (
                    <EmptyState colSpan={6} icon={Search}>
                      No projects match this search. Clear the search or try a Job Order number,
                      project, or customer.
                    </EmptyState>
                  ) : (
                    filteredProfitability.map((j) => (
                        <TableRow
                          key={j.id}
                          {...clickableRowProps(`View profitability for ${j.job_number}`, () =>
                            setProfitabilityDetail(j),
                          )}
                        >
                          <TableCell className="max-w-[320px] whitespace-normal break-words">
                            <div className="font-medium">
                              <ReportLink to="/jobs/$id" params={{ id: j.id }}>
                                {j.project_name}
                              </ReportLink>
                            </div>
                            <div className="mt-1 font-mono text-xs text-muted-foreground">
                              {j.job_number}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[180px] whitespace-normal">
                            <CustomerLink customer={j.customer} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {peso(j.quoted_amount)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {peso(j.expenses)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <AmountStack
                              primary={peso(j.profit)}
                              secondary={`${j.margin.toFixed(1)}% margin`}
                              tone={j.profit >= 0 ? "good" : "bad"}
                            />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {fmtDateTime(j.lastCostRecordedAt)}
                          </TableCell>
                        </TableRow>
                      ))
                  )}
                </TableBody>
              </Table>
            </div>
            <Dialog
              open={Boolean(profitabilityDetail)}
              onOpenChange={(open) => !open && setProfitabilityDetail(null)}
            >
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Project profitability details</DialogTitle>
                </DialogHeader>
                {profitabilityDetail ? (
                  <div className="max-h-[78vh] space-y-4 overflow-y-auto pr-2">
                    <div>
                      <div className="font-medium">{profitabilityDetail.project_name}</div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        {profitabilityDetail.job_number}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/20 p-4 text-sm">
                      <div>
                        <div className="text-muted-foreground">Revenue</div>
                        <div className="font-medium tabular-nums">
                          {peso(profitabilityDetail.quoted_amount)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Cost</div>
                        <div className="font-medium tabular-nums">
                          {peso(profitabilityDetail.expenses)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Result</div>
                        <div
                          className={`font-medium tabular-nums ${profitabilityDetail.profit < 0 ? "text-destructive" : "text-success"}`}
                        >
                          {peso(profitabilityDetail.profit)}
                          <div className="text-xs font-normal text-muted-foreground">
                            {Number(profitabilityDetail.margin ?? 0).toFixed(1)}% margin
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Revenue is the approved Job Order amount. Cost includes only
                      Operations-confirmed direct costs and confirmed shares of General Expenses.
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-md border p-3 text-sm">
                        <div className="font-medium">Petty cash</div>
                        <div className="mt-2 space-y-1 text-muted-foreground">
                          <div className="flex items-start justify-between gap-3 font-medium text-foreground">
                            <span>Spent</span>
                            <span className="shrink-0 tabular-nums">
                              {peso(Number(profitabilityDetail.pettyCashSpent ?? 0))}
                            </span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span>Released to JO</span>
                            <span className="shrink-0 tabular-nums">
                              {peso(Number(profitabilityDetail.pettyCashReleased ?? 0))}
                            </span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span>Remaining</span>
                            <span className="shrink-0 tabular-nums">
                              {profitabilityDetail.pettyCashBalance == null ||
                              Number(profitabilityDetail.pettyCashBalance) < 0
                                ? "—"
                                : peso(Number(profitabilityDetail.pettyCashBalance))}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 inline-flex rounded-full border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          {profitabilityDetail.pettyCashBalance == null
                            ? "Shared batch"
                            : "Assigned batch"}
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {profitabilityDetail.pettyCashBalance == null
                            ? "This receipt is charged to the JO, but the cash advance covers multiple projects."
                            : "This cash advance is assigned to this JO."}
                        </p>
                      </div>
                      <div className="rounded-md border p-3 text-sm">
                        <div className="font-medium">Cost by category</div>
                        <div className="mt-2 space-y-1 text-muted-foreground">
                          {Object.entries(profitabilityDetail.expenseBreakdown ?? {}).map(
                            ([category, amount]) => (
                              <div key={category} className="flex justify-between gap-3">
                                <span>{category}</span>
                                <span className="tabular-nums">{peso(Number(amount))}</span>
                              </div>
                            ),
                          )}
                          {!Object.keys(profitabilityDetail.expenseBreakdown ?? {}).length ? (
                            <span>No confirmed costs yet.</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="rounded-md border p-3 text-sm">
                        <div className="font-medium">Cost by payment source</div>
                        <div className="mt-2 space-y-1 text-muted-foreground">
                          {Object.entries(profitabilityDetail.paymentSourceBreakdown ?? {}).map(
                            ([source, amount]) => (
                              <div key={source} className="flex justify-between gap-3">
                                <span>{source}</span>
                                <span className="tabular-nums">{peso(Number(amount))}</span>
                              </div>
                            ),
                          )}
                          {!Object.keys(profitabilityDetail.paymentSourceBreakdown ?? {}).length ? (
                            <span>No payment sources recorded.</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">What changed</div>
                      <div className="rounded-md border p-3">
                        <div className="relative space-y-3 pl-5 text-sm before:absolute before:bottom-2 before:left-[6px] before:top-2 before:w-px before:bg-border">
                          <div className="relative">
                            <span className="absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />
                            <div className="font-medium">Project added</div>
                            <div className="text-xs text-muted-foreground">Revenue is the approved Job Order amount.</div>
                          </div>
                          {profitabilityDetail.expenseTrail.length === 0 ? (
                            <div className="relative">
                              <span className="absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full bg-muted-foreground ring-2 ring-background" />
                              <div className="font-medium">No costs recorded yet</div>
                              <div className="text-xs text-muted-foreground">Confirmed project costs will appear here.</div>
                            </div>
                          ) : (
                            profitabilityDetail.expenseTrail.slice(0, 5).map((expense: any) => (
                              <div className="relative" key={`timeline-${expense.id}-${expense.recordedAt}`}>
                                <span className="absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
                                <div className="font-medium">Cost recorded · {peso(expense.amount)}</div>
                                <div className="text-xs text-muted-foreground">{fmtDateTime(expense.recordedAt)} · {expense.description}</div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Allocated cost trail</div>
                      {profitabilityDetail.expenseTrail.length === 0 ? (
                        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                          No confirmed project costs yet. General expenses remain outside this
                          result until their allocation is confirmed.
                        </p>
                      ) : (
                        <div className="max-h-52 overflow-auto rounded-md border">
                          {profitabilityDetail.expenseTrail.map((expense: any) => (
                            <div
                              key={`${expense.id}-${expense.amount}`}
                              className="flex items-start justify-between gap-3 border-b p-3 last:border-b-0"
                            >
                              <div className="min-w-0 text-sm">
                                <div className="truncate font-medium">{expense.description}</div>
                                <div className="mt-0.5 text-xs text-muted-foreground">
                                  {[expense.date, expense.supplier, expense.reference]
                                    .filter(Boolean)
                                    .join(" · ")}
                                  <span className="block">
                                    Recorded {fmtDateTime(expense.recordedAt)}
                                  </span>
                                  {[expense.category, expense.paymentSource, expense.document]
                                    .filter(Boolean)
                                    .join(" · ")}
                                  {expense.isShared ? " · Confirmed share" : ""}
                                </div>
                              </div>
                              <div className="shrink-0 text-sm font-medium tabular-nums">
                                {peso(expense.amount)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setProfitabilityDetail(null)}>
                        Close
                      </Button>
                      <Button
                        onClick={() =>
                          navigate({ to: "/jobs/$id", params: { id: profitabilityDetail.id } })
                        }
                      >
                        Open Job Order
                      </Button>
                    </DialogFooter>
                  </div>
                ) : null}
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="monitoring" className={REPORT_PANEL_CLASS}>
            <ReportHeading title="Project Monitoring" />
            <div className="report-table-scroll max-h-[34rem] overscroll-contain overflow-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Quoted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profit.isLoading ? (
                    <LoadingRow colSpan={4}>Generating report...</LoadingRow>
                  ) : profit.isError ? (
                    <EmptyState colSpan={4} icon={AlertCircle}>
                      {reportError(profit.error)}
                    </EmptyState>
                  ) : (profit.data ?? []).length === 0 ? (
                    <EmptyState colSpan={4} icon={ClipboardList}>
                      No job orders found.
                    </EmptyState>
                  ) : (
                    profit
                      .data!.filter((j) =>
                        matchesReportSearch(
                          j.project_name,
                          j.job_number,
                          j.customer?.customer_name,
                          j.status,
                        ),
                      )
                      .map((j) => (
                        <TableRow
                          key={j.id}
                          {...clickableRowProps(`Open job order ${j.job_number}`, () =>
                            navigate({ to: "/jobs/$id", params: { id: j.id } }),
                          )}
                        >
                          <TableCell className="max-w-[360px] whitespace-normal break-words">
                            <div className="font-medium">
                              <ReportLink to="/jobs/$id" params={{ id: j.id }}>
                                {j.project_name}
                              </ReportLink>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <span className="font-mono">{j.job_number}</span>
                              <span>Target {fmtDate(j.target_completion_date)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[220px] whitespace-normal">
                            <CustomerLink customer={j.customer} />
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1.5">
                              <StatusBadge status={j.status} />
                              <TaxPill taxType={j.tax_type} />
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {peso(j.quoted_amount)}
                          </TableCell>
                        </TableRow>
                      ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="quotes" className={REPORT_PANEL_CLASS}>
            <ReportHeading title="Quote History" />
            <div className="report-table-scroll max-h-[34rem] overscroll-contain overflow-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotes.isLoading ? (
                    <LoadingRow colSpan={4}>Generating report...</LoadingRow>
                  ) : quotes.isError ? (
                    <EmptyState colSpan={4} icon={AlertCircle}>
                      {reportError(quotes.error)}
                    </EmptyState>
                  ) : (quotes.data ?? []).length === 0 ? (
                    <EmptyState colSpan={4} icon={FileText}>
                      No report data available.
                    </EmptyState>
                  ) : (
                    quotes
                      .data!.filter((q) =>
                        matchesReportSearch(
                          q.project_name,
                          q.quote_number,
                          q.customer?.customer_name,
                          q.status,
                        ),
                      )
                      .map((q) => (
                        <TableRow
                          key={q.id}
                          {...clickableRowProps(`Open quote ${q.quote_number}`, () =>
                            navigate({ to: "/quotes/$id", params: { id: q.id } }),
                          )}
                        >
                          <TableCell className="max-w-[360px] whitespace-normal break-words">
                            <div className="font-medium">
                              <ReportLink to="/quotes/$id" params={{ id: q.id }}>
                                {q.project_name}
                              </ReportLink>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <span className="font-mono">{q.quote_number}</span>
                              <span>{fmtDate(q.quote_date)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[180px] whitespace-normal">
                            <CustomerLink customer={q.customer} />
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={q.status} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {peso(computeQuoteDisplayTotal(q))}
                          </TableCell>
                        </TableRow>
                      ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="invoices" className={REPORT_PANEL_CLASS}>
            <ReportHeading title="Invoice Report" />
            <div className="report-table-scroll max-h-[34rem] overscroll-contain overflow-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.isLoading ? (
                    <LoadingRow colSpan={4}>Generating report...</LoadingRow>
                  ) : invoices.isError ? (
                    <EmptyState colSpan={4} icon={AlertCircle}>
                      {reportError(invoices.error)}
                    </EmptyState>
                  ) : (invoices.data ?? []).length === 0 ? (
                    <EmptyState colSpan={4} icon={Receipt}>
                      No report data available.
                    </EmptyState>
                  ) : (
                    invoices
                      .data!.filter((i) =>
                        matchesReportSearch(
                          i.invoice_number,
                          i.customer?.customer_name,
                          i.job_order?.project_name,
                        ),
                      )
                      .map((i) => (
                        <TableRow
                          key={i.id}
                          {...clickableRowProps(`Open invoice ${i.invoice_number}`, () =>
                            navigate({ to: "/invoices/$id", params: { id: i.id } }),
                          )}
                        >
                          <TableCell className="max-w-[360px] whitespace-normal break-words">
                            <div className="font-medium">
                              <JobLink job={i.job_order} />
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <ReportLink to="/invoices/$id" params={{ id: i.id }}>
                                {i.invoice_number}
                              </ReportLink>
                              <span>{fmtDate(i.invoice_date)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <CustomerLink customer={i.customer} />
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1.5">
                              <StatusBadge status={i.status} />
                              <TaxPill taxType={i.tax_type} />
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {peso(i.amount_due_snapshot ?? i.invoice_amount)}
                          </TableCell>
                        </TableRow>
                      ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="cash-sales" className={REPORT_PANEL_CLASS}>
            <ReportHeading title="Cash sales" />
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <SummaryCard
                label="Cash sales"
                value={currentCashSales.length + historicalRevenue.length}
              />
              <SummaryCard
                label="Total received"
                value={peso(
                  currentCashSales.reduce(
                    (sum, entry) => sum + Number(entry.gross_amount || 0),
                    0,
                  ) +
                    historicalRevenue.reduce(
                      (sum, entry) => sum + Number(entry.gross_amount || 0),
                      0,
                    ),
                )}
              />
            </div>
            <div className="report-table-scroll max-h-[34rem] overscroll-contain overflow-auto">
              <Table className="min-w-[980px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer / Company</TableHead>
                    <TableHead>Details / Address</TableHead>
                    <TableHead>Documents</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cashSales.isLoading || historicalEntries.isLoading ? (
                    <LoadingRow colSpan={5}>Generating report...</LoadingRow>
                  ) : cashSales.isError || historicalEntries.isError ? (
                    <EmptyState colSpan={5} icon={AlertCircle}>
                      {reportError(cashSales.error ?? historicalEntries.error)}
                    </EmptyState>
                  ) : currentCashSales.length === 0 && historicalRevenue.length === 0 ? (
                    <EmptyState colSpan={5} icon={Receipt}>
                      No cash sales found for this period.
                    </EmptyState>
                  ) : (
                    filteredCashSaleRows.map((entry) => (
                      <TableRow key={`cash-sale-${entry.id}`} className="align-top">
                        <TableCell className="text-sm text-muted-foreground">
                          {fmtDate(entry.date)}
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <span className="block max-w-[220px] truncate" title={entry.company}>
                            {entry.company}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[320px]">
                          <span
                            className="block max-w-[320px] truncate"
                            title={entry.address || undefined}
                          >
                            {entry.address || "-"}
                          </span>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              {entry.source}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="min-w-[180px] font-mono text-xs leading-6">
                          <DocumentLine label="OR/Inv" value={entry.reference} />
                          <DocumentLine label="TIN" value={entry.tin} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <AmountStack
                            primary={peso(entry.gross_amount)}
                            secondary={`VAT ${peso(entry.vat_amount)} · EWT ${peso(entry.ewt_amount)}`}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="receivables" className={REPORT_PANEL_CLASS}>
            <ReportHeading title="Receivables" />
            <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Current", agingTotals.current],
                ["1-30", agingTotals.days1to30],
                ["31-60", agingTotals.days31to60],
                ["61-90", agingTotals.days61to90],
                ["90+", agingTotals.over90],
                ["Open balance", agingTotals.balance],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border bg-muted/20 px-3 py-2">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="mt-1 font-medium tabular-nums">{peso(Number(value))}</div>
                </div>
              ))}
            </div>
            <div className="report-table-scroll max-h-[34rem] overscroll-contain overflow-auto">
              <Table className="min-w-[1060px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Invoice date</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead>Aging</TableHead>
                    <TableHead className="text-right">Original</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Open balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.isLoading ? (
                    <LoadingRow colSpan={8}>Generating report...</LoadingRow>
                  ) : invoices.isError ? (
                    <EmptyState colSpan={8} icon={AlertCircle}>
                      {reportError(invoices.error)}
                    </EmptyState>
                  ) : filteredReceivables.length === 0 ? (
                    <EmptyState colSpan={8} icon={Receipt}>
                      No invoices found.
                    </EmptyState>
                  ) : (
                    agingGroups.flatMap((group) => [
                      <TableRow
                        key={`customer-${group.customer.id}`}
                        className="bg-muted/20 font-medium"
                      >
                        <TableCell colSpan={5}>
                          {group.customer.customer_name ?? "Unknown customer"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {peso(
                            group.invoices.reduce((sum, invoice) => sum + invoice.amountDue, 0),
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {peso(
                            group.invoices.reduce((sum, invoice) => sum + invoice.amountPaid, 0),
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {peso(group.invoices.reduce((sum, invoice) => sum + invoice.balance, 0))}
                        </TableCell>
                      </TableRow>,
                      ...group.invoices.map((i) => (
                        <TableRow key={i.id} className="align-top">
                          <TableCell className="max-w-[180px] whitespace-normal">
                            {group.customer.customer_name ?? "Unknown customer"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            <div className="font-mono text-xs">
                              <ReportLink to="/invoices/$id" params={{ id: i.id }}>
                                {i.invoice_number}
                              </ReportLink>
                            </div>
                          </TableCell>
                          <TableCell>{fmtDate(i.invoice_date)}</TableCell>
                          <TableCell>{fmtDate(i.due_date)}</TableCell>
                          <TableCell>
                            <div>{agingBucketLabel(i.due_date)}</div>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <StatusBadge status={i.derivedStatus} />
                              <TaxPill taxType={i.tax_type} />
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <AmountStack primary={peso(i.amountDue ?? i.invoice_amount)} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {peso(i.amountPaid)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {peso(i.balance)}
                          </TableCell>
                        </TableRow>
                      )),
                    ])
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="petty-cash" className={REPORT_PANEL_CLASS}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <ReportHeading title="Petty cash" />
              {canWrite ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setExpenseImportContext("petty-cash");
                      setExpenseImportBatchId("none");
                      setExpenseImportOpen(true);
                    }}
                  >
                    Import cash batch
                  </Button>
                  <Button onClick={() => setPettyCashOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    New petty cash batch
                  </Button>
                </div>
              ) : null}
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Track one cash advance and settle all its receipts with one CV.
            </p>
            <Dialog open={pettyCashOpen} onOpenChange={setPettyCashOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {editingPettyCashBatch ? "Edit petty cash batch" : "New petty cash batch"}
                  </DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Custodian *</Label>
                    <Input
                      value={pettyCashForm.custodian_name}
                      onChange={(e) =>
                        setPettyCashForm({ ...pettyCashForm, custodian_name: e.target.value })
                      }
                      placeholder="e.g. Ma’am Jane"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Cash received *</Label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={pettyCashForm.cash_received}
                      onChange={(e) =>
                        setPettyCashForm({ ...pettyCashForm, cash_received: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Funding date *</Label>
                    <Input
                      type="date"
                      value={pettyCashForm.funding_date}
                      onChange={(e) =>
                        setPettyCashForm({ ...pettyCashForm, funding_date: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Funding source *</Label>
                    <Select
                      value={pettyCashForm.funding_source}
                      onValueChange={(value) =>
                        setPettyCashForm({ ...pettyCashForm, funding_source: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose funding source" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BDO">BDO</SelectItem>
                        <SelectItem value="GCash">GCash</SelectItem>
                        <SelectItem value="Bank transfer">Bank transfer</SelectItem>
                        <SelectItem value="Cash">Cash</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    {pettyCashForm.funding_source === "Other" ? (
                      <Input
                        value={pettyCashCustomFundingSource}
                        onChange={(e) => setPettyCashCustomFundingSource(e.target.value)}
                        placeholder="Type funding source"
                        aria-label="Custom funding source"
                      />
                    ) : null}
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Job Order (optional)</Label>
                    <Select
                      value={pettyCashForm.job_order_id || "unassigned"}
                      onValueChange={(value) =>
                        setPettyCashForm({
                          ...pettyCashForm,
                          job_order_id: value === "unassigned" ? "" : value,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Shared / general cash" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Shared / general cash</SelectItem>
                        {(jobOrderLookup.data ?? []).map((job: any) => (
                          <SelectItem key={job.id} value={job.id}>
                            {job.job_number} · {job.project_name}
                            {job.customer?.customer_name ? ` · ${job.customer.customer_name}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Assign this only when the whole advance is for one Job Order. Leave it shared
                      when receipts cover multiple projects.
                    </p>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Funding reference *</Label>
                    <Input
                      value={pettyCashForm.funding_reference}
                      onChange={(e) =>
                        setPettyCashForm({ ...pettyCashForm, funding_reference: e.target.value })
                      }
                      placeholder="Online transfer reference"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPettyCashOpen(false);
                      setEditingPettyCashBatch(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button onClick={() => void createPettyCashBatch()}>
                    {editingPettyCashBatch ? "Save changes" : "Create batch"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog
              open={Boolean(pettyCashCvBatch)}
              onOpenChange={(open) => !open && setPettyCashCvBatch(null)}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create one CV</DialogTitle>
                </DialogHeader>
                {pettyCashCvBatch ? (
                  <div className="space-y-3 text-sm">
                    <p>
                      This CV will be for <strong>{peso(pettyCashCvBatch.cash_received)}</strong>,
                      not the receipt total.
                    </p>
                    <div className="rounded-md border bg-muted/20 p-3">
                      Receipts: {peso(pettyCashCvBatch.receipts_total)} ·{" "}
                      {pettyCashCvBatch.receipt_count} receipts
                    </div>
                    <Label>CV reference number *</Label>
                    <Input
                      value={pettyCashCvReference}
                      onChange={(e) => setPettyCashCvReference(e.target.value)}
                      placeholder="Enter the CV number"
                    />
                  </div>
                ) : null}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setPettyCashCvBatch(null)}>
                    Cancel
                  </Button>
                  <Button onClick={() => void createPettyCashCv()}>Record CV</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog
              open={Boolean(pettyCashSettlementBatch)}
              onOpenChange={(open) => !open && setPettyCashSettlementBatch(null)}
            >
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Settle petty-cash batch</DialogTitle>
                </DialogHeader>
                {pettyCashSettlementBatch
                  ? (() => {
                      const funding = Number(
                        pettyCashSettlementBatch.funding_total ??
                          pettyCashSettlementBatch.cash_received ??
                          0,
                      );
                      const receipts = Number(pettyCashSettlementBatch.receipts_total ?? 0);
                      const remaining = funding - receipts;
                      return (
                        <div className="space-y-4">
                          <div className="rounded-md border bg-muted/20 p-3 text-sm">
                            <div className="flex justify-between gap-3">
                              <span className="text-muted-foreground">Cash funded</span>
                              <span className="font-medium tabular-nums">{peso(funding)}</span>
                            </div>
                            <div className="mt-2 flex justify-between gap-3">
                              <span className="text-muted-foreground">Paid receipts</span>
                              <span className="font-medium tabular-nums">{peso(receipts)}</span>
                            </div>
                            <div className="mt-2 flex justify-between gap-3 border-t pt-2">
                              <span className="font-medium">Cash to return</span>
                              <span
                                className={`font-medium tabular-nums ${remaining < 0 ? "text-destructive" : ""}`}
                              >
                                {remaining < 0
                                  ? `${peso(Math.abs(remaining))} over by`
                                  : peso(remaining)}
                              </span>
                            </div>
                          </div>
                          {remaining < 0 ? (
                            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                              Receipts are higher than available cash. Add the missing cash or
                              correct a receipt before closing.
                            </p>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              Confirm the returned cash against its physical receipt. Closing locks
                              this batch and makes it ready for one CV.
                            </p>
                          )}
                          <div className="space-y-2">
                            <Label>Cash returned *</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={pettyCashSettlementForm.cash_returned_amount}
                              onChange={(event) =>
                                setPettyCashSettlementForm({
                                  ...pettyCashSettlementForm,
                                  cash_returned_amount: event.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Return reference <span className="font-normal text-muted-foreground">(optional)</span></Label>
                            <Input
                              value={pettyCashSettlementForm.cash_returned_reference}
                              onChange={(event) =>
                                setPettyCashSettlementForm({
                                  ...pettyCashSettlementForm,
                                  cash_returned_reference: event.target.value,
                                })
                              }
                              placeholder="Receipt, acknowledgment, or deposit reference"
                            />
                          </div>
                        </div>
                      );
                    })()
                  : null}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setPettyCashSettlementBatch(null)}>
                    Cancel
                  </Button>
                  <Button onClick={() => void settleAndClosePettyCashBatch()}>
                    Settle and close
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog
              open={Boolean(pettyCashDetailsBatch)}
              onOpenChange={(open) => !open && setPettyCashDetailsBatch(null)}
            >
              <DialogContent className="max-h-[calc(100dvh-2rem)] min-w-0 max-w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto sm:max-w-4xl">
                <DialogHeader>
                  <DialogTitle>Petty cash batch</DialogTitle>
                </DialogHeader>
                {pettyCashDetailsBatch
                  ? (() => {
                      const difference =
                        Number(
                          pettyCashDetailsBatch.funding_total ??
                            pettyCashDetailsBatch.cash_received,
                        ) - pettyCashDetailsBatch.receipts_total;
                      const cashReturned = Number(pettyCashDetailsBatch.cash_returned_amount ?? 0);
                      return (
                        <div className="space-y-4">
                          <div className="grid gap-3 rounded-md border bg-muted/20 p-4 text-sm sm:grid-cols-4">
                            <div>
                              <div className="text-muted-foreground">Custodian</div>
                              <div className="font-medium">
                                {pettyCashDetailsBatch.custodian_name}
                              </div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Cash received</div>
                              <div className="font-medium">
                                {peso(
                                  pettyCashDetailsBatch.funding_total ??
                                    pettyCashDetailsBatch.cash_received,
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Receipts recorded</div>
                              <div className="font-medium">
                                {peso(pettyCashDetailsBatch.receipts_total)} ·{" "}
                                {pettyCashDetailsBatch.receipt_count}
                              </div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">
                                {pettyCashDetailsBatch.status === "open"
                                  ? "Cash to return"
                                  : "Cash returned"}
                              </div>
                              <div
                                className={`font-medium ${difference < 0 ? "text-destructive" : ""}`}
                              >
                                {pettyCashDetailsBatch.status === "open"
                                  ? difference >= 0
                                    ? `${peso(difference)} to return`
                                    : `${peso(Math.abs(difference))} overage`
                                  : cashReturned > 0
                                    ? peso(cashReturned)
                                    : "Reconciled"}
                              </div>
                            </div>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {pettyCashDetailsBatch.funding_source} ·{" "}
                            {pettyCashDetailsBatch.funding_reference} · funded{" "}
                            {fmtDate(pettyCashDetailsBatch.funding_date)}
                          </div>
                          <div className="flex justify-end">
                            <Button
                              variant="outline"
                              onClick={() => {
                                setEditingPettyCashBatch(pettyCashDetailsBatch);
                                setPettyCashForm({
                                  custodian_name: pettyCashDetailsBatch.custodian_name ?? "",
                                  cash_received: String(pettyCashDetailsBatch.cash_received ?? ""),
                                  funding_date:
                                    pettyCashDetailsBatch.funding_date ??
                                    dateInputValue(new Date()),
                                  funding_source: pettyCashDetailsBatch.funding_source ?? "",
                                  funding_reference: pettyCashDetailsBatch.funding_reference ?? "",
                                  job_order_id: pettyCashDetailsBatch.job_order_id ?? "",
                                });
                                setPettyCashDetailsBatch(null);
                                setPettyCashOpen(true);
                              }}
                            >
                              Edit batch details
                            </Button>
                          </div>
                          <div className="rounded-md border p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <div className="font-medium">Batch images</div>
                                <p className="text-sm text-muted-foreground">
                                  Keep scans or photos with this cash advance. Images open at full
                                  size in a new tab.
                                </p>
                              </div>
                              {canWrite ? (
                                <Label
                                  htmlFor={`petty-cash-batch-image-${pettyCashDetailsBatch.id}`}
                                  className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/40"
                                >
                                  <Upload className="h-4 w-4" />
                                  {pettyCashAttachmentBusy ? "Uploading…" : "Upload image"}
                                  <Input
                                    id={`petty-cash-batch-image-${pettyCashDetailsBatch.id}`}
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    className="sr-only"
                                    disabled={pettyCashAttachmentBusy}
                                    onChange={(event) => {
                                      const file = event.target.files?.[0];
                                      event.currentTarget.value = "";
                                      if (file)
                                        void uploadPettyCashBatchImage(pettyCashDetailsBatch, file);
                                    }}
                                  />
                                </Label>
                              ) : null}
                            </div>
                            {pettyCashDetailsBatch.attachments?.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {pettyCashDetailsBatch.attachments.map((attachment: any) => (
                                  <div key={attachment.id} className="group relative flex items-center gap-1">
                                    <Button type="button" variant="outline" size="sm" onClick={() => void openPettyCashBatchImage(attachment)}>
                                      {attachment.file_name}
                                    </Button>
                                    {canWrite ? <Button type="button" variant="ghost" size="icon" className="absolute -right-2 -top-2 z-10 h-6 w-6 rounded-full border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100" aria-label={`Remove ${attachment.file_name}`} title="Remove image" disabled={pettyCashAttachmentBusy} onClick={() => setPettyCashAttachmentToRemove({ batch: pettyCashDetailsBatch, attachment })}><X className="h-3.5 w-3.5" /></Button> : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-3 text-sm text-muted-foreground">
                                No batch images uploaded yet.
                              </p>
                            )}
                          </div>
                          <div className="min-w-0 max-w-full max-h-[28rem] overflow-x-hidden overflow-y-auto rounded-md border">
                            <Table className="w-full table-fixed text-sm">
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Date</TableHead>
                                  <TableHead>Supplier / payee</TableHead>
                                  <TableHead>Description</TableHead>
                                  <TableHead>Document</TableHead>
                                  <TableHead>Allocation</TableHead>
                                  <TableHead className="text-right">Amount</TableHead>
                                  <TableHead className="text-right">Action</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {pettyCashDetailsBatch.receipts.length === 0 ? (
                                  <EmptyState colSpan={7} icon={Receipt}>
                                    No receipts linked yet. Import receipts into this open batch.
                                  </EmptyState>
                                ) : (
                                  pettyCashDetailsBatch.receipts.map((receipt: any) => (
                                    <TableRow key={receipt.id}>
                                      <TableCell>{fmtDate(receipt.expense_date)}</TableCell>
                                      <TableCell>{receipt.supplier_name || "—"}</TableCell>
                                      <TableCell>{receipt.description}</TableCell>
                                      <TableCell>{receipt.supplier_document_no || "—"}</TableCell>
                                      <TableCell className="text-xs">
                                        {receipt.allocations?.length > 1
                                          ? "Shared across JOs"
                                          : receipt.allocations?.[0]?.job_order?.job_number || receipt.job_order?.job_number || "Company expense"}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">
                                        {peso(receipt.amount)}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        {receipt.payment_status === "pending" ? (
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => {
                                              setPettyCashDetailsBatch(null);
                                              setEditingExpense(toPendingExpenseEditTarget(receipt));
                                            }}
                                          >
                                            Edit
                                          </Button>
                                        ) : (
                                          <span className="text-xs text-muted-foreground">Locked</span>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  ))
                                )}
                              </TableBody>
                            </Table>
                          </div>
                          <DialogFooter>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => void exportPettyCashBatchExcel(pettyCashDetailsBatch)}
                            >
                              Export Excel
                            </Button>
                            {pettyCashDetailsBatch.status === "open" ? (
                              <>
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setPettyCashFundingBatch(pettyCashDetailsBatch);
                                    setPettyCashDetailsBatch(null);
                                  }}
                                >
                                  Add cash
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setExpenseImportContext("petty-cash");
                                    setExpenseImportBatchId(pettyCashDetailsBatch.id);
                                    setPettyCashDetailsBatch(null);
                                    setExpenseImportOpen(true);
                                  }}
                                >
                                  Import receipts
                                </Button>
                                <Button
                                  onClick={() => {
                                    setPettyCashReceiptBatch(pettyCashDetailsBatch);
                                    setPettyCashDetailsBatch(null);
                                  }}
                                >
                                  Add receipt
                                </Button>
                              </>
                            ) : null}
                            {pettyCashDetailsBatch.status === "closed" ? (
                              <Button
                                onClick={() => {
                                  setPettyCashCvBatch({
                                    id: pettyCashDetailsBatch.id,
                                    cash_received: Number(
                                      pettyCashDetailsBatch.funding_total ??
                                        pettyCashDetailsBatch.cash_received,
                                    ),
                                    receipts_total: pettyCashDetailsBatch.receipts_total,
                                    receipt_count: pettyCashDetailsBatch.receipt_count,
                                  });
                                  setPettyCashDetailsBatch(null);
                                }}
                              >
                                Create CV
                              </Button>
                            ) : null}
                          </DialogFooter>
                        </div>
                      );
                    })()
                  : null}
              </DialogContent>
            </Dialog>
            <Dialog open={Boolean(pettyCashAttachmentToRemove)} onOpenChange={(open) => !open && setPettyCashAttachmentToRemove(null)}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Remove uploaded image?</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">
                  This will permanently remove {pettyCashAttachmentToRemove?.attachment.file_name} from this petty-cash batch.
                </p>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setPettyCashAttachmentToRemove(null)}>Cancel</Button>
                  <Button variant="destructive" onClick={() => {
                    const pending = pettyCashAttachmentToRemove;
                    setPettyCashAttachmentToRemove(null);
                    if (pending) void removePettyCashBatchImage(pending.batch, pending.attachment);
                  }}>Remove image</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog
              open={Boolean(pettyCashReceiptBatch)}
              onOpenChange={(open) => !open && setPettyCashReceiptBatch(null)}
            >
              <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-[940px]">
                <DialogHeader className="shrink-0 border-b px-6 py-6 sm:px-8">
                  <DialogTitle className="text-2xl tracking-tight sm:text-3xl">
                    Add petty cash receipt
                  </DialogTitle>
                  <p className="text-base text-muted-foreground">
                    Save the details of what you bought using petty cash.
                  </p>
                </DialogHeader>
                <div className="min-h-0 flex flex-1 flex-col">
                  {pettyCashReceiptBatch ? (
                    <GeneralExpenseForm
                      key={pettyCashReceiptBatch.id}
                      initialPettyCashBatch={{
                        id: pettyCashReceiptBatch.id,
                        funding_source: pettyCashReceiptBatch.funding_source,
                        funding_total: pettyCashReceiptBatch.funding_total,
                        receipts_total: pettyCashReceiptBatch.receipts_total,
                      }}
                      busy={addGeneralExpense.isPending}
                      submitLabel="Save receipt"
                      onCancel={() => setPettyCashReceiptBatch(null)}
                      onSubmit={(values) =>
                        addGeneralExpense.mutate(values, {
                          onSuccess: () => setPettyCashReceiptBatch(null),
                        })
                      }
                    />
                  ) : null}
                </div>
              </DialogContent>
            </Dialog>
            <Dialog
              open={Boolean(pettyCashFundingBatch)}
              onOpenChange={(open) => !open && setPettyCashFundingBatch(null)}
            >
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Add cash to petty cash</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">
                  This records a separate cash top-up. The starting cash stays unchanged.
                </p>
                <div className="grid gap-3">
                  <div className="space-y-2">
                    <Label>Amount *</Label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={pettyCashFundingForm.amount}
                      onChange={(event) =>
                        setPettyCashFundingForm({
                          ...pettyCashFundingForm,
                          amount: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Date *</Label>
                    <Input
                      type="date"
                      value={pettyCashFundingForm.funding_date}
                      onChange={(event) =>
                        setPettyCashFundingForm({
                          ...pettyCashFundingForm,
                          funding_date: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Funding source *</Label>
                    <Select
                      value={pettyCashFundingForm.funding_source}
                      onValueChange={(value) =>
                        setPettyCashFundingForm({
                          ...pettyCashFundingForm,
                          funding_source: value,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose funding source" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BDO">BDO</SelectItem>
                        <SelectItem value="GCash">GCash</SelectItem>
                        <SelectItem value="Cash on hand">Cash on hand</SelectItem>
                        <SelectItem value="Bank transfer">Bank transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Reference *</Label>
                    <Input
                      value={pettyCashFundingForm.funding_reference}
                      onChange={(event) =>
                        setPettyCashFundingForm({
                          ...pettyCashFundingForm,
                          funding_reference: event.target.value,
                        })
                      }
                      placeholder="Transfer or deposit reference"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setPettyCashFundingBatch(null)}>
                    Cancel
                  </Button>
                  <Button onClick={() => void addPettyCashFunding()}>Add cash</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <div className="mb-4 grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_12rem_12rem_auto] sm:items-end">
              <div className="space-y-1">
                <Label htmlFor="petty-cash-search">Find a batch or transaction</Label>
                <Input
                  id="petty-cash-search"
                  value={reportSearch}
                  onChange={(event) => setReportSearch(event.target.value)}
                  placeholder="Number, Job Order, project, or receipt"
                  className="h-10"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="petty-cash-search-scope">Search in</Label>
                <Select
                  value={pettyCashSearchScope}
                  onValueChange={(value: any) => setPettyCashSearchScope(value)}
                >
                  <SelectTrigger id="petty-cash-search-scope" className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Everything</SelectItem>
                    <SelectItem value="number">Petty cash number</SelectItem>
                    <SelectItem value="job">Job Order</SelectItem>
                    <SelectItem value="project">Project</SelectItem>
                    <SelectItem value="transaction">Transaction</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {reportSearch ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10"
                  onClick={() => setReportSearch("")}
                >
                  Clear
                </Button>
              ) : (
                <div />
              )}
            </div>
            <div className={`mb-4 grid gap-3 sm:grid-cols-4 ${pettyCashSearchScope === "all" ? "" : "hidden"}`}>
              <SummaryCard
                label="Starting cash received"
                value={peso(
                  filteredPettyCashBatches.reduce(
                    (sum, batch) => sum + Number(batch.cash_received ?? 0),
                    0,
                  ),
                )}
              />
              <SummaryCard
                label="Receipts recorded"
                value={peso(
                  filteredPettyCashBatches.reduce(
                    (sum, batch) => sum + Number(batch.receipts_total ?? 0),
                    0,
                  ),
                )}
              />
              <SummaryCard
                label="Available balance"
                value={peso(
                  filteredPettyCashBatches.reduce(
                    (sum, batch) =>
                      sum +
                      Number(batch.funding_total ?? batch.cash_received ?? 0) -
                      Number(batch.receipts_total ?? 0) -
                      Number((batch as any).cash_returned_amount ?? 0),
                    0,
                  ),
                )}
              />
              <SummaryCard
                label="Open batches"
                value={filteredPettyCashBatches.filter((batch) => batch.status === "open").length}
              />
            </div>
            <div className={`mb-4 grid gap-3 sm:grid-cols-4 ${pettyCashSearchScope === "all" ? "" : "hidden"}`}>
              {[{ key: "all", label: "All batches" }, { key: "open", label: "Open" }, { key: "closed", label: "Closed" }, { key: "cv_created", label: "CV created" }].map((status) => (
                <button key={status.key} type="button" onClick={() => setPettyCashStatusFilter(status.key)} className={`rounded-lg border p-3 text-left transition hover:border-primary hover:bg-muted/30 ${pettyCashStatusFilter === status.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-background"}`}>
                  <div className="text-sm text-muted-foreground">{status.label}</div>
                  <div className="text-2xl font-semibold">{status.key === "all" ? (pettyCashBatches.data ?? []).length : (pettyCashBatches.data ?? []).filter((batch) => batch.status === status.key).length}</div>
                </button>
              ))}
            </div>
            <div className="report-table-scroll max-h-[34rem] overflow-auto rounded-md border">
              <Table className={pettyCashSearchScope === "all" ? "min-w-[980px]" : "min-w-[640px]"}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Date</TableHead>
                    {pettyCashSearchScope === "all" ? (
                      <>
                        <TableHead className="whitespace-nowrap">Petty cash no.</TableHead>
                        <TableHead className="whitespace-nowrap">Custodian</TableHead>
                        <TableHead className="whitespace-nowrap">Funding</TableHead>
                        <TableHead className="whitespace-nowrap">Cash received</TableHead>
                        <TableHead className="whitespace-nowrap">Receipts</TableHead>
                        <TableHead className="whitespace-nowrap">Difference</TableHead>
                      </>
                    ) : (
                      <TableHead className="whitespace-nowrap">
                        {pettyCashSearchScope === "number"
                          ? "Petty cash number"
                          : pettyCashSearchScope === "job"
                            ? "Job Order"
                            : pettyCashSearchScope === "project"
                              ? "Project"
                              : "Transaction"}
                      </TableHead>
                    )}
                    <TableHead className="whitespace-nowrap">Status</TableHead>
                    <TableHead className="sticky right-0 z-10 whitespace-nowrap bg-background text-right shadow-[-6px_0_10px_-10px_hsl(var(--foreground)/0.35)]">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pettyCashBatches.isLoading ? (
                    <LoadingRow colSpan={pettyCashSearchScope === "all" ? 9 : 4}>
                      Loading petty cash batches...
                    </LoadingRow>
                  ) : pettyCashBatches.isError ? (
                    <EmptyState colSpan={pettyCashSearchScope === "all" ? 9 : 4} icon={AlertCircle}>
                      We could not load petty cash batches.
                    </EmptyState>
                  ) : (pettyCashBatches.data ?? []).length === 0 ? (
                    <EmptyState colSpan={pettyCashSearchScope === "all" ? 9 : 4} icon={Receipt}>
                      No petty cash batches yet. Select “New petty cash batch” above to record the
                      first cash advance.
                    </EmptyState>
                  ) : filteredPettyCashBatches.length === 0 ? (
                    <EmptyState colSpan={pettyCashSearchScope === "all" ? 9 : 4} icon={Search}>
                      No petty cash batches match this search. Clear the search or try a custodian,
                      bank, reference, or status.
                    </EmptyState>
                  ) : (
                    filteredPettyCashBatches.map((batch) => {
                      const cashToReturn =
                        Number(batch.funding_total ?? batch.cash_received) - batch.receipts_total;
                      const cashReturned = Number((batch as any).cash_returned_amount ?? 0);
                      const difference = cashToReturn - cashReturned;
                      const statusText =
                        batch.status === "cv_created"
                          ? `CV created${batch.cv_reference_no ? ` · ${batch.cv_reference_no}` : ""}`
                          : batch.status === "closed"
                            ? "Closed — ready for CV"
                            : "Open — add receipts";
                      const scopedValue =
                        pettyCashSearchScope === "number"
                          ? (batch as any).petty_cash_number || "—"
                          : pettyCashSearchScope === "job"
                            ? Array.from(
                                new Set(
                                  [
                                    batch.job_order?.job_number,
                                    ...(batch.receipts ?? []).flatMap((receipt: any) => [
                                      receipt.job_order?.job_number,
                                      ...(receipt.allocations ?? []).map(
                                        (allocation: any) => allocation.job_order?.job_number,
                                      ),
                                    ]),
                                  ].filter(Boolean),
                                ),
                              ).join(", ") || "No Job Order"
                            : pettyCashSearchScope === "project"
                              ? Array.from(
                                  new Set(
                                    [
                                      batch.job_order?.project_name,
                                      ...(batch.receipts ?? []).flatMap((receipt: any) => [
                                        receipt.job_order?.project_name,
                                        ...(receipt.allocations ?? []).map(
                                          (allocation: any) => allocation.job_order?.project_name,
                                        ),
                                      ]),
                                    ].filter(Boolean),
                                  ),
                                ).join(", ") || "No project"
                              : pettyCashSearchScope === "transaction"
                                ? Array.from(
                                    new Set(
                                      (batch.receipts ?? [])
                                        .flatMap((receipt: any) => [
                                          receipt.description,
                                          receipt.supplier_name,
                                        ])
                                        .filter(Boolean),
                                    ),
                                  ).join(" · ") || "No transactions"
                                : null;
                      return (
                        <TableRow key={batch.id}>
                          <TableCell className="whitespace-nowrap">
                            {new Date(`${batch.funding_date}T00:00:00`).toLocaleDateString(
                              "en-PH",
                              {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              },
                            )}
                          </TableCell>
                          {pettyCashSearchScope === "all" ? (
                            <>
                              <TableCell
                                className="max-w-[220px] truncate whitespace-nowrap font-medium"
                                title={(batch as any).petty_cash_number || "—"}
                              >
                                {(batch as any).petty_cash_number || "—"}
                              </TableCell>
                              <TableCell
                                className="max-w-[220px] truncate whitespace-nowrap font-medium"
                                title={batch.custodian_name}
                              >
                                {batch.custodian_name}
                              </TableCell>
                              <TableCell className="max-w-[190px] whitespace-nowrap">
                                <div className="truncate">{batch.funding_source}</div>
                                <div
                                  className="truncate text-xs text-muted-foreground"
                                  title={batch.funding_reference || "—"}
                                >
                                  {batch.funding_reference}
                                </div>
                              </TableCell>
                              <TableCell className="whitespace-nowrap tabular-nums">
                                {peso(batch.funding_total ?? batch.cash_received)}
                              </TableCell>
                              <TableCell className="whitespace-nowrap tabular-nums">
                                {peso(batch.receipts_total)}{" "}
                                <span className="text-xs text-muted-foreground">
                                  ({batch.receipt_count})
                                </span>
                              </TableCell>
                              <TableCell
                                className={`whitespace-nowrap tabular-nums ${difference < 0 ? "text-destructive" : ""}`}
                              >
                                {batch.status === "open"
                                  ? cashToReturn >= 0
                                    ? `${peso(cashToReturn)} to return`
                                    : `${peso(Math.abs(cashToReturn))} overage`
                                  : cashReturned > 0
                                    ? `${peso(cashReturned)} returned`
                                    : "Reconciled"}
                              </TableCell>
                            </>
                          ) : (
                            <TableCell
                              className="max-w-[520px] truncate whitespace-nowrap font-medium"
                              title={scopedValue ?? "—"}
                            >
                              {scopedValue}
                            </TableCell>
                          )}
                          <TableCell className="whitespace-nowrap">{statusText}</TableCell>
                          <TableCell className="sticky right-0 z-10 bg-background text-right shadow-[-6px_0_10px_-10px_hsl(var(--foreground)/0.35)]">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`View receipts for ${batch.funding_source} batch for ${batch.custodian_name}`}
                                onClick={() => setPettyCashDetailsBatch(batch)}
                              >
                                View receipts
                              </Button>
                              {batch.status === "open" ? (
                                <>
                                  <Button
                                    size="sm"
                                    aria-label={`Add receipt to ${batch.funding_source} batch for ${batch.custodian_name}`}
                                    onClick={() => setPettyCashReceiptBatch(batch)}
                                  >
                                    Add receipt
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    aria-label={`Add cash to ${batch.funding_source} batch for ${batch.custodian_name}`}
                                    onClick={() => setPettyCashFundingBatch(batch)}
                                  >
                                    Add cash
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    aria-label={`Settle ${batch.funding_source} batch for ${batch.custodian_name}`}
                                    onClick={() => {
                                      const remaining =
                                        Number(batch.funding_total ?? batch.cash_received ?? 0) -
                                        Number(batch.receipts_total ?? 0);
                                      setPettyCashSettlementBatch(batch);
                                      setPettyCashSettlementForm({
                                        cash_returned_amount: String(Math.max(0, remaining)),
                                        cash_returned_reference: "",
                                      });
                                    }}
                                  >
                                    Settle batch
                                  </Button>
                                </>
                              ) : batch.status === "closed" ? (
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    setPettyCashCvBatch({
                                      id: batch.id,
                                      cash_received: Number(
                                        batch.funding_total ?? batch.cash_received,
                                      ),
                                      receipts_total: batch.receipts_total,
                                      receipt_count: batch.receipt_count,
                                    })
                                  }
                                >
                                  Create CV
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            <div className={`mt-4 rounded-md border p-4 ${pettyCashSearchScope === "all" ? "" : "hidden"}`}>
              <h3 className="mb-3 font-semibold">By Job Order / project</h3>
              <div style={{ height: "auto", maxHeight: "12rem", overflowX: "auto", overflowY: "auto" }}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job Order</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Last receipt</TableHead>
                      <TableHead className="text-right">Receipts</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const projects = new Map<
                        string,
                        {
                          job: string;
                          project: string;
                          date: string | null;
                          count: number;
                          total: number;
                        }
                      >();
                      filteredPettyCashBatches.forEach((batch) =>
                        (batch.receipts ?? []).forEach((receipt: any) => {
                          const shares = receipt.allocations?.length
                            ? receipt.allocations.map((allocation: any) => ({
                                id: allocation.job_order_id,
                                amount: Number(allocation.allocated_amount),
                                job: allocation.job_order,
                              }))
                            : receipt.job_order_id
                              ? [
                                  {
                                    id: receipt.job_order_id,
                                    amount: Number(receipt.amount ?? 0),
                                    job: receipt.job_order,
                                  },
                                ]
                              : [];
                          shares.forEach((share: any) => {
                            const current = projects.get(share.id) ?? {
                              job: share.job?.job_number ?? "Job Order",
                              project: share.job?.project_name ?? "",
                              date: null,
                              count: 0,
                              total: 0,
                            };
                            current.date =
                              !current.date || String(receipt.expense_date ?? "") > current.date
                                ? receipt.expense_date
                                : current.date;
                            current.count += 1;
                            current.total += share.amount;
                            projects.set(share.id, current);
                          });
                        }),
                      );
                      return projects.size === 0 ? (
                        <EmptyState colSpan={5}>No tagged receipts yet.</EmptyState>
                      ) : (
                        Array.from(projects.values()).map((project) => (
                          <TableRow key={project.job}>
                            <TableCell>{project.job}</TableCell>
                            <TableCell>{project.project}</TableCell>
                            <TableCell>
                              {project.date
                                ? new Date(`${project.date}T00:00:00`).toLocaleDateString()
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right">{project.count}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {peso(project.total)}
                            </TableCell>
                          </TableRow>
                        ))
                      );
                    })()}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div className={`mt-4 rounded-md border p-4 ${pettyCashSearchScope === "all" ? "" : "hidden"}`}>
              <h3 className="mb-1 font-semibold">Petty cash transactions</h3>
              <p className="mb-3 text-sm text-muted-foreground">
                Money in increases the balance. Each receipt is money out.
              </p>
              <div style={{ height: "34rem", maxHeight: "34rem", overflowX: "auto", overflowY: "scroll" }} data-petty-cash-transactions-scroll="true">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description / supplier</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Job Order</TableHead>
                      <TableHead className="text-right">Tax</TableHead>
                      <TableHead className="text-right">Money in</TableHead>
                      <TableHead className="text-right">Money out</TableHead>
                      <TableHead className="text-right">Running balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const transactions: any[] = [];
                      filteredPettyCashBatches.forEach((batch) => {
                        transactions.push({
                          date: batch.funding_date,
                          type: "Starting cash",
                          description: `${batch.funding_source} · ${batch.funding_reference}`,
                          category: "Funding",
                          job: "—",
                          tax: 0,
                          in: Number(batch.cash_received ?? 0),
                          out: 0,
                        });
                        (batch.funding_events ?? []).forEach((event: any) =>
                          transactions.push({
                            date: event.funding_date,
                            type: "Cash added",
                            description: `${event.funding_source} · ${event.funding_reference}`,
                            category: "Funding",
                            job: "—",
                            tax: 0,
                            in: Number(event.amount ?? 0),
                            out: 0,
                          }),
                        );
                        (batch.receipts ?? []).forEach((receipt: any) =>
                          transactions.push({
                            date: receipt.expense_date,
                            type: "Receipt",
                            description: `${receipt.supplier_name || "Receipt"} · ${receipt.description}`,
                            category: receipt.disbursement_category || "Other",
                            job: receipt.job_order?.job_number || "General expense",
                            tax: Number(receipt.tax_amount ?? 0),
                            in: 0,
                            out: Number(receipt.amount ?? 0),
                          }),
                        );
                        const cashReturned = Number((batch as any).cash_returned_amount ?? 0);
                        if (cashReturned > 0) {
                          transactions.push({
                            date:
                              (batch as any).settled_at ?? batch.closed_at ?? batch.funding_date,
                            type: "Cash returned",
                            description:
                              (batch as any).cash_returned_reference || "Cash returned to company",
                            category: "Settlement",
                            job: "—",
                            tax: 0,
                            in: 0,
                            out: cashReturned,
                          });
                        }
                      });
                      transactions.sort((a, b) =>
                        String(a.date ?? "").localeCompare(String(b.date ?? "")),
                      );
                      let balance = 0;
                      return transactions.length === 0 ? (
                        <EmptyState colSpan={9}>No petty cash transactions yet.</EmptyState>
                      ) : (
                        transactions.map((transaction, index) => {
                          balance += transaction.in - transaction.out;
                          return (
                            <TableRow key={`${transaction.date}-${transaction.type}-${index}`}>
                              <TableCell>{fmtDate(transaction.date)}</TableCell>
                              <TableCell>{transaction.type}</TableCell>
                              <TableCell className="min-w-[18rem]">
                                {transaction.description}
                              </TableCell>
                              <TableCell>{transaction.category}</TableCell>
                              <TableCell>{transaction.job}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {transaction.tax ? peso(transaction.tax) : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {transaction.in ? peso(transaction.in) : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {transaction.out ? peso(transaction.out) : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {peso(balance)}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      );
                    })()}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>

          <TabsContent
            value="payables"
            forceMount
            className={`${REPORT_PANEL_CLASS} data-[state=inactive]:hidden`}
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <ReportHeading title="General Expenses" />
              {canWrite ? (
                <Button
                  onClick={() => {
                    setExpenseImportContext("expenses");
                    setExpenseImportBatchId("none");
                    setExpenseImportOpen(true);
                  }}
                  variant="outline"
                  className="gap-2"
                >
                  <Download className="h-4 w-4" /> Import expenses
                </Button>
              ) : null}
            </div>
            <Dialog
              open={expenseImportOpen}
              onOpenChange={(open) => {
                setExpenseImportOpen(open);
                if (!open) {
                  setExpenseImportRows([]);
                  setIncludePossibleDuplicates(false);
                  setExpenseImportBatchId("none");
                  setExpenseImportContext("expenses");
                }
              }}
            >
              <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-5xl">
                <DialogHeader>
                  <DialogTitle>
                    {expenseImportContext === "petty-cash"
                      ? "Import petty cash receipts"
                      : "Import general expenses"}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-3 text-sm">
                    <p className="text-muted-foreground">
                      Use the template, then review every row before saving.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        downloadExpenseImportFile(
                          pendingExpenseTemplateCsv(),
                          expenseImportContext === "petty-cash"
                            ? "Petty-Cash-Receipts-Template.csv"
                            : "General-Expenses-Template.csv",
                        )
                      }
                    >
                      Download template
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {expenseImportContext === "petty-cash" ? (
                      <div className="space-y-2">
                        <Label>Import into open batch</Label>
                        <Select value={expenseImportBatchId} onValueChange={setExpenseImportBatchId}>
                          <SelectTrigger><SelectValue placeholder="Choose a batch" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Choose a batch</SelectItem>
                            {(pettyCashBatches.data ?? []).filter((batch) => batch.status === "open").map((batch) => (
                              <SelectItem key={batch.id} value={batch.id}>
                                {(batch as any).petty_cash_number || "Batch"} · {batch.custodian_name} · {peso(batch.funding_total ?? batch.cash_received)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                    <Label htmlFor="pending-expense-import">Upload CSV or Excel file</Label>
                    <Input
                      id="pending-expense-import"
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handleExpenseImportFile(file);
                      }}
                    />
                  </div>
                  {expenseImportContext === "petty-cash" ? (
                    <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                      These receipts will be added to the open petty-cash batch you selected.
                    </p>
                  ) : null}
                  {expenseImportRows.length > 0 ? (
                    <>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div className="rounded-md border bg-muted/20 p-3 text-sm">
                          <div className="text-muted-foreground">Ready to import</div>
                          <div className="text-xl font-semibold">
                            {expenseImportRows.filter((row) => row.errors.length === 0).length}
                          </div>
                        </div>
                        <div className="rounded-md border bg-muted/20 p-3 text-sm">
                          <div className="text-muted-foreground">Needs attention</div>
                          <div className="text-xl font-semibold">
                            {expenseImportRows.filter((row) => row.errors.length > 0).length}
                          </div>
                        </div>
                        <div className="rounded-md border bg-muted/20 p-3 text-sm">
                          <div className="text-muted-foreground">Total to import</div>
                          <div className="text-xl font-semibold tabular-nums">
                            {peso(
                              expenseImportRows
                                .filter((row) => row.errors.length === 0)
                                .reduce((sum, row) => sum + row.amount, 0),
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="max-h-80 overflow-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Row</TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead>Job Order</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {expenseImportRows.map((row) => (
                              <TableRow key={row.rowNumber}>
                                <TableCell>{row.rowNumber}</TableCell>
                                <TableCell>{row.expense_date || "-"}</TableCell>
                                <TableCell>{row.description || "-"}</TableCell>
                                <TableCell>{row.job_number || "General expense"}</TableCell>
                                <TableCell>
                                  {row.errors.length ? (
                                    <div className="text-sm text-destructive">
                                      {row.errors.join("; ")}
                                    </div>
                                  ) : row.duplicate ? (
                                    <div className="text-sm text-amber-700">
                                      This row looks like an existing expense
                                    </div>
                                  ) : (
                                    <span className="text-sm text-emerald-700">Ready</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {Number.isFinite(row.amount) ? peso(row.amount) : "-"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      {expenseImportRows.some((row) => row.errors.length > 0) ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            downloadExpenseImportFile(
                              rejectedExpenseCsv(
                                expenseImportRows.filter((row) => row.errors.length > 0),
                              ),
                              "General-Expenses-Rejected.csv",
                            )
                          }
                        >
                          Download rejected rows
                        </Button>
                      ) : null}
                      {expenseImportRows.some((row) => row.duplicate) ? (
                        <label className="flex items-center gap-2 text-sm text-amber-800">
                          <input
                            type="checkbox"
                            checked={includePossibleDuplicates}
                            onChange={(event) => setIncludePossibleDuplicates(event.target.checked)}
                          />{" "}
                          Include rows that look like existing expenses
                        </label>
                      ) : null}
                    </>
                  ) : (
                    <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                      Choose a CSV or Excel file to preview it here.
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setExpenseImportOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      expenseImportBusy || expenseImportRows.every((row) => row.errors.length > 0)
                    }
                    onClick={() => void importPendingExpenses()}
                  >
                    {expenseImportBusy ? "Importing…" : "Import valid expenses"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <SummaryCard
                label="All general expenses"
                value={`${peso(generalExpenseSummary.total)} (${generalExpenses.length} expenses)`}
              />
              <SummaryCard
                label="Arlechino company expenses"
                value={`${peso(generalExpenseSummary.unallocatedTotal)} (${generalExpenseSummary.unallocatedCount} expenses)`}
              />
              <SummaryCard
                label="Needs payment"
                value={`${peso(generalExpenseSummary.pendingTotal)} (${generalExpenseSummary.pendingCount} expenses)`}
              />
            </div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Record a purchase once, then allocate and confirm its actual Job Order use before it
                affects Project Profitability.
              </p>
              <Select
                value={pendingExpenseGroup}
                onValueChange={(value) =>
                  setPendingExpenseGroup(value as typeof pendingExpenseGroup)
                }
              >
                <SelectTrigger className="w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All general expenses</SelectItem>
                  <SelectItem value="needs-allocation">Needs project allocation</SelectItem>
                  <SelectItem value="needs-payment">Needs payment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {focus === "pending-expenses" ? (
              <div className="mb-4 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
                You came from the dashboard. Expenses needing payment are highlighted in this list.
              </div>
            ) : null}
            <div className="report-table-scroll -mx-3 max-h-[34rem] overscroll-contain overflow-auto px-3 sm:mx-0 sm:px-0">
              <Table className="min-w-[1080px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>GE no.</TableHead>
                    <TableHead>Supplier / Payee</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Documents</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-[150px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payables.isLoading ? (
                    <LoadingRow colSpan={7}>Generating report...</LoadingRow>
                  ) : payables.isError ? (
                    <EmptyState colSpan={7} icon={AlertCircle}>
                      {reportError(payables.error)}
                    </EmptyState>
                  ) : filteredGeneralExpenses.length === 0 ? (
                    <EmptyState colSpan={7} icon={Receipt}>
                      No general expenses match this view. Clear the filter or select “Add General
                      Expense” to record a purchase.
                    </EmptyState>
                  ) : (
                    filteredGeneralExpenses.map((p) => (
                      <TableRow key={p.id} className="align-top">
                        <TableCell className="whitespace-nowrap font-mono text-xs font-medium">
                          {p.general_expense_number || "—"}
                        </TableCell>
                        <TableCell className="max-w-[220px] whitespace-normal break-words font-medium">
                          {p.supplier_name || "-"}
                        </TableCell>
                        <TableCell className="max-w-[420px] whitespace-normal break-words">
                          <ExpenseDescription expense={p} />
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              {categoryLabel(p.disbursement_category)}
                            </span>
                            {p.payment_source ? (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                Source: {p.payment_source}
                              </span>
                            ) : null}
                            {p.petty_cash_batch_id ? (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                Petty cash
                              </span>
                            ) : null}
                            <span className="text-xs text-muted-foreground">
                              Due {fmtDate(p.due_date)}
                            </span>
                            {p.allocations?.length ? (
                              <span className="text-xs text-muted-foreground">
                                {peso(
                                  p.allocations.reduce(
                                    (sum: number, allocation: { allocated_amount: number }) =>
                                      sum + Number(allocation.allocated_amount || 0),
                                    0,
                                  ),
                                )}{" "}
                                assigned across {p.allocations.length} Job Orders
                                {unallocatedGeneralExpenseAmount(p) > 0.009
                                  ? ` · ${peso(unallocatedGeneralExpenseAmount(p))} still unallocated`
                                  : ""}
                              </span>
                            ) : p.job_order_id ? (
                              <ReportLink to="/jobs/$id" params={{ id: p.job_order_id }}>
                                {p.job_order
                                  ? `${(p.job_order as { job_number: string; project_name: string }).job_number} - ${(p.job_order as { job_number: string; project_name: string }).project_name}`
                                  : "View job"}
                              </ReportLink>
                            ) : (
                              <span className="text-xs text-muted-foreground">Company expense</span>
                            )}
                            {!p.job_order_id &&
                            p.allocations?.length &&
                            !p.project_cost_confirmed_at ? (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                                Awaiting Operations confirmation
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="min-w-[180px] font-mono text-xs leading-6">
                          <DocumentLine label="DR/Inv" value={p.supplier_document_no} />
                          <DocumentLine
                            label="Check"
                            value={
                              p.payment_status === "paid"
                                ? p.check_number
                                : p.check_number
                                  ? `Previous: ${p.check_number}`
                                  : null
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1.5">
                            <StatusBadge status={p.payment_status} />
                            {p.job_order_id || p.project_cost_confirmed_at ? (
                              <div className="text-xs font-medium text-emerald-700">
                                Included in project profit
                              </div>
                            ) : p.job_order_id || p.allocations?.length ? (
                              <div className="text-xs font-medium text-amber-700">
                                Waiting for Operations
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground">Company expense</div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{peso(p.amount)}</TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex min-w-[128px] items-center justify-end gap-1.5">
                            {canConfirmProjectCosts &&
                            !p.job_order_id &&
                            p.allocations?.length &&
                            !p.project_cost_confirmed_at ? (
                              <Button
                                size="sm"
                                className="h-8 whitespace-nowrap px-3 text-xs"
                                disabled={confirmExpenseProjectCost.isPending}
                                onClick={() => confirmExpenseProjectCost.mutate(p.id)}
                              >
                                Confirm for Project Profitability
                              </Button>
                            ) : null}
                            {canWrite && !(p.job_order_id || p.allocations?.length) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 whitespace-nowrap px-3 text-xs"
                                onClick={() => setAllocationExpense(p)}
                              >
                                Assign project
                              </Button>
                            ) : null}
                            {canWrite &&
                            p.payment_status !== "paid" &&
                            (p.job_order_id || p.project_cost_confirmed_at) ? (
                              <Button
                                size="sm"
                                className="h-8 whitespace-nowrap px-3 text-xs"
                                disabled={updatePayableStatus.isPending}
                                onClick={() => {
                                  setPayingPayable({
                                    id: p.id,
                                    supplier_name: p.supplier_name,
                                    amount: Number(p.amount || 0),
                                    paid_at: p.paid_at,
                                    reference_no: p.reference_no,
                                    supplier_document_no: p.supplier_document_no,
                                    check_date: p.check_date,
                                    check_number: p.check_number,
                                  });
                                }}
                              >
                                Record check payment
                              </Button>
                            ) : null}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  aria-label="More expense actions"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                {canWrite && p.payment_status === "pending" ? (
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      setEditingExpense(toPendingExpenseEditTarget(p))
                                    }
                                  >
                                    <Pencil className="mr-2 h-4 w-4" />
                                    Edit expense
                                  </DropdownMenuItem>
                                ) : null}
                                {canWrite &&
                                !p.job_order_id &&
                                !p.project_cost_confirmed_at &&
                                (p.job_order_id || p.allocations?.length) ? (
                                  <DropdownMenuItem onSelect={() => setAllocationExpense(p)}>
                                    Allocate or adjust projects
                                  </DropdownMenuItem>
                                ) : null}
                                {canWrite &&
                                p.payment_status !== "paid" &&
                                (p.job_order_id || !p.project_cost_confirmed_at) ? (
                                  <DropdownMenuItem
                                    disabled={updatePayableStatus.isPending}
                                    onSelect={() => {
                                      setPayingPayable({
                                        id: p.id,
                                        supplier_name: p.supplier_name,
                                        amount: Number(p.amount || 0),
                                        paid_at: p.paid_at,
                                        reference_no: p.reference_no,
                                        supplier_document_no: p.supplier_document_no,
                                        check_date: p.check_date,
                                        check_number: p.check_number,
                                      });
                                    }}
                                  >
                                    Record check payment
                                  </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuItem asChild>
                                  <Link
                                    to="/expenses/$id/check-voucher/print"
                                    params={{ id: p.id }}
                                    search={{
                                      from: "reports",
                                      jobId: undefined,
                                      tab: activeReport,
                                    }}
                                  >
                                    Print voucher
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                  <Link
                                    to="/expenses/$id/check/print"
                                    params={{ id: p.id }}
                                    search={{
                                      from: "reports",
                                      jobId: undefined,
                                      tab: activeReport,
                                    }}
                                  >
                                    Print check
                                  </Link>
                                </DropdownMenuItem>
                                {canWrite && p.payment_status === "paid" ? (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      disabled={updatePayableStatus.isPending}
                                      onSelect={() =>
                                        updatePayableStatus.mutate({
                                          id: p.id,
                                          payment_status: "pending",
                                        })
                                      }
                                    >
                                      Mark pending
                                    </DropdownMenuItem>
                                  </>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </Card>
      <Dialog open={!!payingPayable} onOpenChange={(open) => !open && setPayingPayable(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record check payment</DialogTitle>
          </DialogHeader>
          {payingPayable ? (
            <PayablePaymentForm
              payable={payingPayable}
              busy={updatePayableStatus.isPending}
              onSubmit={(values) =>
                updatePayableStatus.mutate({
                  id: payingPayable.id,
                  payment_status: "paid",
                  ...values,
                })
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={!!editingVoucher} onOpenChange={(open) => !open && setEditingVoucher(null)}>
        <DialogContent className={EXPENSE_DIALOG_CLASS}>
          <DialogHeader>
            <DialogTitle>Edit voucher details</DialogTitle>
          </DialogHeader>
          {editingVoucher ? (
            <VoucherEditForm
              target={editingVoucher}
              revisions={voucherRevisionMap.get(editingVoucher.id) ?? []}
              busy={updateVoucherDetails.isPending}
              onSubmit={(values) => updateVoucherDetails.mutate({ target: editingVoucher, values })}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={!!editingExpense} onOpenChange={(open) => !open && setEditingExpense(null)}>
        <DialogContent className={EXPENSE_DIALOG_CLASS}>
          <DialogHeader>
            <DialogTitle>Edit pending expense</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Update the expense details here. Payment release, check details, and proof stay in
              Record payment.
            </p>
          </DialogHeader>
          {editingExpense ? (
            <GeneralExpenseForm
              initialExpense={editingExpense}
              submitLabel="Save changes"
              busy={updatePendingExpense.isPending}
              onSubmit={(values) => updatePendingExpense.mutate({ id: editingExpense.id, values })}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!allocationExpense}
        onOpenChange={(open) => !open && setAllocationExpense(null)}
      >
        <DialogContent className={EXPENSE_DIALOG_CLASS}>
          <DialogHeader>
            <DialogTitle>Allocate General Expense to projects</DialogTitle>
          </DialogHeader>
          {allocationExpense ? (
            <ExpenseAllocationForm
              expense={allocationExpense}
              busy={confirmExpenseAllocations.isPending}
              onSubmit={(allocations) =>
                confirmExpenseAllocations.mutate({
                  expenseId: allocationExpense.id,
                  expenseAmount: Number(allocationExpense.amount),
                  allocations,
                })
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type PayablePaymentTarget = {
  id: string;
  supplier_name: string | null;
  amount: number;
  paid_at: string | null;
  reference_no: string | null;
  supplier_document_no: string | null;
  check_date: string | null;
  check_number: string | null;
};

type PayablePaymentValues = {
  reference_no: string;
  supplier_document_no: string;
  check_date: string;
  check_number: string;
};

type VoucherEditTarget = VoucherFields & {
  id: string;
  supplier_document_no: string | null;
};

type VoucherEditValues = {
  supplier_name: string;
  amount: number;
  description: string;
  check_date: string;
  supplier_document_no: string;
  check_number: string;
  correction_reason: string;
};

type GeneralExpenseFormValues = {
  job_order_id: string | null;
  petty_cash_batch_id: string | null;
  allocation_mode: "general" | "single" | "shared";
  allocations: Array<{ job_order_id: string; allocated_amount: number }>;
  supplier_id: string | null;
  expense_date: string;
  expense_type:
    "materials" | "labor" | "delivery" | "installation" | "outsourcing" | "miscellaneous";
  disbursement_category: DisbursementCategory;
  disbursement_subcategory: DisbursementSubcategory | "";
  supplier_name: string;
  description: string;
  quantity: number | null;
  unit_of_measure: string;
  unit_cost: number | null;
  amount: number;
  tax_amount: number;
  tax_type: "vatable" | "non_vat";
  payment_status: "pending" | "paid";
  payment_method: "unpaid" | "check" | "bank_transfer" | "gcash" | "petty_cash";
  payment_state: "pending" | "scheduled" | "released" | "cleared" | "held" | "cancelled";
  payment_source: string;
  payment_source_reference: string;
  payment_proof_file: File | null;
  receipt_missing_reason: string;
  paid_date: string;
  due_date: string;
  reference_no: string;
  supplier_document_no: string;
  supplier_tin: string;
  supplier_address: string;
  check_date: string;
  check_number: string;
  remarks: string;
};

type PendingExpenseEditTarget = {
  id: string;
  job_order_id: string | null;
  petty_cash_batch_id?: string | null;
  allocation_mode?: "general" | "single" | "shared";
  allocations?: Array<{ job_order_id: string; allocated_amount: number }>;
  supplier_id: string | null;
  expense_date: string;
  expense_type: GeneralExpenseFormValues["expense_type"];
  disbursement_category: DisbursementCategory;
  disbursement_subcategory: DisbursementSubcategory | "";
  supplier_name: string;
  description: string;
  quantity: number | null;
  unit_of_measure: string;
  unit_cost: number | null;
  amount: number;
  tax_amount: number;
  tax_type: GeneralExpenseFormValues["tax_type"];
  payment_method: GeneralExpenseFormValues["payment_method"];
  payment_state: GeneralExpenseFormValues["payment_state"];
  payment_source: string;
  payment_source_reference: string;
  due_date: string;
  reference_no: string;
  supplier_document_no: string;
  supplier_tin: string;
  supplier_address: string;
  check_date: string;
  check_number: string;
  remarks: string;
};

function toPendingExpenseEditTarget(expense: {
  id: string;
  job_order_id: string | null;
  petty_cash_batch_id?: string | null;
  allocations?: Array<{ job_order_id: string; allocated_amount: number }>;
  supplier_id: string | null;
  expense_date: string;
  expense_type: string;
  disbursement_category: string | null;
  disbursement_subcategory: string | null;
  supplier_name: string | null;
  description: string;
  quantity: number | null;
  unit_of_measure: string | null;
  unit_cost: number | null;
  amount: number;
  tax_amount: number;
  tax_type: string | null;
  payment_method: string | null;
  payment_state: string | null;
  payment_source: string | null;
  payment_source_reference: string | null;
  due_date: string | null;
  reference_no: string | null;
  supplier_document_no: string | null;
  supplier_tin: string | null;
  supplier_address: string | null;
  check_date: string | null;
  check_number: string | null;
  remarks: string | null;
}): PendingExpenseEditTarget {
  return {
    id: expense.id,
    job_order_id: expense.job_order_id ?? null,
    petty_cash_batch_id: expense.petty_cash_batch_id ?? null,
    allocation_mode: expense.allocations?.length
      ? "shared"
      : expense.job_order_id
        ? "single"
        : "general",
    allocations: expense.allocations ?? [],
    supplier_id: expense.supplier_id ?? null,
    expense_date: expense.expense_date,
    expense_type: expense.expense_type as GeneralExpenseFormValues["expense_type"],
    disbursement_category: (expense.disbursement_category ?? "other") as DisbursementCategory,
    disbursement_subcategory: (expense.disbursement_subcategory ?? "") as
      DisbursementSubcategory | "",
    supplier_name: expense.supplier_name ?? "",
    description: expense.description,
    quantity: expense.quantity,
    unit_of_measure: expense.unit_of_measure ?? "",
    unit_cost: expense.unit_cost,
    amount: Number(expense.amount || 0),
    tax_amount: Number(expense.tax_amount || 0),
    tax_type: (expense.tax_type ?? "non_vat") as GeneralExpenseFormValues["tax_type"],
    payment_method: (expense.payment_method ??
      "unpaid") as GeneralExpenseFormValues["payment_method"],
    payment_state: (expense.payment_state ??
      "pending") as GeneralExpenseFormValues["payment_state"],
    payment_source: expense.payment_source ?? "",
    payment_source_reference: expense.payment_source_reference ?? "",
    due_date: expense.due_date ?? "",
    reference_no: expense.reference_no ?? "",
    supplier_document_no: expense.supplier_document_no ?? "",
    supplier_tin: expense.supplier_tin ?? "",
    supplier_address: expense.supplier_address ?? "",
    check_date: expense.check_date ?? "",
    check_number: expense.check_number ?? "",
    remarks: expense.remarks ?? "",
  };
}

type CashSaleFormValues = {
  or_number: string;
  collection_date: string;
  customer_name: string;
  invoice_reference: string;
  description: string;
  gross_amount: number;
  vat_amount: number;
};

function PayablePaymentForm({
  payable,
  onSubmit,
  busy,
}: {
  payable: PayablePaymentTarget;
  onSubmit: (values: PayablePaymentValues) => void;
  busy?: boolean;
}) {
  const [f, setF] = useState({
    reference_no: payable.reference_no ?? "",
    supplier_document_no: payable.supplier_document_no ?? "",
    check_date: payable.check_date ?? dateInputValue(new Date()),
    check_number: payable.check_number ?? "",
  });

  function submit() {
    if (!f.check_date) return toast.error("Check date is required");
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
        <div className="font-medium">{payable.supplier_name || "Missing payee"}</div>
        <div className="mt-2 text-muted-foreground">Amount</div>
        <div className="font-medium tabular-nums">{peso(payable.amount)}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Check Date *</Label>
          <Input
            type="date"
            required
            value={f.check_date}
            onChange={(e) => setF({ ...f, check_date: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Check No. *</Label>
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

function VoucherEditForm({
  target,
  revisions,
  onSubmit,
  busy,
}: {
  target: VoucherEditTarget;
  revisions: Array<{
    id: string;
    changed_at: string;
    reason: string;
    previous_values: unknown;
    new_values: unknown;
  }>;
  onSubmit: (values: VoucherEditValues) => void;
  busy?: boolean;
}) {
  const [f, setF] = useState({
    supplier_name: target.supplier_name ?? "",
    amount: String(target.amount ?? ""),
    description: target.description ?? "",
    check_date: target.check_date ?? "",
    supplier_document_no: target.supplier_document_no ?? "",
    check_number: target.check_number ?? "",
    correction_reason: "",
  });
  const needsReason = Boolean(target.voucher_printed_at);

  function submit() {
    const amount = Number(f.amount);
    if (!f.description.trim()) return toast.error("Details are required");
    if (amount <= 0) return toast.error("Amount must be greater than zero");
    if (!f.check_date) return toast.error("Check date is required");
    if (!f.check_number.trim()) return toast.error("Check number is required");
    if (needsReason && !f.correction_reason.trim()) {
      return toast.error("Correction reason is required after printing");
    }
    onSubmit({ ...f, amount });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      {needsReason ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This voucher was already printed. Changes will be saved with revision history.
        </div>
      ) : null}
      {revisions.length > 0 ? (
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <div className="font-medium">Revision history</div>
          <div className="mt-2 space-y-2">
            {revisions.slice(0, 5).map((revision) => (
              <div key={revision.id} className="grid gap-1">
                <div className="text-xs text-muted-foreground">{fmtDate(revision.changed_at)}</div>
                <div>{revision.reason}</div>
                <div className="grid gap-1 text-xs text-muted-foreground">
                  {voucherRevisionLines(revision.previous_values, revision.new_values).map(
                    (line) => (
                      <div key={line.field}>
                        {line.field}: {line.previous || "-"} to {line.next || "-"}
                      </div>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Payee</Label>
          <Input
            value={f.supplier_name}
            onChange={(e) => setF({ ...f, supplier_name: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Amount *</Label>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            required
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Details *</Label>
        <Textarea
          rows={2}
          required
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
      </div>
      <div className="grid gap-3">
        <div className="space-y-2">
          <Label>Check Date *</Label>
          <Input
            type="date"
            required
            value={f.check_date}
            onChange={(e) => setF({ ...f, check_date: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>DR / Invoice No.</Label>
          <Input
            value={f.supplier_document_no}
            onChange={(e) => setF({ ...f, supplier_document_no: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Check No. *</Label>
          <Input
            required
            value={f.check_number}
            onChange={(e) => setF({ ...f, check_number: e.target.value })}
          />
        </div>
      </div>
      {needsReason ? (
        <div className="space-y-2">
          <Label>Correction Reason *</Label>
          <Textarea
            rows={2}
            required
            value={f.correction_reason}
            onChange={(e) => setF({ ...f, correction_reason: e.target.value })}
          />
        </div>
      ) : null}
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving..." : "Save voucher details"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function GeneralExpenseForm({
  onSubmit,
  busy,
  initialExpense,
  initialPettyCashBatch,
  onCancel,
  submitLabel = "Add disbursement",
}: {
  onSubmit: (values: GeneralExpenseFormValues) => void;
  busy?: boolean;
  initialExpense?: PendingExpenseEditTarget;
  initialPettyCashBatch?: {
    id: string;
    funding_source: string | null;
    funding_total?: number;
    receipts_total?: number;
  };
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [receiptUnavailable, setReceiptUnavailable] = useState(false);
  const [pettyCashStep, setPettyCashStep] = useState<1 | 2 | 3>(1);
  const [pettyCashTaxMode, setPettyCashTaxMode] = useState<
    "none" | "vat_included" | "add_vat" | "custom"
  >("none");
  const [jobOrderSearch, setJobOrderSearch] = useState("");
  const [deliveryProviderChoice, setDeliveryProviderChoice] = useState(() => {
    const provider = initialExpense?.supplier_name ?? "";
    return DELIVERY_PROVIDERS.includes(provider as (typeof DELIVERY_PROVIDERS)[number])
      ? provider
      : provider
        ? "other"
        : "";
  });
  const [f, setF] = useState(() => ({
    job_order_id: initialExpense?.job_order_id ?? null,
    petty_cash_batch_id: initialExpense?.petty_cash_batch_id ?? initialPettyCashBatch?.id ?? null,
    allocation_mode:
      initialExpense?.allocation_mode ?? (initialExpense?.job_order_id ? "single" : "general"),
    allocations: initialExpense?.allocations ?? [],
    supplier_id: initialExpense?.supplier_id ?? null,
    expense_date: initialExpense?.expense_date ?? today,
    expense_type: initialExpense?.expense_type ?? "miscellaneous",
    disbursement_category:
      initialExpense?.disbursement_category ?? ("other" as DisbursementCategory),
    disbursement_subcategory:
      initialExpense?.disbursement_subcategory ??
      (initialPettyCashBatch ? "other" : ("" as DisbursementSubcategory | "")),
    supplier_name: initialExpense?.supplier_name ?? "",
    description: initialExpense?.description ?? "",
    quantity: initialExpense?.quantity == null ? "" : String(initialExpense.quantity),
    unit_of_measure: initialExpense?.unit_of_measure ?? "",
    unit_cost: initialExpense?.unit_cost == null ? "" : String(initialExpense.unit_cost),
    amount: initialExpense?.amount == null ? "" : String(initialExpense.amount),
    tax_amount: initialExpense?.tax_amount == null ? "" : String(initialExpense.tax_amount),
    tax_type: initialExpense?.tax_type ?? "non_vat",
    payment_status: initialPettyCashBatch ? "paid" : "pending",
    payment_method:
      initialExpense?.payment_method ?? (initialPettyCashBatch ? "petty_cash" : "unpaid"),
    payment_state: initialPettyCashBatch ? "cleared" : (initialExpense?.payment_state ?? "pending"),
    payment_source: initialExpense?.payment_source ?? initialPettyCashBatch?.funding_source ?? "",
    payment_source_reference: initialExpense?.payment_source_reference ?? "",
    payment_proof_file: null as File | null,
    receipt_missing_reason: "",
    paid_date: today,
    due_date: initialExpense?.due_date ?? "",
    reference_no: initialExpense?.reference_no ?? "",
    supplier_document_no: initialExpense?.supplier_document_no ?? "",
    supplier_tin: initialExpense?.supplier_tin ?? "",
    supplier_address: initialExpense?.supplier_address ?? "",
    check_date: initialExpense?.check_date ?? today,
    check_number: initialExpense?.check_number ?? "",
    remarks: initialExpense?.remarks ?? "",
  }));
  useEffect(() => {
    if (!initialExpense) return;
    setF({
      job_order_id: initialExpense.job_order_id,
      petty_cash_batch_id: initialExpense.petty_cash_batch_id ?? null,
      allocation_mode:
        initialExpense.allocation_mode ?? (initialExpense.job_order_id ? "single" : "general"),
      allocations: initialExpense.allocations ?? [],
      supplier_id: initialExpense.supplier_id,
      expense_date: initialExpense.expense_date,
      expense_type: initialExpense.expense_type,
      disbursement_category: initialExpense.disbursement_category,
      disbursement_subcategory: initialExpense.disbursement_subcategory,
      supplier_name: initialExpense.supplier_name,
      description: initialExpense.description,
      quantity: initialExpense.quantity == null ? "" : String(initialExpense.quantity),
      unit_of_measure: initialExpense.unit_of_measure,
      unit_cost: initialExpense.unit_cost == null ? "" : String(initialExpense.unit_cost),
      amount: String(initialExpense.amount),
      tax_amount: String(initialExpense.tax_amount),
      tax_type: initialExpense.tax_type ?? "non_vat",
      payment_status: "pending",
      payment_method: initialExpense.payment_method,
      payment_state: initialExpense.payment_state,
      payment_source: initialExpense.payment_source,
      payment_source_reference: initialExpense.payment_source_reference,
      payment_proof_file: null,
      receipt_missing_reason: "",
      paid_date: today,
      due_date: initialExpense.due_date,
      reference_no: initialExpense.reference_no,
      supplier_document_no: initialExpense.supplier_document_no,
      supplier_tin: initialExpense.supplier_tin,
      supplier_address: initialExpense.supplier_address,
      check_date: initialExpense.check_date || today,
      check_number: initialExpense.check_number,
      remarks: initialExpense.remarks,
    });
  }, [initialExpense, today]);
  const isMaterial = f.expense_type === "materials";
  const isPettyCashReceipt = Boolean(initialPettyCashBatch);
  const needsSupplierDetails =
    f.disbursement_category === "direct_materials" && !isPettyCashReceipt;
  const needsPaymentProof = ["bank_transfer", "gcash", "petty_cash"].includes(f.payment_method);
  const subcategoryOptions = DISBURSEMENT_SUBCATEGORIES[f.disbursement_category];
  const hasUsefulSubcategories = subcategoryOptions.some(
    (subcategory) => subcategory.value !== "other",
  );
  const materialAmount = computeMaterialAmount(f.quantity, f.unit_cost);
  const allocatedShareAmount = f.allocations.reduce(
    (sum, row) => sum + Number(row.allocated_amount || 0),
    0,
  );
  const supplierSuggestions = useQuery({
    queryKey: ["supplier-suggestions", f.supplier_name],
    queryFn: async () => {
      const query = f.supplier_name.trim();
      if (!query) return [];
      const { data, error } = await supabase
        .from("job_expenses")
        .select("supplier_name, supplier_tin, supplier_address")
        .not("supplier_name", "is", null)
        .ilike("supplier_name", `%${query}%`)
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return Array.from(
        new Map((data ?? []).map((supplier) => [supplier.supplier_name, supplier])).values(),
      );
    },
    enabled: f.supplier_name.trim().length >= 2,
  });
  const jobOrders = useQuery({
    queryKey: ["expense-job-order-picker"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_orders")
        .select("id, job_number, project_name, customer:customers(customer_name)")
        .order("job_number", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const supplierMaster = useQuery({
    queryKey: ["supplier-picker"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, tin_number, address")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [supplierCreateBusy, setSupplierCreateBusy] = useState(false);
  const createSupplierFromExpense = async () => {
    const name = f.supplier_name.trim();
    if (!name) return toast.error("Enter a supplier name first.");
    setSupplierCreateBusy(true);
    try {
      const existing = (supplierMaster.data ?? []).find(
        (supplier) => supplier.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (existing) {
        setF({
          ...f,
          supplier_id: existing.id,
          supplier_name: existing.name,
          supplier_tin: existing.tin_number ?? "",
          supplier_address: existing.address ?? "",
        });
        return;
      }
      const { data, error } = await supabase
        .from("suppliers")
        .insert({ name, active: true })
        .select("id, name, tin_number, address")
        .single();
      if (error) throw error;
      setF({
        ...f,
        supplier_id: data.id,
        supplier_name: data.name,
        supplier_tin: data.tin_number ?? "",
        supplier_address: data.address ?? "",
      });
      await queryClient.invalidateQueries({ queryKey: ["supplier-picker"] });
      toast.success("Supplier added and selected.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add supplier.");
    } finally {
      setSupplierCreateBusy(false);
    }
  };
  const matchingJobOrders = (jobOrders.data ?? []).filter((job) => {
    const query = jobOrderSearch.trim().toLowerCase();
    if (!query) return true;
    return [job.job_number, job.project_name, job.customer?.customer_name]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(query));
  });
  const selectedSingleJobOrder = (jobOrders.data ?? []).find((job) => job.id === f.job_order_id);

  function submit() {
    if (!f.expense_date) return toast.error("Date is required");
    if (!f.description.trim()) return toast.error("Description is required");
    if (f.due_date && f.due_date < f.expense_date) {
      return toast.error("Due date cannot be before the expense date");
    }
    const amount = isMaterial ? materialAmount : Number(f.amount);
    const taxAmount = Number(f.tax_amount || 0);
    if (isMaterial && Number(f.quantity) <= 0)
      return toast.error("Quantity must be greater than zero");
    if (isMaterial && !f.unit_of_measure.trim()) return toast.error("Unit is required");
    if (isMaterial && Number(f.unit_cost) <= 0)
      return toast.error("Unit cost must be greater than zero");
    if (amount <= 0) return toast.error("Amount must be greater than zero");
    if (f.allocation_mode === "shared") {
      const allocated = f.allocations.reduce(
        (sum, row) => sum + Number(row.allocated_amount || 0),
        0,
      );
      if (f.allocations.length < 2)
        return toast.error("Choose at least two Job Orders for a shared expense");
      if (f.allocations.some((row) => !row.job_order_id || Number(row.allocated_amount) <= 0))
        return toast.error("Each Job Order share must be greater than zero");
      if (allocated - amount > 0.009)
        return toast.error(`Job Order shares cannot exceed ${peso(amount)}`);
    }
    if (taxAmount < 0) return toast.error("Tax cannot be negative");
    if (f.disbursement_category === "direct_materials" && !isPettyCashReceipt) {
      if (!f.supplier_name.trim()) return toast.error("Company name is required");
      if (!f.supplier_tin.trim()) return toast.error("TIN is required");
      if (!f.supplier_address.trim()) return toast.error("Address is required");
    }
    const checkIssued =
      f.payment_method === "check" && ["released", "cleared"].includes(f.payment_state);
    if (checkIssued && !f.check_number.trim()) return toast.error("Check number is required");
    if (checkIssued && !f.check_date) return toast.error("Check date is required");
    if (f.payment_method === "petty_cash" && !f.payment_source.trim())
      return toast.error("Payment source is required for petty cash");
    if (f.payment_method === "petty_cash" && !f.petty_cash_batch_id)
      return toast.error("Choose an open petty cash batch");
    if (isPettyCashReceipt && !f.payment_proof_file && !f.receipt_missing_reason.trim()) {
      return toast.error("Upload the receipt or explain why it is unavailable");
    }
    if (
      ["petty_cash", "bank_transfer", "gcash"].includes(f.payment_method) &&
      f.payment_state === "cleared" &&
      !f.payment_proof_file &&
      !isPettyCashReceipt
    )
      return toast.error("Upload proof of payment before clearing");
    if (
      ["bank_transfer", "gcash"].includes(f.payment_method) &&
      f.payment_state === "cleared" &&
      !f.payment_source_reference.trim()
    )
      return toast.error("Reference is required before clearing");
    onSubmit({
      ...f,
      job_order_id: f.allocation_mode === "single" ? f.job_order_id : null,
      petty_cash_batch_id: f.payment_method === "petty_cash" ? f.petty_cash_batch_id : null,
      quantity: isMaterial ? Number(f.quantity) : null,
      unit_of_measure: isMaterial ? f.unit_of_measure : "",
      unit_cost: isMaterial ? Number(f.unit_cost) : null,
      amount,
      tax_amount: taxAmount,
      tax_type: f.tax_type,
      expense_type: f.expense_type as GeneralExpenseFormValues["expense_type"],
      disbursement_category: f.disbursement_category,
      disbursement_subcategory: f.disbursement_subcategory,
      payment_status: isPettyCashReceipt || f.payment_state === "cleared" ? "paid" : "pending",
      payment_method: f.payment_method as GeneralExpenseFormValues["payment_method"],
      payment_state: f.payment_state as GeneralExpenseFormValues["payment_state"],
      payment_source: f.payment_source,
      payment_source_reference: f.payment_source_reference,
      payment_proof_file: f.payment_proof_file,
      receipt_missing_reason: f.receipt_missing_reason.trim(),
    });
  }

  if (!initialPettyCashBatch && !initialExpense) {
    return (
      <GeneralExpenseStepperForm
        onSubmit={onSubmit}
        busy={busy}
        onCancel={onCancel}
        submitLabel={submitLabel}
      />
    );
  }

  if (isPettyCashReceipt) {
    const availableBatchBalance =
      Number(initialPettyCashBatch?.funding_total ?? 0) -
      Number(initialPettyCashBatch?.receipts_total ?? 0);
    const batchBalanceAfterReceipt = availableBatchBalance - Number(f.amount || 0);
    const isDeliveryReceipt = f.expense_type === "delivery";
    const isUtilityReceipt = f.disbursement_category === "utilities";
    const isMaterialReceipt = f.disbursement_category === "direct_materials";
    const payeeLabel = isDeliveryReceipt
      ? "Delivery provider"
      : isUtilityReceipt
        ? "Service provider"
        : "Payee / Company";
    const payeePlaceholder = isDeliveryReceipt
      ? "e.g. Lalamove, Transportify"
      : isUtilityReceipt
        ? "e.g. Meralco, Maynilad"
        : isMaterialReceipt
          ? "e.g. Hardware or supply store"
          : "e.g. Wilcon Depot, Ace Hardware";
    const setReceiptCategory = (
      category: DisbursementCategory,
      subcategory: DisbursementSubcategory,
      expenseType: GeneralExpenseFormValues["expense_type"],
    ) =>
      setF({
        ...f,
        // A simple petty-cash receipt should never turn into the materials-quantity workflow.
        expense_type: expenseType,
        disbursement_category: category,
        disbursement_subcategory: subcategory,
        quantity: "",
        unit_of_measure: "",
        unit_cost: "",
      });
    const moveToReceiptProof = () => {
      if (!f.expense_date) return toast.error("Date is required");
      if (!f.description.trim()) return toast.error("What you bought is required");
      if (Number(f.amount) <= 0) return toast.error("Amount must be greater than zero");
      setPettyCashStep(3);
    };

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pettyCashStep === 1) return setPettyCashStep(2);
          if (pettyCashStep === 2) return moveToReceiptProof();
          submit();
        }}
        className="petty-cash-receipt-layout flex min-h-0 flex-1 flex-col"
      >
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5 sm:px-8">
          <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900 dark:bg-blue-950/20 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <CheckCircle2
                className="h-11 w-11 shrink-0 fill-blue-600 text-white"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">
                  Paid from petty cash · {initialPettyCashBatch?.funding_source || "Cash advance"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  This receipt will be recorded against the selected petty-cash batch when you save
                  it.
                </p>
              </div>
              <div className="border-t border-blue-200 pt-3 sm:border-l sm:border-t-0 sm:pl-8 sm:pt-0 dark:border-blue-900">
                <p className="text-sm text-muted-foreground">Estimated batch balance after save</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
                  {peso(batchBalanceAfterReceipt)}
                </p>
              </div>
            </div>
          </div>

          <ol
            className="grid grid-cols-3 gap-2 text-center text-xs sm:text-sm"
            aria-label="Receipt steps"
          >
            {[
              [1, "Project cost"],
              [2, "Receipt details"],
              [3, "Receipt proof"],
            ].map(([step, label]) => {
              const current = pettyCashStep === step;
              const complete = pettyCashStep > Number(step);
              return (
                <li
                  key={step}
                  className={current ? "font-semibold text-foreground" : "text-muted-foreground"}
                  aria-current={current ? "step" : undefined}
                >
                  <span
                    className={`mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-full text-xs ${current || complete ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                  >
                    {complete ? "✓" : step}
                  </span>
                  {label}
                </li>
              );
            })}
          </ol>

          {pettyCashStep === 2 ? (
            <>
              <div className="space-y-2 sm:max-w-[26rem]">
                <Label>Date *</Label>
                <Input
                  type="date"
                  required
                  max={today}
                  value={f.expense_date}
                  onChange={(e) => setF({ ...f, expense_date: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Use the date on the receipt, if available.
                </p>
              </div>

              <div className="space-y-2">
                <Label>What did you buy? *</Label>
                <Textarea
                  rows={3}
                  required
                  maxLength={200}
                  value={f.description}
                  onChange={(e) => setF({ ...f, description: e.target.value })}
                  placeholder="e.g. Cleaning supplies, light bulbs, pails"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Write a short, clear description.</span>
                  <span>{f.description.length}/200</span>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Amount *</Label>
                  <div className="flex">
                    <span className="flex h-10 items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm font-medium">
                      ₱
                    </span>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={f.amount}
                      onChange={(e) => setF({ ...f, amount: e.target.value })}
                      placeholder="0.00"
                      className="rounded-l-none"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Enter the amount shown on the receipt.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>
                    {payeeLabel} <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  {isDeliveryReceipt ? (
                    <>
                      <Select
                        value={deliveryProviderChoice}
                        onValueChange={(value) => {
                          setDeliveryProviderChoice(value);
                          setF({ ...f, supplier_name: value === "other" ? "" : value });
                        }}
                      >
                        <SelectTrigger aria-label="Delivery provider">
                          <SelectValue placeholder="Choose a delivery provider" />
                        </SelectTrigger>
                        <SelectContent>
                          {DELIVERY_PROVIDERS.map((provider) => (
                            <SelectItem key={provider} value={provider}>
                              {provider}
                            </SelectItem>
                          ))}
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      {deliveryProviderChoice === "other" ? (
                        <Input
                          aria-label="Custom delivery provider"
                          value={f.supplier_name}
                          onChange={(e) => setF({ ...f, supplier_name: e.target.value })}
                          placeholder="Type the provider name"
                        />
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        Choose the provider, or select Other and type the name.
                      </p>
                    </>
                  ) : (
                    <>
                      <Input
                        value={f.supplier_name}
                        onChange={(e) => setF({ ...f, supplier_name: e.target.value })}
                        placeholder={payeePlaceholder}
                      />
                      <p className="text-xs text-muted-foreground">
                        Store or person you paid, if known.
                      </p>
                    </>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Tax treatment</Label>
                  <p className="text-xs text-muted-foreground">
                    Choose how VAT appears on the receipt.
                  </p>
                  <Select
                    value={pettyCashTaxMode}
                    onValueChange={(value) => {
                      const mode = value as typeof pettyCashTaxMode;
                      const base = Number(f.amount || 0);
                      const tax =
                        mode === "vat_included"
                          ? base * (12 / 112)
                          : mode === "add_vat"
                            ? base * 0.12
                            : 0;
                      setPettyCashTaxMode(mode);
                      setF({
                        ...f,
                        amount: f.amount,
                        tax_amount: mode === "custom" ? f.tax_amount : tax.toFixed(2),
                        tax_type: mode === "none" ? "non_vat" : "vatable",
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No tax</SelectItem>
                      <SelectItem value="vat_included">VAT included in receipt total</SelectItem>
                      <SelectItem value="add_vat">Add 12% VAT to subtotal</SelectItem>
                      <SelectItem value="custom">Enter a custom tax amount</SelectItem>
                    </SelectContent>
                  </Select>
                  {pettyCashTaxMode === "custom" ? (
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={f.tax_amount}
                      onChange={(e) => setF({ ...f, tax_amount: e.target.value })}
                      placeholder="Tax amount"
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Tax: {peso(Number(f.tax_amount || 0))} · Total:{" "}
                      {peso(
                        Number(f.amount || 0) +
                          (pettyCashTaxMode === "add_vat" ? Number(f.tax_amount || 0) : 0),
                      )}
                    </p>
                  )}
                </div>
                <div className="flex min-h-[116px] flex-col justify-center rounded-lg border bg-primary/5 px-4 py-3">
                  <p className="text-sm font-medium text-muted-foreground">Total</p>
                  <h3 className="mt-1 text-3xl font-semibold tracking-tight">
                    {peso(
                      Number(f.amount || 0) +
                        (pettyCashTaxMode === "add_vat" ? Number(f.tax_amount || 0) : 0),
                    )}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">Amount plus tax treatment</p>
                </div>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">What was it for? *</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    {
                      label: "Materials",
                      icon: Wrench,
                      category: "direct_materials",
                      subcategory: "direct_materials",
                      expenseType: "miscellaneous",
                    },
                    {
                      label: "Delivery",
                      icon: Truck,
                      category: "other",
                      subcategory: "other",
                      expenseType: "delivery",
                    },
                    {
                      label: "Utilities",
                      icon: Lightbulb,
                      category: "utilities",
                      subcategory: "other",
                      expenseType: "miscellaneous",
                    },
                    {
                      label: "Other",
                      icon: MoreHorizontal,
                      category: "other",
                      subcategory: "other",
                      expenseType: "miscellaneous",
                    },
                  ].map((choice) => {
                    const active =
                      f.disbursement_category === choice.category &&
                      f.disbursement_subcategory === choice.subcategory &&
                      f.expense_type === choice.expenseType;
                    return (
                      <Button
                        key={choice.label}
                        type="button"
                        variant={active ? "default" : "outline"}
                        className="h-[76px] flex-col gap-1.5 justify-center"
                        aria-pressed={active}
                        onClick={() =>
                          setReceiptCategory(
                            choice.category as DisbursementCategory,
                            choice.subcategory as DisbursementSubcategory,
                            choice.expenseType as GeneralExpenseFormValues["expense_type"],
                          )
                        }
                      >
                        <choice.icon className="h-5 w-5" aria-hidden="true" />
                        {choice.label}
                      </Button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Choose the closest fit for this expense.
                </p>
              </fieldset>
            </>
          ) : null}

          {pettyCashStep === 3 ? (
            <>
              <section
                className="space-y-3 rounded-lg border bg-muted/20 p-3 sm:p-4"
                aria-labelledby="receipt-heading"
              >
                <h3 id="receipt-heading" className="text-sm font-medium">
                  Receipt *
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant={!receiptUnavailable ? "default" : "outline"}
                    className="h-auto min-h-[82px] justify-start whitespace-normal px-4 py-3 text-left"
                    onClick={() => setReceiptUnavailable(false)}
                    aria-pressed={!receiptUnavailable}
                  >
                    <Upload className="mr-3 h-7 w-7 shrink-0" aria-hidden="true" />
                    <span>
                      <span className="block">Upload receipt</span>
                      <span className="mt-1 block text-xs font-normal opacity-80">
                        Attach a photo or PDF of the receipt.
                      </span>
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant={receiptUnavailable ? "default" : "outline"}
                    className="h-auto min-h-[82px] justify-start whitespace-normal px-4 py-3 text-left"
                    onClick={() => setReceiptUnavailable(true)}
                    aria-pressed={receiptUnavailable}
                  >
                    <FileX2 className="mr-3 h-7 w-7 shrink-0" aria-hidden="true" />
                    <span>
                      <span className="block">No receipt available</span>
                      <span className="mt-1 block text-xs font-normal opacity-80">
                        Continue without a receipt.
                      </span>
                    </span>
                  </Button>
                </div>
                {receiptUnavailable ? (
                  <div className="space-y-2">
                    <Label>No receipt reason *</Label>
                    <Input
                      required
                      value={f.receipt_missing_reason}
                      onChange={(e) => setF({ ...f, receipt_missing_reason: e.target.value })}
                      placeholder="Briefly explain why the receipt is unavailable"
                    />
                    <p className="text-xs text-muted-foreground">
                      This reason is saved for review.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label
                      htmlFor="petty-cash-receipt-file"
                      className="flex min-h-[76px] cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-4 text-center hover:bg-muted/40"
                    >
                      <Upload className="mb-1 h-6 w-6 text-muted-foreground" aria-hidden="true" />
                      <span>
                        <strong>Click to upload</strong> or drag and drop
                      </span>
                      <span className="mt-1 text-xs font-normal text-muted-foreground">
                        JPG, PNG, WEBP, or PDF (max 5 MB)
                      </span>
                    </Label>
                    <Input
                      id="petty-cash-receipt-file"
                      type="file"
                      required
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="w-full text-sm"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        setF({ ...f, payment_proof_file: file, receipt_missing_reason: "" });
                      }}
                    />
                    {f.payment_proof_file ? (
                      <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                        Selected: <span className="font-medium">{f.payment_proof_file.name}</span>
                        <span className="ml-2 text-muted-foreground">
                          ({Math.ceil(f.payment_proof_file.size / 1024)} KB)
                        </span>
                      </p>
                    ) : null}
                  </div>
                )}
              </section>

              <details className="rounded-lg border px-3 py-3">
                <summary className="cursor-pointer text-sm font-medium">More details</summary>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Tax</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={f.tax_amount}
                      onChange={(e) => setF({ ...f, tax_amount: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{isDeliveryReceipt ? "Delivery reference" : "DR / Invoice No."}</Label>
                    <Input
                      value={f.supplier_document_no}
                      onChange={(e) => setF({ ...f, supplier_document_no: e.target.value })}
                      placeholder={
                        isDeliveryReceipt
                          ? "Waybill, booking, or tracking number"
                          : "Supplier document number"
                      }
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>{isUtilityReceipt ? "Billing period" : "Remarks"}</Label>
                    <Textarea
                      rows={3}
                      value={f.remarks}
                      onChange={(e) => setF({ ...f, remarks: e.target.value })}
                      placeholder={isUtilityReceipt ? "e.g. September 2026" : undefined}
                    />
                  </div>
                </div>
              </details>
            </>
          ) : null}

          {pettyCashStep === 1 ? (
            <section className="rounded-lg border px-3 py-3">
              <div className="mt-4 space-y-3">
                <Label>Where should this cost go?</Label>
                <p className="text-sm text-muted-foreground">
                  Choose a Job Order now if you know it, or decide later after the actual use is
                  confirmed.
                </p>
                <Select
                  value={f.allocation_mode}
                  onValueChange={(value) =>
                    setF({
                      ...f,
                      allocation_mode: value as typeof f.allocation_mode,
                      job_order_id: value === "single" ? f.job_order_id : null,
                      allocations:
                        value === "shared" && f.allocations.length === 0
                          ? [
                              { job_order_id: "", allocated_amount: 0 },
                              { job_order_id: "", allocated_amount: 0 },
                            ]
                          : f.allocations,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">Arlechino company expense</SelectItem>
                    <SelectItem value="single">Charge one Job Order</SelectItem>
                    <SelectItem value="shared">Split across Job Orders</SelectItem>
                  </SelectContent>
                </Select>
                {f.allocation_mode === "single" ? (
                  <div className="space-y-2">
                    <Input
                      value={jobOrderSearch}
                      onChange={(e) => setJobOrderSearch(e.target.value)}
                      placeholder="Search Job Order, project, or client"
                      aria-label="Search Job Order"
                    />
                    {!selectedSingleJobOrder || jobOrderSearch.trim() ? (
                      <div
                        role="listbox"
                        aria-label="Search results"
                        className="max-h-52 overflow-y-auto rounded-md border bg-background p-1"
                      >
                        {matchingJobOrders.length ? (
                          matchingJobOrders.map((job) => (
                            <button
                              key={job.id}
                              type="button"
                              role="option"
                              className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-muted"
                              onClick={() => {
                                setF({ ...f, job_order_id: job.id });
                                setJobOrderSearch("");
                              }}
                            >
                              <span className="font-medium">{job.job_number}</span>
                              <span className="text-muted-foreground">
                                {" "}
                                · {job.project_name}
                                {job.customer?.customer_name
                                  ? ` · ${job.customer.customer_name}`
                                  : ""}
                              </span>
                            </button>
                          ))
                        ) : (
                          <p className="px-2 py-2 text-sm text-muted-foreground">
                            No Job Orders match “{jobOrderSearch.trim()}”.
                          </p>
                        )}
                      </div>
                    ) : selectedSingleJobOrder ? (
                      <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{selectedSingleJobOrder.job_number}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            · {selectedSingleJobOrder.project_name}
                            {selectedSingleJobOrder.customer?.customer_name
                              ? ` · ${selectedSingleJobOrder.customer.customer_name}`
                              : ""}
                          </span>
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setF({ ...f, job_order_id: null })}
                        >
                          Clear
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Search to choose a Job Order, or leave this receipt unassigned for now.
                      </p>
                    )}
                  </div>
                ) : null}
                {f.allocation_mode === "shared" ? (
                  <div className="space-y-2 rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">
                      Enter only the confirmed amount used by each Job Order.
                    </p>
                    {f.allocations.map((allocation, index) => (
                      <div className="grid gap-2 sm:grid-cols-[1fr_10rem]" key={index}>
                        <Select
                          value={allocation.job_order_id || "none"}
                          onValueChange={(value) =>
                            setF({
                              ...f,
                              allocations: f.allocations.map((row, i) =>
                                i === index
                                  ? { ...row, job_order_id: value === "none" ? "" : value }
                                  : row,
                              ),
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choose Job Order" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Choose Job Order</SelectItem>
                            {(jobOrders.data ?? []).map((job) => (
                              <SelectItem key={job.id} value={job.id}>
                                {job.job_number} · {job.project_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder="Share amount"
                          value={allocation.allocated_amount || ""}
                          onChange={(e) =>
                            setF({
                              ...f,
                              allocations: f.allocations.map((row, i) =>
                                i === index
                                  ? { ...row, allocated_amount: Number(e.target.value) }
                                  : row,
                              ),
                            })
                          }
                        />
                      </div>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setF({
                          ...f,
                          allocations: [
                            ...f.allocations,
                            { job_order_id: "", allocated_amount: 0 },
                          ],
                        })
                      }
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add Job Order
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Allocated: {peso(allocatedShareAmount)} · Still unallocated:{" "}
                      {peso(Math.max(0, Number(f.amount || 0) - allocatedShareAmount))}
                    </p>
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Leave this unassigned until the project use is confirmed. It stays outside Project
                  Profitability until someone confirms it.
                </p>
              </div>
            </section>
          ) : null}
        </div>
        <DialogFooter className="shrink-0 gap-2 border-t bg-background px-6 py-4 sm:gap-2 sm:px-8">
          {pettyCashStep > 1 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setPettyCashStep((pettyCashStep - 1) as 1 | 2)}
            >
              Back
            </Button>
          ) : onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          {pettyCashStep === 1 ? (
            <Button type="button" onClick={() => setPettyCashStep(2)}>
              Continue to receipt details
            </Button>
          ) : null}
          {pettyCashStep === 2 ? (
            <Button type="button" onClick={moveToReceiptProof}>
              Continue to receipt proof
            </Button>
          ) : null}
          {pettyCashStep === 3 ? (
            <Button type="submit" disabled={busy}>
              {busy ? "Saving..." : submitLabel}
            </Button>
          ) : null}
        </DialogFooter>
      </form>
    );
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
        <details className="rounded-md border px-3 py-2 sm:col-span-2">
          <summary className="cursor-pointer text-sm font-medium">
            Assign to a Job Order later (optional)
          </summary>
          <div className="mt-3 space-y-2">
            <Label>Project cost (optional)</Label>
            <Select
              value={f.allocation_mode}
              onValueChange={(value) =>
                setF({
                  ...f,
                  allocation_mode: value as typeof f.allocation_mode,
                  job_order_id: value === "single" ? f.job_order_id : null,
                  allocations:
                    value === "shared" && f.allocations.length === 0
                      ? [
                          { job_order_id: "", allocated_amount: 0 },
                          { job_order_id: "", allocated_amount: 0 },
                        ]
                      : f.allocations,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general">Arlechino company expense</SelectItem>
                <SelectItem value="single">Charge one Job Order</SelectItem>
                <SelectItem value="shared">Split across Job Orders</SelectItem>
              </SelectContent>
            </Select>
            {f.allocation_mode === "single" ? (
              <div className="space-y-2">
                <Input
                  value={jobOrderSearch}
                  onChange={(event) => setJobOrderSearch(event.target.value)}
                  placeholder="Search Job Order, project, or client"
                  aria-label="Search Job Order"
                />
                {!selectedSingleJobOrder || jobOrderSearch.trim() ? (
                  <div
                    role="listbox"
                    aria-label="Search results"
                    className="max-h-52 overflow-y-auto rounded-md border bg-background p-1"
                  >
                    <p className="px-2 py-1 text-xs text-muted-foreground">Search results</p>
                    {matchingJobOrders.length ? (
                      matchingJobOrders.map((job) => (
                        <button
                          key={job.id}
                          type="button"
                          role="option"
                          className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                          onClick={() => {
                            setF({ ...f, job_order_id: job.id });
                            setJobOrderSearch("");
                          }}
                        >
                          <span className="font-medium">{job.job_number}</span>
                          <span className="text-muted-foreground"> · {job.project_name}</span>
                          {job.customer?.customer_name ? (
                            <span className="text-muted-foreground">
                              {" "}
                              · {job.customer.customer_name}
                            </span>
                          ) : null}
                        </button>
                      ))
                    ) : (
                      <p className="px-2 py-2 text-sm text-muted-foreground">
                        No Job Orders match “{jobOrderSearch.trim()}”.
                      </p>
                    )}
                  </div>
                ) : selectedSingleJobOrder ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{selectedSingleJobOrder.job_number}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {selectedSingleJobOrder.project_name}
                        {selectedSingleJobOrder.customer?.customer_name
                          ? ` · ${selectedSingleJobOrder.customer.customer_name}`
                          : ""}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setF({ ...f, job_order_id: null })}
                    >
                      Clear
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Search to choose a Job Order, or leave this expense unassigned for now.
                  </p>
                )}
              </div>
            ) : null}
            {f.allocation_mode === "shared" ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-xs text-muted-foreground">
                  Enter only the confirmed project use. Each Job Order receives only its share.
                </p>
                {f.allocations.map((allocation, index) => (
                  <div className="grid gap-2 sm:grid-cols-[1fr_10rem]" key={index}>
                    <Select
                      value={allocation.job_order_id || "none"}
                      onValueChange={(value) =>
                        setF({
                          ...f,
                          allocations: f.allocations.map((row, i) =>
                            i === index
                              ? { ...row, job_order_id: value === "none" ? "" : value }
                              : row,
                          ),
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose Job Order" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Choose Job Order</SelectItem>
                        {(jobOrders.data ?? []).map((job) => (
                          <SelectItem key={job.id} value={job.id}>
                            {job.job_number} · {job.project_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="Share amount"
                      value={allocation.allocated_amount || ""}
                      onChange={(e) =>
                        setF({
                          ...f,
                          allocations: f.allocations.map((row, i) =>
                            i === index
                              ? { ...row, allocated_amount: Number(e.target.value) }
                              : row,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setF({
                      ...f,
                      allocations: [...f.allocations, { job_order_id: "", allocated_amount: 0 }],
                    })
                  }
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add Job Order
                </Button>
                <p className="text-xs text-muted-foreground">
                  Allocated: {peso(allocatedShareAmount)} · Still unallocated:{" "}
                  {peso(Math.max(0, Number(f.amount || 0) - allocatedShareAmount))}
                </p>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Leave this unassigned when the actual project use is not confirmed. It stays outside
              Project Profitability until someone confirms the amount used by each Job Order.
            </p>
          </div>
        </details>
        <div className="space-y-2">
          <Label>Date *</Label>
          <Input
            type="date"
            required
            max={today}
            value={f.expense_date}
            onChange={(e) => setF({ ...f, expense_date: e.target.value })}
          />
        </div>
        {f.disbursement_category === "other" ? (
          <div className="space-y-2">
            <Label>Expense type</Label>
            <Select
              value={f.expense_type}
              onValueChange={(v) =>
                setF({
                  ...f,
                  expense_type: v as GeneralExpenseFormValues["expense_type"],
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
                <SelectItem value="delivery">Transport / Delivery</SelectItem>
                <SelectItem value="installation">Installation</SelectItem>
                <SelectItem value="outsourcing">Outsourcing</SelectItem>
                <SelectItem value="miscellaneous">Miscellaneous</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>What is this expense for? *</Label>
          <Select
            value={f.disbursement_category}
            onValueChange={(value) => {
              const category = value as DisbursementCategory;
              setF({
                ...f,
                disbursement_category: category,
                disbursement_subcategory: "",
                expense_type: category === "direct_materials" ? "materials" : f.expense_type,
              });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DISBURSEMENT_CATEGORIES.filter((category) => category.value !== "petty_cash").map(
                (category) => (
                  <SelectItem key={category.value} value={category.value}>
                    {category.label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
        {hasUsefulSubcategories ? (
          <div className="space-y-2">
            <Label>Subcategory</Label>
            <Select
              value={f.disbursement_subcategory || "none"}
              onValueChange={(value) =>
                setF({
                  ...f,
                  disbursement_subcategory:
                    value === "none" ? "" : (value as DisbursementSubcategory),
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {subcategoryOptions.map((subcategory) => (
                  <SelectItem key={subcategory.value} value={subcategory.value}>
                    {subcategory.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Payee / Company</Label>
          <Input
            value={f.supplier_name}
            onChange={(e) => setF({ ...f, supplier_name: e.target.value })}
            placeholder={
              f.expense_type === "delivery"
                ? "e.g. Lalamove, Transportify, or truck contractor"
                : "Supplier or payee"
            }
          />
          {f.supplier_name.trim()
            ? (supplierMaster.data ?? [])
                .filter((supplier) =>
                  supplier.name.toLowerCase().includes(f.supplier_name.trim().toLowerCase()),
                )
                .slice(0, 6)
                .map((supplier) => (
                  <button
                    key={supplier.id}
                    type="button"
                    className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                    onClick={() =>
                      setF({
                        ...f,
                        supplier_id: supplier.id,
                        supplier_name: supplier.name,
                        supplier_tin: supplier.tin_number ?? "",
                        supplier_address: supplier.address ?? "",
                      })
                    }
                  >
                    <span className="font-medium">{supplier.name}</span>
                    <span className="ml-2 text-muted-foreground">Use saved supplier</span>
                  </button>
                ))
            : null}
          {(supplierSuggestions.data ?? []).length > 0 ? (
            <div className="rounded-md border bg-background p-1 text-xs shadow-sm">
              <div className="px-2 py-1 text-muted-foreground">Existing suppliers</div>
              {(supplierSuggestions.data ?? []).map((supplier) => (
                <button
                  key={supplier.supplier_name}
                  type="button"
                  className="block w-full rounded px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() =>
                    setF({
                      ...f,
                      supplier_id: null,
                      supplier_name: supplier.supplier_name ?? "",
                      supplier_tin: supplier.supplier_tin ?? "",
                      supplier_address: supplier.supplier_address ?? "",
                    })
                  }
                >
                  <span className="font-medium">{supplier.supplier_name}</span>
                  <span className="ml-2 text-muted-foreground">Use saved details</span>
                </button>
              ))}
            </div>
          ) : null}
          {f.supplier_name.trim() && !supplierMaster.isLoading ? (
            <button
              type="button"
              disabled={supplierCreateBusy}
              className="mt-1 block w-full rounded border-t px-2 py-2 text-left text-xs font-medium text-primary hover:bg-muted disabled:opacity-50"
              onClick={() => void createSupplierFromExpense()}
            >
              {supplierCreateBusy
                ? "Adding supplier…"
                : `+ Add “${f.supplier_name.trim()}” as a supplier`}
            </button>
          ) : null}
        </div>
        {isPettyCashReceipt ? (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="text-muted-foreground">Paid from petty cash</div>
            <div className="font-medium">
              {initialPettyCashBatch?.funding_source || "Cash advance"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              This receipt is already paid and will reduce the selected batch balance.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Label>Record payment details</Label>
            <Select
              value={f.payment_method}
              onValueChange={(v) =>
                setF({ ...f, payment_method: v as GeneralExpenseFormValues["payment_method"] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unpaid">Not paid yet</SelectItem>
                <SelectItem value="check">Check</SelectItem>
                <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                <SelectItem value="gcash">GCash</SelectItem>
              </SelectContent>
            </Select>
            {f.payment_method === "unpaid" ? (
              <p className="text-xs text-muted-foreground">
                Save the expense now. Add the check or transfer details when it is paid.
              </p>
            ) : null}
          </div>
        )}
      </div>
      {isPettyCashReceipt ? (
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          <div className="space-y-2">
            <Label>Payment option *</Label>
            <Select
              value={f.payment_source || "Cash"}
              onValueChange={(value) => setF({ ...f, payment_source: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose payment option" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="BDO">BDO</SelectItem>
                <SelectItem value="GCash">GCash</SelectItem>
                <SelectItem value="Bank transfer">Bank transfer</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Receipt upload *</Label>
            <Input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setF({
                  ...f,
                  payment_proof_file: file,
                  receipt_missing_reason: file ? "" : f.receipt_missing_reason,
                });
                if (file) setReceiptUnavailable(false);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Upload the supplier receipt. It is kept with this liquidation and supports the batch
              balance.
            </p>
          </div>
          {!f.payment_proof_file ? (
            <>
              <Button
                type="button"
                variant="ghost"
                className="h-auto justify-start px-0 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground"
                onClick={() => setReceiptUnavailable((value) => !value)}
              >
                {receiptUnavailable ? "I can upload a receipt" : "I don't have a receipt"}
              </Button>
              {receiptUnavailable ? (
                <div className="space-y-2">
                  <Label>No receipt reason *</Label>
                  <Input
                    required
                    value={f.receipt_missing_reason}
                    onChange={(e) => setF({ ...f, receipt_missing_reason: e.target.value })}
                    placeholder="Briefly explain why the receipt is unavailable"
                  />
                  <p className="text-xs text-muted-foreground">
                    This reason will be saved with the receipt for review.
                  </p>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : (
        <>
          {f.payment_method !== "unpaid" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Payment Status *</Label>
                <Select
                  value={f.payment_state}
                  onValueChange={(v) =>
                    setF({ ...f, payment_state: v as GeneralExpenseFormValues["payment_state"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="released">Released</SelectItem>
                    <SelectItem value="cleared">Cleared</SelectItem>
                    <SelectItem value="held">Payment held</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {f.payment_method !== "check" ? (
                <div className="space-y-2">
                  <Label>Payment source{f.payment_method === "petty_cash" ? " *" : ""}</Label>
                  <Input
                    value={f.payment_source}
                    onChange={(e) => setF({ ...f, payment_source: e.target.value })}
                    placeholder="Bank, cash account, or wallet"
                  />
                </div>
              ) : (
                <div className="hidden sm:block" />
              )}
            </div>
          ) : null}
          {needsPaymentProof ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  Source reference
                  {["bank_transfer", "gcash"].includes(f.payment_method) ? " *" : ""}
                </Label>
                <Input
                  value={f.payment_source_reference}
                  onChange={(e) => setF({ ...f, payment_source_reference: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Upload proof of payment{f.payment_state === "cleared" ? " *" : ""}</Label>
                <Input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => setF({ ...f, payment_proof_file: e.target.files?.[0] ?? null })}
                />
              </div>
            </div>
          ) : null}
        </>
      )}
      {needsSupplierDetails ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>TIN</Label>
            <Input
              value={f.supplier_tin}
              onChange={(e) => setF({ ...f, supplier_tin: e.target.value })}
              placeholder="Supplier TIN"
            />
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Input
              value={f.supplier_address}
              onChange={(e) => setF({ ...f, supplier_address: e.target.value })}
              placeholder="Supplier address"
            />
          </div>
        </div>
      ) : null}
      <div className="space-y-2">
        <Label>Description *</Label>
        <Textarea
          rows={2}
          required
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
      </div>
      {isMaterial ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Qty *</Label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={f.quantity}
              onChange={(e) => setF({ ...f, quantity: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Unit *</Label>
            <Input
              required
              value={f.unit_of_measure}
              onChange={(e) => setF({ ...f, unit_of_measure: e.target.value })}
              placeholder="e.g. pcs, sheets, rolls"
            />
          </div>
          <div className="space-y-2">
            <Label>Unit Cost *</Label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={f.unit_cost}
              onChange={(e) => setF({ ...f, unit_cost: e.target.value })}
            />
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>{isMaterial ? "Computed Amount *" : "Amount *"}</Label>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            required
            readOnly={isMaterial}
            value={isMaterial ? materialAmount.toFixed(2) : f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })}
          />
          {isMaterial ? (
            <p className="text-xs text-muted-foreground">Calculated from Qty × Unit Cost.</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label>VAT mode</Label>
          <Select
            value={f.tax_type}
            onValueChange={(value) => setF({ ...f, tax_type: value as typeof f.tax_type })}
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
      <details className="rounded-md border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">More details</summary>
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tax</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={f.tax_amount}
                onChange={(e) => setF({ ...f, tax_amount: e.target.value })}
              />
            </div>
            {!isPettyCashReceipt ? (
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
            {!isPettyCashReceipt ? (
              <div className="space-y-2">
                <Label>Voucher / Ref No.</Label>
                <Input
                  value={f.reference_no}
                  onChange={(e) => setF({ ...f, reference_no: e.target.value })}
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>DR / Invoice No.</Label>
              <Input
                value={f.supplier_document_no}
                onChange={(e) => setF({ ...f, supplier_document_no: e.target.value })}
                placeholder="Supplier document number"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Remarks</Label>
            <Textarea
              rows={3}
              value={f.remarks}
              onChange={(e) => setF({ ...f, remarks: e.target.value })}
            />
          </div>
        </div>
      </details>
      <div
        className={`grid gap-3 ${f.payment_method === "check" && ["released", "cleared"].includes(f.payment_state) && !isPettyCashReceipt ? "sm:grid-cols-3" : ""}`}
      >
        {f.payment_method === "check" &&
        ["released", "cleared"].includes(f.payment_state) &&
        !isPettyCashReceipt ? (
          <div className="space-y-2">
            <Label>Check Date *</Label>
            <Input
              type="date"
              required
              value={f.check_date}
              onChange={(e) => setF({ ...f, check_date: e.target.value })}
            />
          </div>
        ) : null}
        {f.payment_method === "check" &&
        ["released", "cleared"].includes(f.payment_state) &&
        !isPettyCashReceipt ? (
          <div className="space-y-2">
            <Label>Check No. *</Label>
            <Input
              required
              value={f.check_number}
              onChange={(e) => setF({ ...f, check_number: e.target.value })}
            />
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving..." : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

function GeneralExpenseStepperForm({
  onSubmit,
  busy,
  onCancel,
  submitLabel,
}: {
  onSubmit: (values: GeneralExpenseFormValues) => void;
  busy?: boolean;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const today = dateInputValue(new Date());
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [search, setSearch] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ name: "", tin: "", address: "", contact_person: "", phone: "", email: "", payment_terms: "" });
  const [deliveryProviderChoice, setDeliveryProviderChoice] = useState("");
  const [taxMode, setTaxMode] = useState<"none" | "vat_included" | "add_vat" | "custom">("none");
  const [f, setF] = useState({
    allocation_mode: "general" as "general" | "single" | "shared",
    job_order_id: null as string | null,
    allocations: [] as Array<{ job_order_id: string; allocated_amount: number }>,
    expense_date: today,
    expense_type: "miscellaneous" as GeneralExpenseFormValues["expense_type"],
    disbursement_category: "other" as DisbursementCategory,
    disbursement_subcategory: "" as DisbursementSubcategory | "",
    supplier_name: "",
    supplier_id: null as string | null,
    supplier_tin: "",
    supplier_address: "",
    payment_terms: "",
    description: "",
    quantity: "",
    unit_of_measure: "",
    unit_cost: "",
    amount: "",
    tax_amount: "",
    tax_type: "non_vat" as GeneralExpenseFormValues["tax_type"],
    due_date: "",
    reference_no: "",
    supplier_document_no: "",
    remarks: "",
    payment_proof_file: null as File | null,
  });
  const jobOrders = useQuery({
    queryKey: ["general-expense-stepper-job-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_orders")
        .select("id, job_number, project_name, customer:customers(customer_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const suppliers = useQuery({
    queryKey: ["general-expense-suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((supplier: any) => ({
        id: supplier.id,
        name: supplier.name ?? supplier.supplier_name ?? "",
        tin_number: supplier.tin_number ?? supplier.tin ?? null,
        address: supplier.address ?? supplier.supplier_address ?? null,
        payment_terms: supplier.payment_terms ?? supplier.terms ?? null,
      })) as Array<{ id: string; name: string; tin_number: string | null; address: string | null; payment_terms: string | null }>;
    },
  });
  useEffect(() => {
    const value = f.supplier_name.trim().toLowerCase();
    if (!value || f.supplier_id || !suppliers.data) return;
    const matchedSupplier = suppliers.data.find((supplier) => supplier.name.trim().toLowerCase() === value);
    if (!matchedSupplier) return;
    setF((current) => ({
      ...current,
      supplier_id: matchedSupplier.id,
      supplier_tin: matchedSupplier.tin_number ?? "",
      supplier_address: matchedSupplier.address ?? "",
      payment_terms: matchedSupplier.payment_terms ?? "",
    }));
  }, [f.supplier_id, f.supplier_name, suppliers.data]);
  const createSupplier = async () => {
    const name = supplierSearch.trim();
    if (!name) return toast.error("Enter a supplier name first.");
    setNewSupplier((current) => ({ ...current, name }));
    setSupplierModalOpen(true);
  };
  const saveNewSupplier = async () => {
    if (!newSupplier.name.trim()) return toast.error("Supplier name is required.");
    const { data, error } = await (supabase.from("suppliers") as any).insert({
      name: newSupplier.name.trim(), tin_number: newSupplier.tin.trim() || null,
      address: newSupplier.address.trim() || null, contact_person: newSupplier.contact_person.trim() || null,
      phone: newSupplier.phone.trim() || null, email: newSupplier.email.trim() || null,
      payment_terms: newSupplier.payment_terms.trim() || null, active: true,
    }).select("id,name,tin_number,address").single();
    if (error) return toast.error(error.message);
    setF({ ...f, supplier_id: data.id, supplier_name: data.name, supplier_tin: data.tin_number ?? "", supplier_address: data.address ?? "", payment_terms: newSupplier.payment_terms });
    setSupplierSearch(data.name); setSupplierOpen(false); setSupplierModalOpen(false);
    setNewSupplier({ name: "", tin: "", address: "", contact_person: "", phone: "", email: "", payment_terms: "" });
    await queryClient.invalidateQueries({ queryKey: ["general-expense-suppliers"] });
    toast.success("Supplier added and selected.");
  };
  const material = f.disbursement_category === "direct_materials";
  const baseAmount = material
    ? computeMaterialAmount(f.quantity, f.unit_cost)
    : Number(f.amount || 0);
  const taxAmount =
    taxMode === "vat_included"
      ? baseAmount * (12 / 112)
      : taxMode === "add_vat"
        ? baseAmount * 0.12
        : taxMode === "custom"
          ? Number(f.tax_amount || 0)
          : 0;
  const amount = baseAmount + (taxMode === "add_vat" ? taxAmount : 0);
  const allocatedAmount = f.allocations.reduce(
    (sum, allocation) => sum + Number(allocation.allocated_amount || 0),
    0,
  );
  const matchingJobs = (jobOrders.data ?? []).filter((job) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [job.job_number, job.project_name, job.customer?.customer_name]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
  const selectedJob = (jobOrders.data ?? []).find((job) => job.id === f.job_order_id);
  const subcategories = DISBURSEMENT_SUBCATEGORIES[f.disbursement_category];
  const hasUsefulSubcategories = subcategories.some((item) => item.value !== "other");
  const isDelivery = f.expense_type === "delivery";
  const isUtility = f.disbursement_category === "utilities";
  const descriptionLabel = material
    ? "Material / purchase summary *"
    : isUtility
      ? "What bill or service is this for? *"
      : isDelivery
        ? "What was delivered? *"
        : "What was bought or paid for? *";
  const descriptionPlaceholder = material
    ? "e.g. 50 sheets sintra board"
    : isUtility
      ? "e.g. September electricity bill"
      : isDelivery
        ? "e.g. Tarpaulin delivery to client site"
        : "e.g. Office cleaning supplies";

  const changeAllocationMode = (value: "general" | "single" | "shared") =>
    setF({
      ...f,
      allocation_mode: value,
      job_order_id: value === "single" ? f.job_order_id : null,
      allocations:
        value === "shared" && f.allocations.length === 0
          ? [
              { job_order_id: "", allocated_amount: 0 },
              { job_order_id: "", allocated_amount: 0 },
            ]
          : f.allocations,
    });

  const continueFromDetails = () => {
    if (!f.expense_date) return toast.error("Date is required");
    if (!f.description.trim()) return toast.error("A purchase description is required");
    if (material && Number(f.quantity) <= 0)
      return toast.error("Quantity must be greater than zero");
    if (material && !f.unit_of_measure.trim()) return toast.error("Unit is required");
    if (material && Number(f.unit_cost) <= 0)
      return toast.error("Unit cost must be greater than zero");
    if (amount <= 0) return toast.error("Amount must be greater than zero");
    if (material && !f.supplier_name.trim())
      return toast.error("Company name is required for materials");
    setStep(3);
  };

  const submit = () => {
    if (f.due_date && f.due_date < f.expense_date)
      return toast.error("Due date cannot be before the expense date");
    if (taxAmount < 0) return toast.error("Tax cannot be negative");
    if (f.allocation_mode === "single" && !f.job_order_id)
      return toast.error("Choose a Job Order or leave this unassigned");
    if (f.allocation_mode === "shared") {
      if (f.allocations.some((row) => !row.job_order_id || Number(row.allocated_amount) <= 0))
        return toast.error("Each Job Order share must be greater than zero");
      if (new Set(f.allocations.map((row) => row.job_order_id)).size !== f.allocations.length)
        return toast.error("Choose each Job Order only once");
      if (allocatedAmount - amount > 0.009)
        return toast.error(`Job Order shares cannot exceed ${peso(amount)}`);
    }
    onSubmit({
      job_order_id: f.allocation_mode === "single" ? f.job_order_id : null,
      petty_cash_batch_id: null,
      allocation_mode: f.allocation_mode,
      allocations: f.allocation_mode === "shared" ? f.allocations : [],
      supplier_id: f.supplier_id,
      expense_date: f.expense_date,
      expense_type: f.expense_type,
      disbursement_category: f.disbursement_category,
      disbursement_subcategory: f.disbursement_subcategory,
      supplier_name: f.supplier_name,
      description: f.description,
      quantity: material ? Number(f.quantity) : null,
      unit_of_measure: material ? f.unit_of_measure : "",
      unit_cost: material ? Number(f.unit_cost) : null,
      amount,
      tax_amount: taxAmount,
      tax_type: taxMode === "none" ? "non_vat" : "vatable",
      payment_status: "pending",
      payment_method: "unpaid",
      payment_state: "pending",
      payment_source: "",
      payment_source_reference: "",
      payment_proof_file: f.payment_proof_file,
      receipt_missing_reason: "",
      paid_date: today,
      due_date: f.due_date,
      reference_no: f.reference_no,
      supplier_document_no: f.supplier_document_no,
      supplier_tin: f.supplier_tin,
      supplier_address: f.supplier_address,
      check_date: today,
      check_number: "",
      remarks: f.remarks,
    });
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (step === 1) setStep(2);
        else if (step === 2) continueFromDetails();
        else submit();
      }}
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4 sm:px-8">
        <ol
          className="grid grid-cols-3 gap-2 text-center text-xs sm:text-sm"
          aria-label="General expense steps"
        >
          {[
            [1, "Project cost"],
            [2, "Expense details"],
            [3, "Supporting details"],
          ].map(([index, label]) => {
            const current = step === index;
            const complete = Number(step) > Number(index);
            return (
              <li
                key={String(index)}
                className={current ? "font-semibold text-foreground" : "text-muted-foreground"}
                aria-current={current ? "step" : undefined}
              >
                <span
                  className={`mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-full text-xs ${current || complete ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                >
                  {complete ? "✓" : index}
                </span>
                {label}
              </li>
            );
          })}
        </ol>

        {step === 1 ? (
          <section className="space-y-4 rounded-lg border p-4">
            <div>
              <h3 className="font-medium">Where should this cost go?</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Leave it outside projects until actual usage is known. It will not affect Project
                Profitability yet.
              </p>
            </div>
            <Select
              value={f.allocation_mode}
              onValueChange={(value) => changeAllocationMode(value as typeof f.allocation_mode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general">Arlechino company expense</SelectItem>
                <SelectItem value="single">Charge one Job Order</SelectItem>
                <SelectItem value="shared">Split across Job Orders</SelectItem>
              </SelectContent>
            </Select>
            {f.allocation_mode === "general" ? (
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
                <span className="font-medium">Arlechino company expense</span>
                <span className="ml-2 text-muted-foreground">No Job Order is needed.</span>
              </div>
            ) : null}
            {f.allocation_mode === "single" ? (
              <div className="space-y-2">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search JO number, project, or client"
                  aria-label="Search Job Order"
                />
                {!f.job_order_id || search.trim() ? (
                  <div
                    role="listbox"
                    aria-label="Search results"
                    className="max-h-52 overflow-y-auto rounded-md border bg-background p-1"
                  >
                    {matchingJobs.length ? (
                      matchingJobs.map((job) => (
                        <button
                          key={job.id}
                          type="button"
                          role="option"
                          className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => {
                            setF({ ...f, job_order_id: job.id });
                            setSearch("");
                          }}
                        >
                          <span className="font-medium">{job.job_number}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            · {job.project_name}
                            {job.customer?.customer_name ? ` · ${job.customer.customer_name}` : ""}
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="px-2 py-2 text-sm text-muted-foreground">
                        No Job Orders match “{search.trim()}”.
                      </p>
                    )}
                  </div>
                ) : selectedJob ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{selectedJob.job_number}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {selectedJob.project_name}
                        {selectedJob.customer?.customer_name
                          ? ` · ${selectedJob.customer.customer_name}`
                          : ""}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setF({ ...f, job_order_id: null })}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Search and choose a Job Order.</p>
                )}
              </div>
            ) : null}
            {f.allocation_mode === "shared" ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-xs text-muted-foreground">
                  Enter the actual amount used by each Job Order. Any remaining amount stays outside
                  Project Profitability.
                </p>
                {f.allocations.map((allocation, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                    <Select
                      value={allocation.job_order_id || "none"}
                      onValueChange={(value) =>
                        setF({
                          ...f,
                          allocations: f.allocations.map((row, rowIndex) =>
                            rowIndex === index
                              ? { ...row, job_order_id: value === "none" ? "" : value }
                              : row,
                          ),
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose Job Order" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Choose Job Order</SelectItem>
                        {(jobOrders.data ?? []).map((job) => (
                          <SelectItem key={job.id} value={job.id}>
                            {job.job_number} · {job.project_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="Share amount"
                      value={allocation.allocated_amount || ""}
                      onChange={(event) =>
                        setF({
                          ...f,
                          allocations: f.allocations.map((row, rowIndex) =>
                            rowIndex === index
                              ? { ...row, allocated_amount: Number(event.target.value) }
                              : row,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setF({
                      ...f,
                      allocations: [...f.allocations, { job_order_id: "", allocated_amount: 0 }],
                    })
                  }
                >
                  <Plus className="mr-1 h-3 w-3" aria-hidden="true" />
                  Add Job Order
                </Button>
                <p className="text-xs text-muted-foreground">
                  Allocated: {peso(allocatedAmount)} · Still unallocated:{" "}
                  {peso(Math.max(0, amount - allocatedAmount))}
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        {step === 2 ? (
          <section className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Date *</Label>
                <Input
                  type="date"
                  max={today}
                  value={f.expense_date}
                  onChange={(event) => setF({ ...f, expense_date: event.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>What is this expense for? *</Label>
                <Select
                  value={f.disbursement_category}
                  onValueChange={(value) => {
                    const category = value as DisbursementCategory;
                    setF({
                      ...f,
                      disbursement_category: category,
                      disbursement_subcategory: "",
                      expense_type: category === "direct_materials" ? "materials" : f.expense_type,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISBURSEMENT_CATEGORIES.filter(
                      (category) => category.value !== "petty_cash",
                    ).map((category) => (
                      <SelectItem key={category.value} value={category.value}>
                        {category.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {f.disbursement_category === "other" ? (
                <div className="space-y-2">
                  <Label>Expense type</Label>
                  <Select
                    value={f.expense_type}
                    onValueChange={(value) =>
                      setF({
                        ...f,
                        expense_type: value as GeneralExpenseFormValues["expense_type"],
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="labor">Labor</SelectItem>
                      <SelectItem value="delivery">Transport / Delivery</SelectItem>
                      <SelectItem value="installation">Installation</SelectItem>
                      <SelectItem value="outsourcing">Outsourcing</SelectItem>
                      <SelectItem value="miscellaneous">Miscellaneous</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {hasUsefulSubcategories ? (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Subcategory</Label>
                  <Select
                    value={f.disbursement_subcategory || "none"}
                    onValueChange={(value) =>
                      setF({
                        ...f,
                        disbursement_subcategory:
                          value === "none" ? "" : (value as DisbursementSubcategory),
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {subcategories.map((category) => (
                        <SelectItem key={category.value} value={category.value}>
                          {category.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>{descriptionLabel}</Label>
              <Textarea
                rows={2}
                required
                value={f.description}
                onChange={(event) => setF({ ...f, description: event.target.value })}
                placeholder={descriptionPlaceholder}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  {isDelivery
                    ? "Delivery provider"
                    : isUtility
                      ? "Service provider"
                      : `Payee / Company${material ? " *" : ""}`}
                </Label>
                {isDelivery ? (
                  <>
                    <Select
                      value={deliveryProviderChoice}
                      onValueChange={(value) => {
                        setDeliveryProviderChoice(value);
                        setF({ ...f, supplier_name: value === "other" ? "" : value });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a delivery provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {DELIVERY_PROVIDERS.map((provider) => (
                          <SelectItem key={provider} value={provider}>
                            {provider}
                          </SelectItem>
                        ))}
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    {deliveryProviderChoice === "other" ? (
                      <Input
                        className="mt-2"
                        aria-label="Custom delivery provider"
                        value={f.supplier_name}
                        onChange={(event) => setF({ ...f, supplier_name: event.target.value })}
                        placeholder="Type the provider name"
                        required
                      />
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="relative">
                      <Input
                        value={f.supplier_name}
                        onClick={() => setSupplierOpen(true)}
                        onChange={(event) => {
                          const value = event.target.value;
                          const matchedSupplier = (suppliers.data ?? []).find(
                            (supplier) => supplier.name.trim().toLowerCase() === value.trim().toLowerCase(),
                          );
                          setSupplierSearch(value);
                          setF({
                            ...f,
                            supplier_id: matchedSupplier?.id ?? null,
                            supplier_name: value,
                            supplier_tin: matchedSupplier?.tin_number ?? "",
                            supplier_address: matchedSupplier?.address ?? "",
                            payment_terms: matchedSupplier?.payment_terms ?? "",
                          });
                        }}
                        placeholder={
                          isUtility ? "e.g. Meralco, Maynilad" : "Select or search supplier"
                        }
                        required={material}
                      />
                      {supplierOpen ? (
                        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-md border bg-background p-1 shadow-lg">
                          <Input
                            autoFocus
                            className="mb-1"
                            value={supplierSearch}
                            onChange={(event) => setSupplierSearch(event.target.value)}
                            placeholder="Search..."
                            aria-label="Search suppliers"
                          />
                          {(suppliers.data ?? [])
                            .filter((supplier) =>
                              supplier.name
                                .toLowerCase()
                                .includes(supplierSearch.trim().toLowerCase()),
                            )
                            .slice(0, 5)
                            .map((supplier) => (
                              <button
                                key={supplier.id}
                                type="button"
                                className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-muted"
                                onClick={() => {
                                  setF({
                                    ...f,
                                    supplier_id: supplier.id,
                                    supplier_name: supplier.name,
                                    supplier_tin: supplier.tin_number ?? "",
                                    supplier_address: supplier.address ?? "",
                                    payment_terms: supplier.payment_terms ?? "",
                                  });
                                  setSupplierSearch(supplier.name);
                                  setSupplierOpen(false);
                                }}
                              >
                                {supplier.name}
                              </button>
                            ))}
                          {(suppliers.data ?? []).filter((supplier) =>
                            supplier.name
                              .toLowerCase()
                              .includes(supplierSearch.trim().toLowerCase()),
                          ).length === 0 ? (
                            <p className="border-t px-2 py-2 text-center text-sm text-muted-foreground">
                              No matches
                            </p>
                          ) : null}
                          {supplierSearch.trim() &&
                          !(suppliers.data ?? []).some(
                            (supplier) =>
                              supplier.name.trim().toLowerCase() ===
                              supplierSearch.trim().toLowerCase(),
                          ) ? (
                            <button
                              type="button"
                              className="block w-full rounded border-t px-2 py-2 text-left text-sm font-medium hover:bg-muted"
                              onClick={() => {
                                setSupplierOpen(false);
                                void createSupplier();
                              }}
                            >
                              + New supplier
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
              {!material ? (
                <div className="space-y-2">
                  <Label>{taxMode === "add_vat" ? "Amount before VAT *" : "Amount *"}</Label>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={f.amount}
                    onChange={(event) => setF({ ...f, amount: event.target.value })}
                    required
                  />
                </div>
              ) : null}
            </div>
            {material ? (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Quantity *</Label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={f.quantity}
                      onChange={(event) => setF({ ...f, quantity: event.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Unit *</Label>
                    <Input list="expense-unit-options" value={f.unit_of_measure} onChange={(event) => setF({ ...f, unit_of_measure: event.target.value })} placeholder="Choose or type a unit" required />
                    <datalist id="expense-unit-options"><option value="pcs">Pieces</option><option value="sheets">Sheets</option><option value="box">Box</option><option value="kg">Kilograms</option><option value="liters">Liters</option></datalist>
                  </div>
                  <div className="space-y-2">
                    <Label>Unit cost *</Label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={f.unit_cost}
                      onChange={(event) => setF({ ...f, unit_cost: event.target.value })}
                      required
                    />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Computed amount:{" "}
                  <span className="font-medium text-foreground">{peso(amount)}</span>
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>TIN <span className="font-normal text-muted-foreground">(optional)</span></Label>
                    <Input
                      value={f.supplier_tin}
                      onChange={(event) => setF({ ...f, supplier_tin: event.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Address <span className="font-normal text-muted-foreground">(optional)</span></Label>
                    <Input
                      value={f.supplier_address}
                      onChange={(event) => setF({ ...f, supplier_address: event.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2"><Label>Payment terms</Label><Input value={f.payment_terms} onChange={(event) => setF({ ...f, payment_terms: event.target.value })} placeholder="Auto-filled from supplier" /><p className="text-xs text-muted-foreground">Optional. Update it here if this purchase uses different terms.</p></div>
              </>
            ) : null}
          </section>
        ) : null}

        {step === 3 ? (
          <section className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-4 text-sm">
              <p className="font-medium">Payment comes later</p>
              <p className="mt-1 text-muted-foreground">
                Save this purchase now. Finance records its check payment from the General Expenses
                row, which then appears in Check Disbursements.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Receipt or supporting document (optional)</Label>
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(event) =>
                  setF({ ...f, payment_proof_file: event.target.files?.[0] ?? null })
                }
              />
              <p className="text-xs text-muted-foreground">
                Attach a photo or PDF if it is available.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Tax treatment</Label>
                <Select
                  value={taxMode}
                  onValueChange={(value) => setTaxMode(value as typeof taxMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No tax</SelectItem>
                    <SelectItem value="vat_included">Total already includes 12% VAT</SelectItem>
                    <SelectItem value="add_vat">Add 12% VAT to subtotal</SelectItem>
                    <SelectItem value="custom">Enter another tax amount</SelectItem>
                  </SelectContent>
                </Select>
                {taxMode === "custom" ? (
                  <Input
                    className="mt-2"
                    aria-label="Custom tax amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={f.tax_amount}
                    onChange={(event) => setF({ ...f, tax_amount: event.target.value })}
                    placeholder="Tax amount"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {taxMode === "vat_included"
                      ? `Included tax: ${peso(taxAmount)} · Total stays ${peso(amount)}`
                      : taxMode === "add_vat"
                        ? `VAT to add: ${peso(taxAmount)} · Total becomes ${peso(amount)}`
                        : "No tax added."}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Due date</Label>
                <Input
                  type="date"
                  min={f.expense_date}
                  value={f.due_date}
                  onChange={(event) => setF({ ...f, due_date: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Voucher / Ref No.</Label>
                <Input
                  value={f.reference_no}
                  onChange={(event) => setF({ ...f, reference_no: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{isDelivery ? "Booking / Waybill No." : "DR / Invoice No."}</Label>
                <Input
                  value={f.supplier_document_no}
                  onChange={(event) => setF({ ...f, supplier_document_no: event.target.value })}
                  placeholder={isDelivery ? "Booking or tracking number" : undefined}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{isUtility ? "Billing period" : "Remarks"}</Label>
              <Textarea
                rows={3}
                value={f.remarks}
                onChange={(event) => setF({ ...f, remarks: event.target.value })}
                placeholder={isUtility ? "e.g. September 2026" : undefined}
              />
            </div>
          </section>
        ) : null}
      </div>
      <Dialog open={supplierModalOpen} onOpenChange={setSupplierModalOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>New supplier</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label>Supplier name *</Label><Input autoFocus value={newSupplier.name} onChange={(event) => setNewSupplier({ ...newSupplier, name: event.target.value })} /></div>
            <div className="space-y-2"><Label>TIN</Label><Input value={newSupplier.tin} onChange={(event) => setNewSupplier({ ...newSupplier, tin: event.target.value })} /></div>
            <div className="space-y-2"><Label>Email</Label><Input type="email" value={newSupplier.email} onChange={(event) => setNewSupplier({ ...newSupplier, email: event.target.value })} /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Address</Label><Input value={newSupplier.address} onChange={(event) => setNewSupplier({ ...newSupplier, address: event.target.value })} /></div>
            <div className="space-y-2"><Label>Contact person</Label><Input value={newSupplier.contact_person} onChange={(event) => setNewSupplier({ ...newSupplier, contact_person: event.target.value })} /></div>
            <div className="space-y-2"><Label>Contact number</Label><Input value={newSupplier.phone} onChange={(event) => setNewSupplier({ ...newSupplier, phone: event.target.value })} /></div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Payment terms</Label>
              <Select
                value={newSupplier.payment_terms && paymentTermPresets.includes(newSupplier.payment_terms) ? newSupplier.payment_terms : "custom"}
                onValueChange={(value) => setNewSupplier({
                  ...newSupplier,
                  payment_terms: value === "custom"
                    ? (paymentTermPresets.includes(newSupplier.payment_terms) ? "" : newSupplier.payment_terms)
                    : value,
                })}
              >
                <SelectTrigger><SelectValue placeholder="Choose payment terms" /></SelectTrigger>
                <SelectContent>
                  {paymentTermPresets.map((term) => <SelectItem key={term} value={term}>{term}</SelectItem>)}
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              {(!newSupplier.payment_terms || !paymentTermPresets.includes(newSupplier.payment_terms)) && (
                <Input value={newSupplier.payment_terms} onChange={(event) => setNewSupplier({ ...newSupplier, payment_terms: event.target.value })} placeholder="Type custom payment terms" />
              )}
              <p className="text-xs text-muted-foreground">Choose a common term or select Custom to enter your own.</p>
            </div>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setSupplierModalOpen(false)}>Cancel</Button><Button type="button" onClick={() => void saveNewSupplier()}>Save supplier</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <DialogFooter className="shrink-0 gap-2 border-t bg-background px-6 py-4 sm:gap-2 sm:px-8">
        {step > 1 ? (
          <Button type="button" variant="outline" onClick={() => setStep((step - 1) as 1 | 2)}>
            Back
          </Button>
        ) : onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {step === 1 ? <Button type="submit">Continue to expense details</Button> : null}
        {step === 2 ? (
          <Button type="button" onClick={continueFromDetails}>
            Continue to supporting details
          </Button>
        ) : null}
        {step === 3 ? (
          <Button type="submit" disabled={busy}>
            {busy ? "Saving..." : submitLabel}
          </Button>
        ) : null}
      </DialogFooter>
    </form>
  );
}

function ExpenseAllocationForm({
  expense,
  onSubmit,
  busy,
}: {
  expense: {
    id: string;
    amount: number;
    supplier_name: string | null;
    description: string;
    allocations?: Array<{ job_order_id: string; allocated_amount: number; job_order?: unknown }>;
  };
  onSubmit: (allocations: Array<{ job_order_id: string; allocated_amount: number }>) => void;
  busy?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [allocations, setAllocations] = useState(
    () =>
      expense.allocations?.map((allocation) => ({
        job_order_id: allocation.job_order_id,
        allocated_amount: Number(allocation.allocated_amount),
      })) ?? [],
  );
  const jobOrders = useQuery({
    queryKey: ["expense-allocation-job-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_orders")
        .select("id, job_number, project_name, customer:customers(customer_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const totalAllocated = allocations.reduce(
    (sum, allocation) => sum + Number(allocation.allocated_amount || 0),
    0,
  );
  const remaining = Math.max(0, Number(expense.amount) - totalAllocated);
  const searchTerms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matchingJobs = (jobOrders.data ?? []).filter((job) => {
    const haystack = [job.job_number, job.project_name, job.customer?.customer_name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchTerms.length === 0 || searchTerms.every((term) => haystack.includes(term));
  });

  const expenseText = [expense.description, expense.supplier_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const likelyJobs = (jobOrders.data ?? [])
    .flatMap((job) => {
      const matches = [
        { value: job.job_number, label: `Matches Job Order ${job.job_number}` },
        { value: job.project_name, label: `Matches project “${job.project_name}”` },
        {
          value: job.customer?.customer_name,
          label: `Matches client “${job.customer?.customer_name}”`,
        },
      ].find(({ value }) =>
        Boolean(
          value &&
          String(value).trim().length >= 3 &&
          expenseText.includes(String(value).toLowerCase()),
        ),
      );
      return matches ? [{ job, reason: matches.label }] : [];
    })
    .slice(0, 3);

  function addConfirmedJobOrder(job: { id: string }) {
    if (allocations.some((allocation) => allocation.job_order_id === job.id)) {
      return toast.error("That Job Order is already in the confirmed project use list");
    }
    setAllocations((current) => {
      const allocatedSoFar = current.reduce(
        (sum, allocation) => sum + Number(allocation.allocated_amount || 0),
        0,
      );
      const remainingAmount = Math.max(
        0,
        Math.round((Number(expense.amount) - allocatedSoFar) * 100) / 100,
      );
      return [...current, { job_order_id: job.id, allocated_amount: remainingAmount }];
    });
    setSearch("");
    setShowSearch(false);
  }

  function save() {
    if (totalAllocated - Number(expense.amount) > 0.009) {
      return toast.error("Confirmed allocation cannot exceed the original expense amount");
    }
    if (totalAllocated > 0 && Math.abs(totalAllocated - Number(expense.amount)) > 0.009) {
      return toast.error(
        `Allocation must equal ${peso(expense.amount)}. Current total: ${peso(totalAllocated)}.`,
      );
    }
    if (
      allocations.some(
        (allocation) => !allocation.job_order_id || Number(allocation.allocated_amount) <= 0,
      )
    ) {
      return toast.error("Choose a Job Order and enter its confirmed amount");
    }
    onSubmit(allocations);
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <div className="font-medium">{expense.supplier_name || "General expense"}</div>
        <div className="mt-1 text-muted-foreground">{expense.description}</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">Original expense</div>
            <div className="font-medium tabular-nums">{peso(expense.amount)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Confirmed to projects</div>
            <div className="font-medium tabular-nums">{peso(totalAllocated)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Still unallocated</div>
            <div className="font-medium tabular-nums">{peso(remaining)}</div>
          </div>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Confirm actual project use only.</p>
      <div className="space-y-2">
        <Label>Project use</Label>
        {allocations.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Arlechino company expense
          </div>
        ) : null}
        {allocations.length === 0 && likelyJobs.length ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Suggested projects</p>
            <div
              role="listbox"
              aria-label="Likely Job Orders"
              className="overflow-hidden rounded-md border"
            >
              {likelyJobs.map(({ job, reason }) => (
                <button
                  key={job.id}
                  type="button"
                  role="option"
                  className="block w-full border-b px-3 py-3 text-left text-sm last:border-b-0 hover:bg-muted"
                  onClick={() => addConfirmedJobOrder(job)}
                >
                  <span className="font-medium">
                    {job.job_number} · {job.project_name}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{reason}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {allocations.length === 0 && !likelyJobs.length ? (
          <p className="text-sm text-muted-foreground">No project suggested.</p>
        ) : null}
        {allocations.map((allocation, index) => (
          <div
            className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]"
            key={`${allocation.job_order_id}-${index}`}
          >
            <div className="flex min-h-9 items-center rounded-md border bg-muted/20 px-3 text-sm font-medium">
              {(() => {
                const job = (jobOrders.data ?? []).find(
                  (item) => item.id === allocation.job_order_id,
                );
                return job ? `${job.job_number} · ${job.project_name}` : "Selected Job Order";
              })()}
            </div>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={allocation.allocated_amount || ""}
              onChange={(event) =>
                setAllocations((current) =>
                  current.map((row, rowIndex) =>
                    rowIndex === index
                      ? { ...row, allocated_amount: Number(event.target.value) }
                      : row,
                  ),
                )
              }
              aria-label="Confirmed amount"
              placeholder="Amount"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setAllocations((current) => current.filter((_, rowIndex) => rowIndex !== index))
              }
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowSearch((visible) => !visible)}
        >
          {showSearch ? "Hide search" : "Choose another project"}
        </Button>
        {expense.allocations?.length ? (
          <Button type="button" variant="outline" onClick={() => setAllocations([])}>
            Mark as unallocated
          </Button>
        ) : null}
      </div>
      {showSearch ? (
        <div className="space-y-2 rounded-md border p-3">
          <Label>Find Job Order</Label>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search JO number, project, client, or brand"
          />
          <div
            role="listbox"
            aria-label="Matching Job Orders"
            className="max-h-48 overflow-y-auto rounded-md border bg-background p-1"
          >
            {matchingJobs.length ? (
              matchingJobs.map((job) => {
                const alreadyAdded = allocations.some(
                  (allocation) => allocation.job_order_id === job.id,
                );
                return (
                  <button
                    key={job.id}
                    type="button"
                    role="option"
                    disabled={alreadyAdded}
                    className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => addConfirmedJobOrder(job)}
                  >
                    <span className="font-medium">{job.job_number}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {job.project_name}
                      {job.customer?.customer_name ? ` · ${job.customer.customer_name}` : ""}
                      {alreadyAdded ? " · already added" : ""}
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                {search.trim()
                  ? `No Job Orders match “${search.trim()}”.`
                  : "No Job Orders available."}
              </p>
            )}
          </div>
        </div>
      ) : null}
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving..." : "Save allocation"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function CashSaleForm({
  onSubmit,
  busy,
}: {
  onSubmit: (values: CashSaleFormValues) => void;
  busy?: boolean;
}) {
  const today = dateInputValue(new Date());
  const [f, setF] = useState({
    or_number: "",
    collection_date: today,
    customer_name: "",
    invoice_reference: "",
    description: "",
    gross_amount: "",
    vat_amount: "",
  });

  function submit() {
    const grossAmount = Number(f.gross_amount);
    const vatAmount = Number(f.vat_amount || 0);
    if (!f.or_number.trim()) return toast.error("OR number is required");
    if (!f.collection_date) return toast.error("Collection date is required");
    if (!f.description.trim()) return toast.error("Description is required");
    if (grossAmount <= 0) return toast.error("Gross amount must be greater than zero");
    if (vatAmount < 0) return toast.error("VAT cannot be negative");
    onSubmit({
      ...f,
      gross_amount: grossAmount,
      vat_amount: vatAmount,
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
          <Label>Collection Date *</Label>
          <Input
            type="date"
            required
            max={today}
            value={f.collection_date}
            onChange={(e) => setF({ ...f, collection_date: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>OR Number *</Label>
          <Input
            required
            value={f.or_number}
            onChange={(e) => setF({ ...f, or_number: e.target.value })}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Customer</Label>
          <Input
            value={f.customer_name}
            onChange={(e) => setF({ ...f, customer_name: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Invoice Reference</Label>
          <Input
            value={f.invoice_reference}
            onChange={(e) => setF({ ...f, invoice_reference: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Description *</Label>
        <Textarea
          rows={2}
          required
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Gross Amount *</Label>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            required
            value={f.gross_amount}
            onChange={(e) => setF({ ...f, gross_amount: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>VAT</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={f.vat_amount}
            onChange={(e) => setF({ ...f, vat_amount: e.target.value })}
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving..." : "Add cash sale"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function reportError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unable to generate report.";
}

function inDateRange(date: string | null | undefined, from: string, to: string) {
  if (!date) return false;
  const value = date.slice(0, 10);
  return value >= from && value <= to;
}

function fallbackText(value: string | null | undefined) {
  return value?.trim() || "-";
}

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filename);
}

function downloadPettyCashBatchCsv(batch: any) {
  const rows = (batch.receipts ?? []).map((receipt: any) => [
    batch.petty_cash_number ?? "",
    batch.funding_date ?? "",
    batch.custodian_name ?? "",
    batch.funding_source ?? "",
    receipt.expense_date ?? "",
    receipt.supplier_name ?? "",
    receipt.description ?? "",
    receipt.supplier_document_no ?? "",
    receipt.amount ?? "",
  ]);
  const header = ["Petty cash no.", "Batch date", "Custodian", "Funding source", "Receipt date", "Supplier / payee", "Description", "Document", "Amount"];
  const csv = [header, ...rows].map((row) => row.map((value) => csvEscape(String(value))).join(",")).join("\n");
  downloadCsv(csv, `${batch.petty_cash_number || "petty-cash-batch"}-receipts.csv`);
}

function csvEscape(value: string) {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function voucherRevisionLines(previous: unknown, next: unknown) {
  if (!isRecord(previous) || !isRecord(next)) return [];
  return Object.keys(next).map((field) => ({
    field: voucherFieldLabel(field),
    previous: previous[field] == null ? "" : String(previous[field]),
    next: next[field] == null ? "" : String(next[field]),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function voucherFieldLabel(field: string) {
  const labels: Record<string, string> = {
    supplier_name: "Payee",
    amount: "Amount",
    description: "Details",
    check_date: "Check date",
    supplier_document_no: "Invoice / DR #",
    check_number: "Check #",
  };
  return labels[field] ?? field;
}

function clickableRowProps(label: string, open: () => void) {
  return {
    role: "link",
    tabIndex: 0,
    "aria-label": label,
    className:
      "group cursor-pointer outline-none transition-[background-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/35 active:bg-muted",
    onClick: open,
    onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    },
  };
}

function ReportHeading({ title }: { title: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-semibold">{title}</h2>
    </div>
  );
}

function agingBucket(dueDate: string | null | undefined) {
  if (!dueDate) return "current" as const;
  const days = Math.max(0, daysOutstanding(dueDate) ?? 0);
  if (days <= 30) return "days1to30" as const;
  if (days <= 60) return "days31to60" as const;
  if (days <= 90) return "days61to90" as const;
  return "over90" as const;
}

function agingBucketLabel(dueDate: string | null | undefined) {
  const bucket = agingBucket(dueDate);
  return bucket === "current"
    ? "Current"
    : bucket === "days1to30"
      ? "1-30 days"
      : bucket === "days31to60"
        ? "31-60 days"
        : bucket === "days61to90"
          ? "61-90 days"
          : "90+ days";
}

function DocumentLine({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="grid grid-cols-[3.5rem_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate" title={value ? String(value) : undefined}>
        {value || "-"}
      </span>
    </div>
  );
}

function CheckDisbursementCard({
  expense,
  tab,
  onEdit,
}: {
  expense: any;
  tab: ReportTab;
  onEdit?: () => void;
}) {
  const job = expense.job_order as { job_number: string; project_name: string } | null;
  const checkDate = expense.check_date ?? expense.paid_at ?? expense.expense_date;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">
            <ExpenseDescription expense={expense} />
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {expense.supplier_name || "No payee recorded"} ·{" "}
            {categoryLabel(expense.disbursement_category)}
          </div>
        </div>
        <div className="shrink-0 text-right font-medium tabular-nums">{peso(expense.amount)}</div>
      </div>
      <div className="mt-4 grid gap-3 border-y py-3 text-sm sm:grid-cols-2">
        <div>
          <div className="text-xs text-muted-foreground">Check details</div>
          <div className="mt-1 font-medium">Check #{expense.check_number || "Not recorded"}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {[expense.payment_source, fmtDate(checkDate)].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Project use</div>
          <div className="mt-1">
            {expense.job_order_id ? (
              <ReportLink to="/jobs/$id" params={{ id: expense.job_order_id }}>
                {job ? `${job.job_number} · ${job.project_name}` : "View Job Order"}
              </ReportLink>
            ) : (
              <span className="text-sm text-muted-foreground">Arlechino company expense</span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">Paid {fmtDate(checkDate)}</div>
        <PrintExpenseLinks id={expense.id} tab={tab} onEdit={onEdit} />
      </div>
    </Card>
  );
}

function AmountStack({
  primary,
  secondary,
  tone,
}: {
  primary: string;
  secondary?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className={tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : ""}>
      <div className="font-medium">{primary}</div>
      {secondary ? (
        <div className="text-xs font-normal text-muted-foreground">{secondary}</div>
      ) : null}
    </div>
  );
}

function ReportPrimaryAction({
  activeReport,
  canWrite,
  cashSaleOpen,
  setCashSaleOpen,
  expenseOpen,
  setExpenseOpen,
  addCashSale,
  addGeneralExpense,
}: {
  activeReport: ReportTab;
  canWrite: boolean;
  cashSaleOpen: boolean;
  setCashSaleOpen: (open: boolean) => void;
  expenseOpen: boolean;
  setExpenseOpen: (open: boolean) => void;
  addCashSale: { isPending: boolean; mutate: (values: CashSaleFormValues) => void };
  addGeneralExpense: { isPending: boolean; mutate: (values: GeneralExpenseFormValues) => void };
}) {
  if (!canWrite) return null;

  if (activeReport === "cash-sales") {
    return (
      <Dialog open={cashSaleOpen} onOpenChange={setCashSaleOpen}>
        <DialogTrigger asChild>
          <Button className="h-11 w-full whitespace-nowrap shadow-sm sm:w-auto">
            <Plus className="h-4 w-4" /> Add Cash Sale
          </Button>
        </DialogTrigger>
        <DialogContent className={EXPENSE_DIALOG_CLASS}>
          <DialogHeader>
            <DialogTitle>Add cash sale</DialogTitle>
          </DialogHeader>
          <CashSaleForm
            busy={addCashSale.isPending}
            onSubmit={(values) => addCashSale.mutate(values)}
          />
        </DialogContent>
      </Dialog>
    );
  }

  if (activeReport !== "payables") return null;

  return (
    <Dialog open={expenseOpen} onOpenChange={setExpenseOpen}>
      <DialogTrigger asChild>
        <Button className="h-11 w-full whitespace-nowrap shadow-sm sm:w-auto">
          <Plus className="h-4 w-4" /> Add General Expense
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-[940px]">
        <DialogHeader>
          <DialogTitle>Add General Expense</DialogTitle>
        </DialogHeader>
        <GeneralExpenseForm
          submitLabel="Add General Expense"
          busy={addGeneralExpense.isPending}
          onSubmit={(values) => addGeneralExpense.mutate(values)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ExpenseDescription({
  expense,
}: {
  expense: {
    description: string;
    expense_type: string;
    quantity: number | null;
    unit_of_measure: string | null;
    unit_cost: number | null;
  };
}) {
  const showBreakdown =
    expense.expense_type === "materials" && expense.quantity && expense.unit_cost;
  const typeLabel = expense.expense_type.replaceAll("_", " ");

  return (
    <div>
      <div>{expense.description}</div>
      <div className="text-xs capitalize text-muted-foreground">{typeLabel}</div>
      {showBreakdown ? (
        <div className="text-xs text-muted-foreground">
          {Number(expense.quantity)} {expense.unit_of_measure || "unit"} × {peso(expense.unit_cost)}
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "good" | "bad";
}) {
  return (
    <Card className="min-w-0 overflow-hidden p-4">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-1 min-w-0 break-all text-lg font-semibold leading-tight tracking-tight tabular-nums sm:text-xl ${
          tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : ""
        }`}
      >
        {value}
      </div>
    </Card>
  );
}

function OverviewMetric({
  label,
  count,
  amount,
  to,
  search,
}: {
  label: string;
  count: number;
  amount: number;
  to: string;
  search?: Record<string, string | undefined>;
}) {
  return (
    <Link
      to={to as never}
      search={search as never}
      className="group rounded-xl border bg-background p-4 shadow-sm transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${count} ${label}, ${peso(amount)}`}
    >
      <div className="text-3xl font-semibold tabular-nums tracking-tight group-hover:text-primary">
        {count}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
      <div className="mt-3 text-sm font-medium tabular-nums text-muted-foreground">
        {peso(amount)}
      </div>
    </Link>
  );
}

function PrintExpenseLinks({
  id,
  tab,
  onEdit,
}: {
  id: string;
  tab: ReportTab;
  onEdit?: () => void;
}) {
  return (
    <div className="flex justify-end gap-1.5">
      <Button
        asChild
        size="sm"
        variant="outline"
        className="h-8 whitespace-nowrap rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        title="Print check voucher"
      >
        <Link
          to="/expenses/$id/check-voucher/print"
          params={{ id }}
          search={{ from: "reports", jobId: undefined, tab }}
        >
          <Receipt className="h-3.5 w-3.5" />
          Print voucher
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="More check actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onEdit ? (
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit voucher details
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild>
            <Link
              to="/expenses/$id/check/print"
              params={{ id }}
              search={{ from: "reports", jobId: undefined, tab }}
            >
              <FileCheck2 className="mr-2 h-4 w-4" />
              Print check
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function isReportTab(tab: unknown): tab is ReportTab {
  return typeof tab === "string" && REPORT_TABS.includes(tab as ReportTab);
}

function ReportLink({
  children,
  to,
  params,
}: {
  children: ReactNode;
  to: string;
  params?: Record<string, string>;
}) {
  return (
    <Link
      to={to as never}
      params={params as never}
      onClick={(event) => event.stopPropagation()}
      className="inline-block max-w-full rounded-sm text-primary underline-offset-4 break-words hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </Link>
  );
}

function CustomerLink({ customer }: { customer: { id: string; customer_name: string } | null }) {
  return customer ? (
    <ReportLink to="/customers/$id" params={{ id: customer.id }}>
      {customer.customer_name}
    </ReportLink>
  ) : (
    "—"
  );
}

function JobLink({ job }: { job: { id: string; project_name: string } | null }) {
  return job ? (
    <ReportLink to="/jobs/$id" params={{ id: job.id }}>
      {job.project_name}
    </ReportLink>
  ) : (
    "—"
  );
}

function TaxPill({ taxType }: { taxType?: string | null }) {
  return (
    <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {taxType === "vatable" ? "VAT" : "Non-VAT"}
    </span>
  );
}
