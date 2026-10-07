import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { Search, ClipboardList } from "lucide-react";
import { peso, fmtDate } from "@/lib/format";
import { StatusPill as StatusBadge } from "@/components/system";
import { LoadingRow, EmptyState } from "@/components/system";

const JOB_STATUSES = ["pending", "in_production", "ready", "delivered", "completed"] as const;

export const Route = createFileRoute("/_app/jobs/")({
  head: () => ({ meta: [{ title: "Job Orders — AutoMate PH" }] }),
  component: JobsList,
});

function JobsList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const list = useQuery({
    queryKey: ["jobs", search, status],
    queryFn: async () => {
      let q = supabase
        .from("job_orders")
        .select(
          "id, job_number, project_name, quoted_amount, tax_type, target_completion_date, status, customer:customers(customer_name)",
        )
        .order("created_at", { ascending: false });
      if (status !== "all") q = q.eq("status", status as (typeof JOB_STATUSES)[number]);
      if (search) q = q.or(`project_name.ilike.%${search}%,job_number.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Job Orders</h1>
          <p className="text-muted-foreground mt-1">Approved work currently in production.</p>
        </div>
      </div>

      <Card className="min-w-0 p-5">
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="relative flex-1 max-w-sm min-w-[200px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search project or job #…"
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
              {JOB_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 max-h-[calc(100dvh-16rem)] overscroll-contain overflow-auto">
          <Table className="min-w-[900px] table-auto">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[8rem] whitespace-nowrap">Job #</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="w-[8.5rem] whitespace-nowrap">Target date</TableHead>
                <TableHead className="w-[12rem] whitespace-nowrap">Status</TableHead>
                <TableHead className="w-[8rem] whitespace-nowrap text-right">Quoted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading ? (
                <LoadingRow colSpan={6} />
              ) : (list.data ?? []).length === 0 ? (
                <EmptyState colSpan={6} icon={ClipboardList}>
                  No job orders yet. Convert an approved quote.
                </EmptyState>
              ) : (
                list.data!.map((j) => (
                  <TableRow
                    key={j.id}
                    role="link"
                    tabIndex={0}
                    aria-label={`Open job order ${j.job_number}`}
                    className="group cursor-pointer outline-none transition-[background-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/35 active:bg-muted"
                    onClick={() => navigate({ to: "/jobs/$id", params: { id: j.id } })}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      navigate({ to: "/jobs/$id", params: { id: j.id } });
                    }}
                  >
                    <TableCell className="w-[8rem] whitespace-nowrap font-mono text-xs">
                      {j.job_number}
                    </TableCell>
                    <TableCell className="min-w-[12rem] whitespace-normal font-medium">
                      <div className="break-words leading-snug">{j.project_name}</div>
                    </TableCell>
                    <TableCell className="min-w-[12rem] whitespace-normal">
                      {(j.customer as { customer_name: string } | null)?.customer_name ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {fmtDate(j.target_completion_date)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <TaxPill taxType={j.tax_type} />
                      <StatusBadge status={j.status} />
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
