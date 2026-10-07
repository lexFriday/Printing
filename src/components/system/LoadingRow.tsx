// Consolidates the inline "Loading…" TableRow used in every list page.
// Verbatim classes from src/routes/_app.quotes.index.tsx:78 and siblings.
import type { ReactNode } from "react";
import { TableCell, TableRow } from "@/components/ui/table";

export function LoadingRow({
  colSpan,
  children = "Loading…",
}: {
  colSpan: number;
  children?: ReactNode;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-12">
        {children}
      </TableCell>
    </TableRow>
  );
}
