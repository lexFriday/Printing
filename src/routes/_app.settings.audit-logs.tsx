import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ScrollText, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { AccessDenied, EmptyState, LoadingRow, PageHeader } from "@/components/system";
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
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime } from "@/lib/format";
import { canManageUsers } from "@/lib/roles";

export const Route = createFileRoute("/_app/settings/audit-logs")({
  head: () => ({ meta: [{ title: "Audit Logs — AutoMate PH" }] }),
  component: AuditLogsPage,
});

type AuditRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  user_id: string | null;
  old_values: unknown;
  new_values: unknown;
  created_at: string;
  profile?: { email: string | null; display_name: string | null } | null;
};

function AuditLogsPage() {
  const { role, roleLoading } = useAuth();
  const canManage = canManageUsers(role);
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState("all");

  const logs = useQuery({
    queryKey: ["audit-logs", search, entityType],
    enabled: canManage,
    queryFn: async () => {
      let query = supabase
        .from("audit_logs")
        .select("id, action, entity_type, entity_id, user_id, old_values, new_values, created_at")
        .order("created_at", { ascending: false })
        .limit(200);

      if (entityType !== "all") query = query.eq("entity_type", entityType);

      const { data, error } = await query;
      if (error) throw error;

      const userIds = Array.from(
        new Set((data ?? []).map((row) => row.user_id).filter((id): id is string => Boolean(id))),
      );
      const profileMap = new Map<string, { email: string | null; display_name: string | null }>();
      if (userIds.length > 0) {
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("id, display_name, email")
          .in("id", userIds);
        if (profileError) throw profileError;
        (profiles ?? []).forEach((profile) => profileMap.set(profile.id, profile));
      }

      const rows = ((data ?? []) as AuditRow[]).map((row) => ({
        ...row,
        profile: row.user_id ? (profileMap.get(row.user_id) ?? null) : null,
      }));
      const term = search.trim().toLowerCase();
      if (!term) return rows;
      return rows.filter((row) =>
        [
          row.action,
          row.entity_type,
          row.entity_id,
          row.profile?.display_name,
          row.profile?.email,
          row.profile?.display_name ?? row.profile?.email ?? "System user",
          summarizeDetails(row.new_values, row.old_values),
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term)),
      );
    },
  });

  if (roleLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Change history" description="See who changed what and when." />
        <Card className="p-4">
          <Table>
            <TableBody>
              <LoadingRow colSpan={6} />
            </TableBody>
          </Table>
        </Card>
      </div>
    );
  }

  if (!canManage) {
    return (
      <AccessDenied
        title="Limited read-only access"
        description="Audit logs are available to the owner only."
      />
    );
  }

  return (
    <div className="space-y-6">
        <PageHeader
        title="Change history"
        description="See who changed what and when."
        actions={
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-success" />
            Only the owner can view this
          </div>
        }
      />

      <Card className="p-4">
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 max-w-sm min-w-[200px]">
            <Input
              placeholder="Search by person, item, or change..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All items</SelectItem>
              <SelectItem value="customers">Customers</SelectItem>
              <SelectItem value="quotations">Quotes</SelectItem>
              <SelectItem value="job_orders">Job Orders</SelectItem>
              <SelectItem value="job_expenses">Expenses</SelectItem>
              <SelectItem value="invoices">Invoices</SelectItem>
              <SelectItem value="user_roles">User Roles</SelectItem>
              <SelectItem value="profiles">Profiles</SelectItem>
              <SelectItem value="item_templates">Item Templates</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="max-h-[calc(100dvh-18rem)] overscroll-contain overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Area</TableHead>
                <TableHead>Changed by</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Change details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.isLoading ? (
                <LoadingRow colSpan={6} />
              ) : logs.isError ? (
                <EmptyState colSpan={6} icon={AlertCircle}>
                  We could not load the change history. Try again.
                </EmptyState>
              ) : (logs.data ?? []).length === 0 ? (
                <EmptyState colSpan={6} icon={ScrollText}>
                  {search.trim() || entityType !== "all" ? "No changes match your search." : "No changes recorded yet."}
                </EmptyState>
              ) : (
                logs.data!.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {fmtDateTime(log.created_at)}
                    </TableCell>
                    <TableCell className="font-medium">{labelAction(log.action)}</TableCell>
                    <TableCell>
                      {humanizeEntity(log.entity_type)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {log.profile?.display_name ?? log.profile?.email ?? "System user"}
                    </TableCell>
                    <TableCell className="text-sm" title={log.entity_id ?? undefined}>
                      <span className="font-medium">{humanizeEntity(log.entity_type)}</span>
                      {log.entity_id ? <span className="ml-2 font-mono text-xs text-muted-foreground">({log.entity_id.slice(0, 8)}…)</span> : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[360px] truncate" title={summarizeDetails(log.new_values, log.old_values)}>
                      {summarizeDetails(log.new_values, log.old_values)}
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

function labelAction(action: string) {
  const verb = action.split(".")[0];
  if (verb === "insert") return "Created";
  if (verb === "delete") return "Removed";
  if (verb === "update") return "Changed";
  if (action === "job_order.reopened") return "Reopened for correction";
  return action
    .split(".")
    .map((part) => part.replace("_", " "))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function summarizeDetails(newValues: unknown, oldValues: unknown) {
  const next = newValues && typeof newValues === "object" ? newValues as Record<string, unknown> : null;
  const previous = oldValues && typeof oldValues === "object" ? oldValues as Record<string, unknown> : null;
  if (next && previous) {
    const changes = Object.keys(next).filter((key) => !technicalFields.has(key) && String(previous[key] ?? "") !== String(next[key] ?? ""));
    if (changes.length) return changes.slice(0, 3).map((key) => formatChange(key, previous[key], next[key])).join(" · ");
  }
  const source = next ?? previous;
  if (!source) return "No extra details";
  const entries = Object.entries(source).filter(([key]) => !technicalFields.has(key)).slice(0, 3);
  return entries.length ? entries.map(([key, value]) => formatSet(key, value)).join(" · ") : "No extra details";
}

const technicalFields = new Set(["id", "created_at", "updated_at", "user_id", "entity_id"]);

function formatChange(key: string, before: unknown, after: unknown) {
  const oldText = displayValue(before);
  const newText = displayValue(after);
  if (oldText === "empty") return `${humanizeField(key)} added: “${newText}”`;
  if (newText === "empty") return `${humanizeField(key)} cleared`;
  return `${humanizeField(key)} changed from “${newTextForStatus(oldText)}” to “${newTextForStatus(newText)}”`;
}

function formatSet(key: string, value: unknown) {
  const text = displayValue(value);
  return text === "empty" ? `${humanizeField(key)} cleared` : `${humanizeField(key)} was set to “${newTextForStatus(text)}”`;
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "empty";
  return String(value);
}

function newTextForStatus(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanizeField(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanizeEntity(key: string) {
  const labels: Record<string, string> = {
    job_orders: "Job order",
    user_roles: "User access",
    profiles: "User profile",
    item_templates: "Item template",
    quotations: "Quote",
    customers: "Customer",
    invoices: "Invoice",
    job_expenses: "Expense",
  };
  return labels[key] ?? humanizeField(key);
}
