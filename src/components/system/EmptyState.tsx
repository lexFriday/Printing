// Consolidates the empty TableRow pattern in list pages
// (see _app.quotes.index.tsx:80, _app.jobs.index.tsx:69, _app.invoices.index.tsx:69, _app.customers.tsx:87).
// Lucide icon at h-8 w-8 opacity-40 + muted text inside a TableRow.
import type { ComponentType, ReactNode } from "react";
import { TableCell, TableRow } from "@/components/ui/table";

export function EmptyState({
  colSpan,
  icon: Icon,
  children,
}: {
  colSpan: number;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-12">
        {Icon ? <Icon className="h-8 w-8 mx-auto mb-2 opacity-40" /> : null}
        {children}
      </TableCell>
    </TableRow>
  );
}
