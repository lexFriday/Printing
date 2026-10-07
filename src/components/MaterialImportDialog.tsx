import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import {
  materialImportPayload,
  materialImportTemplateCsv,
  parseMaterialImportFile,
  rejectedMaterialCsv,
  type MaterialImportRow,
} from "@/lib/materialImport";
import { canManageOperationalSettings } from "@/lib/roles";

type Props = { onImported: () => Promise<void> };

function downloadCsv(content: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function MaterialImportDialog({ onImported }: Props) {
  const { role } = useAuth();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<MaterialImportRow[]>([]);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!canManageOperationalSettings(role)) return null;

  const setDialogOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setRows([]);
  };
  const importMaterials = async () => {
    const payload = materialImportPayload(rows);
    if (!canManageOperationalSettings(role))
      return toast.error("Only an owner or admin can import materials.");
    if (!payload.length) return toast.error("Fix the rows marked Needs attention first.");
    setBusy(true);
    try {
      const confirmed = window.confirm(
        `Import ${payload.length} material${payload.length === 1 ? "" : "s"} and record their starting stock? Stock entries are permanent audit records.`,
      );
      if (!confirmed) return;
      // Generated Supabase types currently omit this migrated RPC.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)("import_materials_with_opening_stock", {
        p_rows: payload,
        p_import_key: crypto.randomUUID(),
      });
      if (error) throw error;
      setDialogOpen(false);
      await onImported();
      toast.success(
        `${payload.length} material${payload.length === 1 ? "" : "s"} and starting stock imported`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to import materials");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload aria-hidden="true" className="h-4 w-4" /> Import materials
      </Button>
      <Dialog open={open} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Import materials</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-3 text-sm">
              <p className="text-muted-foreground">
                Download the template, keep its column names, then review the material details and
                starting quantity before importing.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  downloadCsv(materialImportTemplateCsv(), "Material-Import-Template.csv")
                }
              >
                <Download aria-hidden="true" className="h-4 w-4" /> Download template
              </Button>
            </div>
            <label className="grid gap-2 text-sm font-medium">
              Upload CSV or Excel file
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                disabled={reading || busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setReading(true);
                  void (async () => {
                    try {
                      // Query the material SSOT so inactive duplicates are caught before saving.
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const { data, error } = await (supabase.from("materials") as any).select(
                        "name",
                      );
                      if (error) throw error;
                      setRows(
                        await parseMaterialImportFile(
                          file,
                          (data ?? []).map((row: { name: string }) => row.name),
                        ),
                      );
                    } catch (error) {
                      setRows([]);
                      toast.error(
                        error instanceof Error ? error.message : "We could not read that file.",
                      );
                    } finally {
                      setReading(false);
                    }
                  })();
                }}
              />
            </label>
            {rows.length ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border bg-muted/20 p-3 text-sm">
                    <div className="text-muted-foreground">Ready to import</div>
                    <div className="text-xl font-semibold">
                      {rows.filter((row) => !row.errors.length).length}
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/20 p-3 text-sm">
                    <div className="text-muted-foreground">Needs attention</div>
                    <div className="text-xl font-semibold">
                      {rows.filter((row) => row.errors.length).length}
                    </div>
                  </div>
                </div>
                <div className="max-h-80 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Material</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Starting quantity</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.rowNumber}>
                          <TableCell>{row.rowNumber}</TableCell>
                          <TableCell>{row.name || "—"}</TableCell>
                          <TableCell>{row.unit || "—"}</TableCell>
                          <TableCell>{row.category || "—"}</TableCell>
                          <TableCell>
                            {row.errors.includes("Starting quantity is required")
                              ? "—"
                              : row.starting_quantity}
                          </TableCell>
                          <TableCell>
                            {row.errors.length ? (
                              <span className="text-sm text-destructive">
                                {row.errors.join("; ")}
                              </span>
                            ) : (
                              <span className="text-sm text-emerald-700">Ready</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {rows.some((row) => row.errors.length) ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      downloadCsv(rejectedMaterialCsv(rows), "Material-Import-Rejected.csv")
                    }
                  >
                    Download rejected rows
                  </Button>
                ) : null}
              </>
            ) : reading ? (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                Reading and validating materials…
              </p>
            ) : (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                Choose a CSV or Excel file to preview it here.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy || !rows.some((row) => !row.errors.length)}
              onClick={() => void importMaterials()}
            >
              {busy ? "Importing…" : "Import materials and stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
