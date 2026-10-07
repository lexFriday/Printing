import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Plus, Search, FileText } from "lucide-react";
import { peso, fmtDate } from "@/lib/format";
import { StatusPill as StatusBadge } from "@/components/system";
import { LoadingRow, EmptyState } from "@/components/system";
import { useAuth } from "@/hooks/useAuth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { canSalesWork } from "@/lib/roles";
import { computeQuoteDisplayTotal } from "@/lib/calc";

export const Route = createFileRoute("/_app/quotes/")({
  head: () => ({ meta: [{ title: "Quotes — AutoMate PH" }] }),
  component: QuotesList,
});

function QuotesList() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const canWrite = canSalesWork(role);
  const normalizedSearch = debouncedSearch.trim().replace(/[,%]/g, " ").replace(/\s+/g, " ");

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const list = useQuery({
    queryKey: ["quotes", normalizedSearch, status],
    queryFn: async () => {
      let q = supabase
        .from("quotations")
        .select(
          "id, quote_number, project_name, subtotal, adjustment_amount, total_amount, tax_type, status, quote_date, customer:customers(customer_name)",
        )
        .order("created_at", { ascending: false });
      if (status !== "all")
        q = q.eq(
          "status",
          status as
            | "draft"
            | "pending_manager_approval"
            | "pending_customer_approval"
            | "sent"
            | "approved"
            | "rejected",
        );
      if (normalizedSearch)
        q = q.or(
          `project_name.ilike.%${normalizedSearch}%,quote_number.ilike.%${normalizedSearch}%`,
        );
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-4 border-b pb-5">
        <div>
          <h1 className="text-3xl font-semibold">Quotes</h1>
          <p className="text-muted-foreground mt-1">
            The center of the system. Create, approve, and convert.
          </p>
        </div>
        {canWrite ? (
          <Button asChild>
            <Link to="/quotes/new" search={{ customerId: undefined }}>
              <Plus className="h-4 w-4" /> New quote
            </Link>
          </Button>
        ) : null}
      </div>

      {!canWrite ? (
        <Alert>
          <AlertTitle>Quotation records are read-only for your role.</AlertTitle>
          <AlertDescription>
            You do not have permission to create, edit, or send quotations.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="min-w-0 overflow-hidden p-4 sm:p-6">
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 max-w-sm min-w-[200px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search project or quote #…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="pending_manager_approval">Pending Manager Approval</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 max-h-[calc(100dvh-16rem)] overscroll-contain overflow-auto rounded-md border">
          <Table className="w-full min-w-[760px] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[7rem] whitespace-nowrap">Quote #</TableHead>
                <TableHead className="w-[18%]">Project</TableHead>
                <TableHead className="w-[18%]">Customer</TableHead>
                <TableHead className="w-[7rem] whitespace-nowrap">Date</TableHead>
                <TableHead className="w-[10.5rem]">Status</TableHead>
                <TableHead className="w-[8.5rem] whitespace-nowrap bg-card text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading ? (
                <LoadingRow colSpan={6} />
              ) : (list.data ?? []).length === 0 ? (
                <EmptyState colSpan={6} icon={FileText}>
                  {canWrite ? (
                    <>
                      No quotes yet.{" "}
                      <Link
                        to="/quotes/new"
                        search={{ customerId: undefined }}
                        className="text-primary underline"
                      >
                        Create your first quote
                      </Link>
                    </>
                  ) : (
                    "No quotes yet."
                  )}
                </EmptyState>
              ) : (
                list.data!.map((q) => {
                  return (
                    <TableRow
                      key={q.id}
                      role="link"
                      tabIndex={0}
                      aria-label={`Open quote ${q.quote_number}`}
                      className="group cursor-pointer outline-none transition-[background-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/35 active:bg-muted"
                      onClick={() => navigate({ to: "/quotes/$id", params: { id: q.id } })}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        navigate({ to: "/quotes/$id", params: { id: q.id } });
                      }}
                    >
                      <TableCell className="w-[7.5rem] whitespace-nowrap font-mono text-xs">
                        {q.quote_number}
                      </TableCell>
                      <TableCell className="min-w-0 font-medium">
                        <div className="truncate" title={q.project_name}>
                          {q.project_name}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-0">
                        {(q.customer as { customer_name: string } | null)?.customer_name ?? "—"}
                      </TableCell>
                      <TableCell className="w-[7.5rem] whitespace-nowrap text-sm text-muted-foreground">
                        {fmtDate(q.quote_date)}
                      </TableCell>
                      <TableCell className="w-[14rem]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={q.status} />
                          <span className="whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {q.tax_type === "vatable" ? "VAT" : "Non-VAT"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap bg-card text-right font-medium tabular-nums">
                        {peso(computeQuoteDisplayTotal(q))}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
