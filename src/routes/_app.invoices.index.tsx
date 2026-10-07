import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
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
import { Plus, Search, Receipt } from "lucide-react";
import { peso, fmtDate } from "@/lib/format";
import { StatusPill as StatusBadge } from "@/components/system";
import { LoadingRow, EmptyState } from "@/components/system";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/invoices/")({
  head: () => ({ meta: [{ title: "Invoices — AutoMate PH" }] }),
  component: InvoicesList,
});

function InvoicesList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const list = useQuery({
    queryKey: ["invoices", search, status],
    queryFn: async () => {
      let q = supabase
        .from("invoices")
        .select(
          "id, invoice_number, invoice_date, due_date, invoice_amount, amount_due_snapshot, tax_type, status, customer:customers(customer_name), job_order:job_orders(project_name)",
        )
        .order("created_at", { ascending: false });
      if (status !== "all") q = q.eq("status", status as "issued" | "paid");
      if (search) q = q.ilike("invoice_number", `%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-4 border-b pb-5">
        <div>
          <h1 className="text-3xl font-semibold">Invoices</h1>
          <p className="text-muted-foreground mt-1">
            Job invoices and standalone customer invoices.
          </p>
        </div>
        <Button asChild>
          <Link to="/invoices/new">
            <Plus className="h-4 w-4" /> New invoice
          </Link>
        </Button>
      </div>

      <Card className="min-w-0 p-5">
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="relative flex-1 max-w-sm min-w-[200px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search invoice #…"
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
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="issued">Issued</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 max-h-[calc(100dvh-16rem)] overscroll-contain overflow-auto">
          <Table className="min-w-[900px] table-auto">
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead className="w-[14rem]">Project</TableHead>
                <TableHead className="w-[14rem]">Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-[12rem]">Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading ? (
                <LoadingRow colSpan={6} />
              ) : (list.data ?? []).length === 0 ? (
                <EmptyState colSpan={6} icon={Receipt}>
                  No invoices yet. Create one here or generate one from a completed job order.
                </EmptyState>
              ) : (
                list.data!.map((i) => (
                  <TableRow
                    key={i.id}
                    role="link"
                    tabIndex={0}
                    aria-label={`Open invoice ${i.invoice_number}`}
                    className="group cursor-pointer outline-none transition-[background-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/35 active:bg-muted"
                    onClick={() => navigate({ to: "/invoices/$id", params: { id: i.id } })}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      navigate({ to: "/invoices/$id", params: { id: i.id } });
                    }}
                  >
                    <TableCell className="font-mono text-xs">{i.invoice_number}</TableCell>
                    <TableCell className="min-w-[12rem] whitespace-normal font-medium">
                      <div className="break-words leading-snug">
                        {(i.job_order as { project_name: string } | null)?.project_name ??
                          "Standalone invoice"}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-[12rem] whitespace-normal">
                      <div className="break-words leading-snug">
                        {(i.customer as { customer_name: string } | null)?.customer_name}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmtDate(i.invoice_date)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <TaxPill taxType={i.tax_type} />
                        <StatusBadge status={i.status} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {peso(i.amount_due_snapshot ?? i.invoice_amount)}
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

function TaxPill({ taxType }: { taxType?: string | null }) {
  return (
    <span className="whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {taxType === "vatable" ? "VAT" : "Non-VAT"}
    </span>
  );
}
