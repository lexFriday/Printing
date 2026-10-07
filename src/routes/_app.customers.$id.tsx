import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ComponentType, ReactNode } from "react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
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
  AlertCircle,
  BriefcaseBusiness,
  FileText,
  Pencil,
  Plus,
  Receipt,
  Wallet,
} from "lucide-react";
import { CustomerForm } from "./_app.customers";
import { CustomerContactPicker } from "@/components/CustomerContactPicker";
import { EmptyState, LoadingRow, StatusPill as StatusBadge } from "@/components/system";
import {
  assertCustomerTinAvailable,
  cleanCustomer,
  customerErrorMessage,
  formatTin,
} from "@/lib/customers";
import { logAudit } from "@/lib/audit";
import { fmtDate, peso } from "@/lib/format";
import { receivableStatus } from "@/lib/calc";
import { useAuth } from "@/hooks/useAuth";
import { canSalesWork } from "@/lib/roles";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/customers/$id")({
  head: () => ({ meta: [{ title: "Customer — AutoMate PH" }] }),
  component: CustomerDetail,
});

function CustomerDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { role } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const canWrite = canSalesWork(role);

  const contacts = useQuery({
    queryKey: ["customer-contacts", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_contacts")
        .select("id, contact_name, department, phone, email, is_active")
        .eq("customer_id", id)
        .order("is_active", { ascending: false })
        .order("contact_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const deactivateContact = useMutation({
    mutationFn: async (contactId: string) => {
      if (!canWrite) throw new Error("You do not have permission to update contacts.");
      const { error } = await supabase
        .from("customer_contacts")
        .update({ is_active: false })
        .eq("id", contactId);
      if (error) throw error;
      await logAudit("customer_contact.deactivated", "customer_contact", contactId, {
        customer_id: id,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer-contacts", id] });
      toast.success("Contact deactivated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const customer = useQuery({
    queryKey: ["customer", id],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const summary = useQuery({
    queryKey: ["customer-summary", id],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_operational_summaries")
        .select("*")
        .eq("customer_id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const quotations = useQuery({
    queryKey: ["customer-quotations", id],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotations")
        .select("id, quote_number, project_name, quote_date, status, total_amount")
        .eq("customer_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const activeJobs = useQuery({
    queryKey: ["customer-active-jobs", id],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_active_job_summaries")
        .select("id, job_number, project_name, quoted_amount, expenses, profit, status")
        .eq("customer_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const invoices = useQuery({
    queryKey: ["customer-invoices", id],
    retry: false,
    queryFn: async () => {
      const { data: invoices, error } = await supabase
        .from("invoices")
        .select(
          "id, invoice_number, invoice_date, due_date, invoice_amount, amount_due_snapshot, status",
        )
        .eq("customer_id", id)
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

  const invoiceRows = (invoices.data ?? []).map((invoice) => {
    const amountPaid = invoice.amountPaid;
    const amountDue = Number(invoice.amount_due_snapshot ?? invoice.invoice_amount);
    return {
      ...invoice,
      amountPaid,
      balance: Math.max(amountDue - amountPaid, 0),
      derivedStatus: receivableStatus(amountDue, amountPaid, invoice.due_date),
    };
  });
  const unpaidInvoices = invoiceRows.filter((invoice) => invoice.balance > 0);
  const updateCustomer = useMutation({
    mutationFn: async (f: {
      customer_name: string;
      contact_person: string;
      contact_number: string;
      email?: string;
      tin_number?: string;
      address?: string;
      notes?: string;
    }) => {
      if (!canWrite) throw new Error("You do not have permission to perform this action.");
      await assertCustomerTinAvailable(f.tin_number, id);
      const payload = cleanCustomer(f);
      const { data, error } = await supabase
        .from("customers")
        .update(payload)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      await logAudit("customer.updated", "customer", id, {
        customer_code: data.customer_code,
        customer_name: data.customer_name,
      });
      return data;
    },
    onSuccess: () => {
      toast.success("Customer updated");
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ["customer", id] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e: Error) => toast.error(customerErrorMessage(e)),
  });

  if (customer.isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;

  if (customer.isError || !customer.data) {
    return (
      <Card className="p-8">
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-2xl font-semibold">Customer not found.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The customer may have been deleted or is unavailable to your account.
          </p>
          <Button asChild className="mt-5">
            <Link to="/customers">Back to Customers</Link>
          </Button>
        </div>
      </Card>
    );
  }

  const c = customer.data;
  const s = summary.data;

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Button variant="ghost" className="-ml-3 mb-2" onClick={() => nav({ to: "/customers" })}>
            <ArrowLeft className="h-4 w-4" /> Customers
          </Button>
          <h1 className="break-words text-3xl font-semibold tracking-tight">{c.customer_name}</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{c.customer_code}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite ? (
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Pencil className="h-4 w-4" /> Edit Customer
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit customer</DialogTitle>
                </DialogHeader>
                <CustomerForm
                  initialValues={{
                    ...c,
                    contact_person: c.contact_person ?? "",
                    contact_number: c.contact_number ?? "",
                  }}
                  submitLabel="Save changes"
                  busy={updateCustomer.isPending}
                  onSubmit={(values) => updateCustomer.mutate(values)}
                />
              </DialogContent>
            </Dialog>
          ) : null}
          {canWrite ? (
            <Button asChild>
              <Link to="/quotes/new" search={{ customerId: id }}>
                <Plus className="h-4 w-4" /> Create Quote
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {!canWrite ? (
        <Alert>
          <AlertTitle>Customer context is read-only for your role.</AlertTitle>
          <AlertDescription>
            Viewer access can review customer work history but cannot edit customers or create
            quotations.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="p-5">
        <div className="grid min-w-0 gap-5 md:grid-cols-2 xl:grid-cols-4">
          <InfoItem label="Contact person" value={c.contact_person} />
          <InfoItem label="Phone number" value={c.contact_number ?? "—"} />
          <InfoItem label="Email" value={c.email ?? "—"} />
          <InfoItem label="TIN number" value={formatTin(c.tin_number) || "—"} />
          <div className="min-w-0 xl:col-span-4">
            <InfoItem label="Address" value={c.address ?? "—"} />
          </div>
        </div>
      </Card>

      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={FileText}
          label="Total Quotes"
          value={summary.isLoading ? "..." : `${s?.total_quotes ?? 0}`}
        />
        <SummaryCard
          icon={BriefcaseBusiness}
          label="Active Jobs"
          value={summary.isLoading ? "..." : `${s?.active_jobs ?? 0}`}
        />
        <SummaryCard
          icon={Wallet}
          label="Outstanding Balance"
          value={summary.isLoading ? "..." : peso(s?.outstanding_balance ?? 0)}
        />
        <SummaryCard
          icon={Receipt}
          label="Lifetime Revenue"
          value={summary.isLoading ? "..." : peso(s?.lifetime_revenue ?? 0)}
        />
      </div>

      {summary.isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Financial summary is unavailable.</AlertTitle>
          <AlertDescription>
            Apply the customer summary database migration before relying on these totals.
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="overview" className="min-w-0">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="quotes">Quotes</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="contacts" className="min-w-0">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">Company contacts</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose the right contact per quotation without changing the company record.
                </p>
              </div>
              {canWrite ? (
                <CustomerContactPicker
                  customerId={id}
                  value={null}
                  onChange={() => qc.invalidateQueries({ queryKey: ["customer-contacts", id] })}
                />
              ) : null}
            </div>
            <div className="mt-4 divide-y rounded-md border">
              {(contacts.data ?? []).map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center justify-between gap-3 p-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium" title={contact.contact_name}>
                      {contact.contact_name}
                      {!contact.is_active ? " (inactive)" : ""}
                    </div>
                    <div className="truncate text-muted-foreground">
                      {[contact.department, contact.phone, contact.email]
                        .filter(Boolean)
                        .join(" · ") || "No extra details"}
                    </div>
                  </div>
                  {canWrite && contact.is_active ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deactivateContact.mutate(contact.id)}
                    >
                      Deactivate
                    </Button>
                  ) : null}
                </div>
              ))}
              {!contacts.isLoading && !contacts.data?.length ? (
                <div className="p-4 text-sm text-muted-foreground">No additional contacts yet.</div>
              ) : null}
            </div>
          </Card>
        </TabsContent>
        <TabsContent value="overview" className="min-w-0">
          <SectionCard
            title="Unpaid Invoices"
            description="Issued invoices that still need collection."
          >
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Invoice Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.isLoading ? (
                  <LoadingRow colSpan={5} />
                ) : unpaidInvoices.length === 0 ? (
                  <EmptyState colSpan={5} icon={Receipt}>
                    No unpaid invoices found.
                  </EmptyState>
                ) : (
                  unpaidInvoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-mono text-xs">{invoice.invoice_number}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtDate(invoice.invoice_date)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {peso(invoice.balance)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={invoice.derivedStatus} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link to="/invoices/$id" params={{ id: invoice.id }}>
                            View Invoice
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </SectionCard>
        </TabsContent>
        <TabsContent value="quotes" className="min-w-0">
          <SectionCard
            title="Recent Quotations"
            description="Quotation history for this customer."
            action={
              canWrite ? (
                <Button asChild size="sm" variant="outline">
                  <Link to="/quotes/new" search={{ customerId: id }}>
                    <Plus className="h-4 w-4" /> Create Quote
                  </Link>
                </Button>
              ) : null
            }
          >
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Quote Number</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotations.isLoading ? (
                  <LoadingRow colSpan={6} />
                ) : quotations.data?.length === 0 ? (
                  <EmptyState colSpan={6} icon={FileText}>
                    {canWrite
                      ? "No quotations found. Create the first quotation for this customer."
                      : "No quotations found."}
                  </EmptyState>
                ) : (
                  quotations.data!.map((quote) => (
                    <TableRow key={quote.id}>
                      <TableCell className="font-mono text-xs">{quote.quote_number}</TableCell>
                      <TableCell className="min-w-[12rem] whitespace-normal font-medium">
                        <div className="break-words leading-snug">{quote.project_name}</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtDate(quote.quote_date)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={quote.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {peso(quote.total_amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link to="/quotes/$id" params={{ id: quote.id }}>
                            View Quote
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </SectionCard>
        </TabsContent>
        <TabsContent value="jobs" className="min-w-0">
          <SectionCard title="Active Jobs" description="Job orders currently in production.">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Job Number</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Expenses</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeJobs.isLoading ? (
                  <LoadingRow colSpan={7} />
                ) : activeJobs.data?.length === 0 ? (
                  <EmptyState colSpan={7} icon={BriefcaseBusiness}>
                    No active jobs found.
                  </EmptyState>
                ) : (
                  activeJobs.data!.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-mono text-xs">{job.job_number}</TableCell>
                      <TableCell className="min-w-[12rem] whitespace-normal font-medium">
                        <div className="break-words leading-snug">{job.project_name}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {peso(job.quoted_amount ?? 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {peso(job.expenses ?? 0)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium tabular-nums ${(job.profit ?? 0) >= 0 ? "text-success" : "text-destructive"}`}
                      >
                        {peso(job.profit ?? 0)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={job.status ?? "pending"} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link to="/jobs/$id" params={{ id: job.id ?? "" }}>
                            View Job Order
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </SectionCard>
        </TabsContent>
        <TabsContent value="invoices" className="min-w-0">
          <SectionCard
            title="Invoice History"
            description="Issued and paid invoices for this customer."
          >
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Invoice Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.isLoading ? (
                  <LoadingRow colSpan={5} />
                ) : invoices.data?.length === 0 ? (
                  <EmptyState colSpan={5} icon={Receipt}>
                    No invoices found.
                  </EmptyState>
                ) : (
                  invoiceRows.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-mono text-xs">{invoice.invoice_number}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtDate(invoice.invoice_date)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {peso(invoice.invoice_amount)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={invoice.derivedStatus} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link to="/invoices/$id" params={{ id: invoice.id }}>
                            View Invoice
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-medium">{value}</div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </Card>
  );
}

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      <div className="max-h-[32rem] overflow-auto">{children}</div>
    </Card>
  );
}
