import { Badge } from "@/components/ui/badge";

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_manager_approval: "bg-warning/20 text-warning-foreground border-warning/40",
  pending_customer_approval: "bg-info/15 text-info border-info/30",
  sent: "bg-info/15 text-info border-info/30",
  approved: "bg-success/15 text-success border-success/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
  pending: "bg-muted text-muted-foreground",
  in_production: "bg-info/15 text-info border-info/30",
  ready: "bg-warning/20 text-warning-foreground border-warning/40",
  delivered: "bg-info/15 text-info border-info/30",
  completed: "bg-success/15 text-success border-success/30",
  issued: "bg-warning/20 text-warning-foreground border-warning/40",
  unpaid: "bg-warning/20 text-warning-foreground border-warning/40",
  partially_paid: "bg-info/15 text-info border-info/30",
  overdue: "bg-destructive/15 text-destructive border-destructive/30",
  paid: "bg-success/15 text-success border-success/30",
};

const STATUS_LABEL: Record<string, string> = {
  sent: "Sent",
  pending_manager_approval: "Pending Manager Approval",
  pending_customer_approval: "Pending Customer Approval",
  in_production: "In Production",
  ready: "Ready for Delivery",
  partially_paid: "Partially Paid",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={`whitespace-nowrap capitalize ${STATUS_CLASS[status] ?? ""}`}
    >
      {STATUS_LABEL[status] ?? status.replaceAll("_", " ")}
    </Badge>
  );
}
