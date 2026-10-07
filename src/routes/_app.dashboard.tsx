import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { KeyboardEvent } from "react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  AccessDenied,
  EmptyState,
  LoadingRow,
  StatusPill as StatusBadge,
} from "@/components/system";
import { computeQuoteDisplayTotal, daysOutstanding, receivableStatus } from "@/lib/calc";
import { fmtDate, peso } from "@/lib/format";
import { AlertCircle, ClipboardList, FileText, Plus, Receipt } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { canSalesWork, canViewFullReports, canViewMoneyWork, canViewStatusOnly } from "@/lib/roles";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — AutoMate PH" }] }),
  component: Dashboard,
});

const DASHBOARD_VERSION = "v2";
type AttentionFilter = "All" | "Quote" | "Job" | "Invoice" | "Expense";

const JOB_STATUS_CARDS = [
  {
    status: "pending",
    label: "Pending",
    description: "Waiting to be started.",
    accent: "border-amber-200 bg-amber-50 text-amber-950",
  },
  {
    status: "in_production",
    label: "In Production",
    description: "Currently being worked on.",
    accent: "border-blue-200 bg-blue-50 text-blue-950",
  },
  {
    status: "ready",
    label: "Ready for Delivery",
    description: "Ready for release.",
    accent: "border-emerald-200 bg-emerald-50 text-emerald-950",
  },
  {
    status: "delivered",
    label: "Delivered",
    description: "Already delivered.",
    accent: "border-violet-200 bg-violet-50 text-violet-950",
  },
  {
    status: "completed",
    label: "Completed",
    description: "Closed by the owner.",
    accent: "border-slate-200 bg-slate-50 text-slate-950",
  },
] as const;

function Dashboard() {
  const navigate = useNavigate();
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>("All");
  const { role } = useAuth();
  const canViewDashboard = canViewFullReports(role) || canViewMoneyWork(role);
  const canCreateQuote = canSalesWork(role);
  const canViewStatus = canViewStatusOnly(role);
  const viewerStatusCounts = useQuery({
    queryKey: ["viewer-job-status-summary", DASHBOARD_VERSION],
    retry: false,
    enabled: canViewStatus,
    queryFn: async () => {
      const { data, error } = await supabase.from("job_orders").select("status");
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        const status = row.status ?? "unknown";
        counts.set(status, (counts.get(status) ?? 0) + 1);
      }
      return Array.from(counts, ([status, job_count]) => ({ status, job_count }));
    },
  });
  const quotes = useQuery({
    queryKey: ["dashboard-quotes", DASHBOARD_VERSION],
    retry: false,
    enabled: canViewDashboard,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotations")
        .select(
          "id, quote_number, project_name, subtotal, adjustment_amount, total_amount, tax_type, status, customer:customers(customer_name)",
        )
        .in("status", ["draft", "pending_manager_approval", "sent"])
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const jobs = useQuery({
    queryKey: ["dashboard-jobs", DASHBOARD_VERSION],
    retry: false,
    enabled: canViewDashboard,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_orders")
        .select(
          "id, job_number, project_name, tax_type, target_completion_date, status, customer:customers(customer_name)",
        )
        .neq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const invoices = useQuery({
    queryKey: ["dashboard-receivables", DASHBOARD_VERSION],
    retry: false,
    enabled: canViewDashboard,
    queryFn: async () => {
      const { data: invoices, error } = await supabase
        .from("invoices")
        .select(
          "id, invoice_number, invoice_date, due_date, invoice_amount, amount_due_snapshot, tax_type, customer:customers(customer_name)",
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
    queryKey: ["dashboard-payables", DASHBOARD_VERSION],
    retry: false,
    enabled: canViewDashboard,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_expenses")
        .select("id, supplier_name, description, due_date, amount, reference_no")
        .eq("payment_status", "pending")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const receivables = (invoices.data ?? [])
    .map((invoice) => {
      const amountPaid = invoice.amountPaid;
      const amountDue = Number(invoice.amount_due_snapshot ?? invoice.invoice_amount);
      const balance = Math.max(amountDue - amountPaid, 0);
      return {
        ...invoice,
        balance,
        derivedStatus: receivableStatus(amountDue, amountPaid, invoice.due_date),
        daysOutstanding: balance > 0 ? daysOutstanding(invoice.due_date) : null,
      };
    })
    .filter((invoice) => invoice.balance > 0)
    .slice(0, 5);

  const attentionItems = [
    ...(quotes.data ?? []).map((quote) => ({
      id: `quote-${quote.id}`,
      type: "Quote",
      title: quote.project_name,
      detail: quote.quote_number,
      status: quote.status,
      priority: 3,
      amount: peso(computeQuoteDisplayTotal(quote)),
      action: quote.status === "pending_manager_approval" ? "Approve quote" : "Review quote",
      open: () => navigate({ to: "/quotes/$id", params: { id: quote.id } }),
    })),
    ...(jobs.data ?? []).map((job) => ({
      id: `job-${job.id}`,
      type: "Job",
      title: job.project_name,
      detail: job.job_number,
      status: job.status,
      priority: 2,
      amount: fmtDate(job.target_completion_date),
      action: job.status === "in_production" ? "Open production" : job.status === "ready_for_delivery" ? "Arrange delivery" : "Open job",
      open: () => navigate({ to: "/jobs/$id", params: { id: job.id } }),
    })),
    ...receivables.map((invoice) => ({
      id: `invoice-${invoice.id}`,
      type: "Invoice",
      title: (invoice.customer as { customer_name: string } | null)?.customer_name ?? "Invoice",
      detail: invoice.invoice_number,
      status: invoice.derivedStatus,
      priority: invoice.derivedStatus === "overdue" ? 1 : 4,
      amount: peso(invoice.balance),
      action: "Record payment",
      open: () => navigate({ to: "/invoices/$id", params: { id: invoice.id } }),
    })),
    ...(payables.data ?? []).map((payable) => ({
      id: `expense-${payable.id}`,
      type: "Expense",
      title: payable.description,
      detail: payable.supplier_name || "Pending supplier",
      status: "Pending payment",
      priority: 5,
      amount: peso(payable.amount),
      action: "Review expense",
      open: () =>
        navigate({ to: "/reports", search: { tab: "payables", focus: "pending-expenses" } }),
    })),
  ]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 20);
  const visibleAttentionItems =
    attentionFilter === "All"
      ? attentionItems
      : attentionItems.filter((item) => item.type === attentionFilter);
  const attentionFilters: Array<{ label: AttentionFilter; count: number }> = [
    { label: "All", count: attentionItems.length },
    ...(["Quote", "Job", "Invoice", "Expense"] as const).map((label) => ({
      label,
      count: attentionItems.filter((item) => item.type === label).length,
    })),
  ];
  const summaryItems = [
    { label: "Quotes needing action", value: quotes.data?.length ?? 0 },
    {
      label: "Jobs in progress",
      value: (jobs.data ?? []).filter((job) => job.status === "in_production").length,
    },
    { label: "Outstanding receivables", value: receivables.length },
    { label: "Pending expenses", value: payables.data?.length ?? 0 },
  ];
  const legacyRecentWorkEnabled = false;

  if (canViewStatus) {
    return <ViewerStatusBoard counts={viewerStatusCounts.data ?? []} />;
  }

  if (!canViewDashboard) {
    return (
      <AccessDenied
        title="Limited read-only access"
        description="Dashboard financial queues are available to accounting, owner, and admin staff users."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-muted-foreground">
            Open the first item that needs action, or start a new quotation.
          </p>
        </div>
        {canCreateQuote ? (
          <Button asChild className="w-full sm:w-auto">
            <Link to="/quotes/new" search={{ customerId: undefined }}>
              <Plus className="h-4 w-4" /> New Quote
            </Link>
          </Button>
        ) : null}
      </div>

      <section aria-labelledby="status-summary-title" className="space-y-3">
        <div>
          <h2 id="status-summary-title" className="text-xl font-semibold">
            At a glance
          </h2>
          <p className="text-sm text-muted-foreground">A quick read of the work currently open.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {summaryItems.map((item) => (
            <Card key={item.label} className="p-4">
              <div className="text-2xl font-semibold tabular-nums">{item.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{item.label}</div>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="needs-attention-title" className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 id="needs-attention-title" className="text-xl font-semibold">
              Needs attention
            </h2>
            <p className="text-sm text-muted-foreground">
              Start with the queue that needs a decision today.
            </p>
          </div>
        </div>
        <Card className="overflow-hidden">
          <div
            className="flex flex-wrap gap-2 border-b p-3"
            role="group"
            aria-label="Filter attention items"
          >
            {attentionFilters.map((filter) => (
              <Button
                key={filter.label}
                type="button"
                size="sm"
                variant={attentionFilter === filter.label ? "secondary" : "ghost"}
                aria-pressed={attentionFilter === filter.label}
                onClick={() => setAttentionFilter(filter.label)}
              >
                {filter.label === "All" ? "All" : `${filter.label}s`} {filter.count}
              </Button>
            ))}
          </div>
          <div className="max-h-[28rem] overscroll-contain overflow-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount / date</TableHead>
                  <TableHead className="text-right">Next action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.isLoading || jobs.isLoading || invoices.isLoading || payables.isLoading ? (
                  <LoadingRow colSpan={5} />
                ) : visibleAttentionItems.length === 0 ? (
                  <EmptyState colSpan={5} icon={FileText}>
                    No{" "}
                    {attentionFilter === "All" ? "items" : `${attentionFilter.toLowerCase()} items`}{" "}
                    need attention right now.
                  </EmptyState>
                ) : (
                  visibleAttentionItems.map((item) => (
                    <TableRow
                      key={item.id}
                      role="link"
                      tabIndex={0}
                      className="cursor-pointer outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/35"
                      onClick={item.open}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        item.open();
                      }}
                    >
                      <TableCell className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {item.type}
                      </TableCell>
                      <TableCell className="max-w-[26rem]">
                        <div className="truncate font-medium" title={item.title}>
                          {item.title}
                        </div>
                        <div className="truncate text-xs text-muted-foreground" title={item.detail}>
                          {item.detail}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <StatusBadge status={item.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {item.amount}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(event) => {
                            event.stopPropagation();
                            item.open();
                          }}
                        >
                          {item.action}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </section>

      {legacyRecentWorkEnabled ? (
        <section aria-labelledby="recent-work-title" className="space-y-3">
          <div>
            <h2 id="recent-work-title" className="text-xl font-semibold">
              Recent work
            </h2>
            <p className="text-sm text-muted-foreground">
              Open the latest quotes and jobs when you need more context.
            </p>
          </div>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <QueueCard title="Quotes Requiring Action" actionTo="/quotes">
              <Table className="min-w-[620px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[7.25rem]">Quote #</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead className="w-[14rem]">Status</TableHead>
                    <TableHead className="w-[7rem] text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotes.isLoading ? (
                    <LoadingRow colSpan={4} />
                  ) : quotes.isError ? (
                    <EmptyState colSpan={4} icon={AlertCircle}>
                      Unable to load quotes.
                    </EmptyState>
                  ) : quotes.data?.length === 0 ? (
                    <EmptyState colSpan={4} icon={FileText}>
                      No quotes need action.
                    </EmptyState>
                  ) : (
                    quotes.data!.map((quote) => (
                      <TableRow
                        key={quote.id}
                        {...clickableRowProps(`Open quote ${quote.quote_number}`, () =>
                          navigate({ to: "/quotes/$id", params: { id: quote.id } }),
                        )}
                      >
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          <Link
                            to="/quotes/$id"
                            params={{ id: quote.id }}
                            className="text-primary underline-offset-4 hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {quote.quote_number}
                          </Link>
                        </TableCell>
                        <TableCell className="min-w-0">
                          <div className="truncate" title={quote.project_name}>
                            {quote.project_name}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <StatusBadge status={quote.status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {peso(computeQuoteDisplayTotal(quote))}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </QueueCard>

            <QueueCard title="Jobs in Progress" actionTo="/jobs">
              <Table className="min-w-[560px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[7.25rem]">Job #</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead className="w-[8.75rem]">Status</TableHead>
                    <TableHead className="w-[5.5rem]">Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.isLoading ? (
                    <LoadingRow colSpan={4} />
                  ) : jobs.isError ? (
                    <EmptyState colSpan={4} icon={AlertCircle}>
                      Unable to load jobs.
                    </EmptyState>
                  ) : jobs.data?.length === 0 ? (
                    <EmptyState colSpan={4} icon={ClipboardList}>
                      No active jobs.
                    </EmptyState>
                  ) : (
                    jobs.data!.map((job) => (
                      <TableRow
                        key={job.id}
                        {...clickableRowProps(`Open job order ${job.job_number}`, () =>
                          navigate({ to: "/jobs/$id", params: { id: job.id } }),
                        )}
                      >
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          <Link
                            to="/jobs/$id"
                            params={{ id: job.id }}
                            className="text-primary underline-offset-4 hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {job.job_number}
                          </Link>
                        </TableCell>
                        <TableCell className="min-w-0 whitespace-normal">
                          <div className="break-words leading-snug" title={job.project_name}>
                            {job.project_name}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={job.status} />
                            <TaxPill taxType={job.tax_type} />
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {fmtDate(job.target_completion_date)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </QueueCard>

            <QueueCard
              title="Outstanding Receivables"
              actionTo="/reports"
              actionSearch={{ tab: "receivables" }}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.isLoading ? (
                    <LoadingRow colSpan={4} />
                  ) : invoices.isError ? (
                    <EmptyState colSpan={4} icon={AlertCircle}>
                      Unable to load receivables.
                    </EmptyState>
                  ) : receivables.length === 0 ? (
                    <EmptyState colSpan={4} icon={Receipt}>
                      No outstanding receivables.
                    </EmptyState>
                  ) : (
                    receivables.map((invoice) => (
                      <TableRow
                        key={invoice.id}
                        {...clickableRowProps(`Open invoice ${invoice.invoice_number}`, () =>
                          navigate({ to: "/invoices/$id", params: { id: invoice.id } }),
                        )}
                      >
                        <TableCell className="font-mono text-xs">
                          <Link
                            to="/invoices/$id"
                            params={{ id: invoice.id }}
                            className="text-primary underline-offset-4 hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {invoice.invoice_number}
                          </Link>
                        </TableCell>
                        <TableCell className="min-w-[12rem] whitespace-normal">
                          <div className="break-words leading-snug">
                            {(invoice.customer as { customer_name: string } | null)?.customer_name}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={invoice.derivedStatus} />
                            <TaxPill taxType={invoice.tax_type} />
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {peso(invoice.balance)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </QueueCard>

            <QueueCard
              title="Pending Expenses"
              actionTo="/reports"
              actionSearch={{ tab: "payables", focus: "pending-expenses" }}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payables.isLoading ? (
                    <LoadingRow colSpan={4} />
                  ) : payables.isError ? (
                    <EmptyState colSpan={4} icon={AlertCircle}>
                      Unable to load pending expenses.
                    </EmptyState>
                  ) : payables.data?.length === 0 ? (
                    <EmptyState colSpan={4} icon={Receipt}>
                      No pending expenses.
                    </EmptyState>
                  ) : (
                    payables.data!.map((payable) => (
                      <TableRow
                        key={payable.id}
                        {...clickableRowProps("Open pending expenses report", () =>
                          navigate({
                            to: "/reports",
                            search: { tab: "payables", focus: "pending-expenses" },
                          }),
                        )}
                      >
                        <TableCell>{payable.supplier_name || "—"}</TableCell>
                        <TableCell>{payable.description}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {fmtDate(payable.due_date)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {peso(payable.amount)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </QueueCard>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ViewerStatusBoard({ counts }: { counts: Array<{ status: string; job_count: number }> }) {
  const countMap = new Map(counts.map((row) => [row.status, Number(row.job_count)]));

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Production Status</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          A high-level production board. Detailed records stay protected.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {JOB_STATUS_CARDS.map((card) => (
          <Card key={card.status} className={`p-4 sm:p-5 ${card.accent}`}>
            <div className="text-3xl font-semibold tabular-nums sm:text-4xl">
              {countMap.get(card.status) ?? 0}
            </div>
            <div className="mt-3 text-base font-semibold">{card.label}</div>
            <p className="mt-1 text-sm opacity-75">{card.description}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <p className="text-sm text-muted-foreground">
          Customer names, project names, job numbers, quotes, invoices, pricing, expenses, and admin
          history are protected. Ask the owner or admin staff for operational details.
        </p>
      </Card>
    </div>
  );
}

function TaxPill({ taxType }: { taxType?: string | null }) {
  return (
    <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {taxType === "vatable" ? "VAT" : "Non-VAT"}
    </span>
  );
}

function QueueCard({
  title,
  actionTo,
  actionSearch,
  children,
}: {
  title: string;
  actionTo: string;
  actionSearch?: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex items-center justify-between border-b p-3">
        <h3 className="font-semibold">{title}</h3>
        <Button asChild size="sm" variant="outline">
          <Link to={actionTo} search={actionSearch}>
            View all
          </Link>
        </Button>
      </div>
      <div className="overflow-auto">{children}</div>
    </Card>
  );
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
