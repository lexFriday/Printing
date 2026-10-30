import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PrintShell, usePrintCalibrationContext } from "@/components/print/PrintShell";
import { fmtDate } from "@/lib/format";
import { addTemplateBackground, drawPreprintedText } from "@/lib/preprintedPdf";
import { generateCheckVoucherPdf } from "@/lib/physicalPrintPdf";
import { formatPrintMoney } from "@/lib/printFormat";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { resolveFieldOffset, type CalibrationOffset } from "@/lib/printCalibration";
import {
  assertCheckVoucherLayout,
  CHECK_VOUCHER_FIELDS,
  CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_IN,
  CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_PT,
  CHECK_VOUCHER_PRINT_PROFILE,
} from "@/lib/checkVoucherLayout";
import { COMPANY_PROFILE } from "@/lib/brand";
import { ArrowDown, CheckCircle2, FileText, Printer, RotateCcw } from "lucide-react";

assertCheckVoucherLayout();

const CHECK_VOUCHER_PRINT_PAYEE_OFFSET_IN = 0;
const CHECK_VOUCHER_PRINT_DATE_OFFSET_IN = 0;
const CHECK_VOUCHER_PRINT_PARTICULARS_OFFSET_IN = 0;
const CHECK_VOUCHER_PRINT_DOCUMENT_ROW_DOWN_OFFSET_IN = 0;
const CHECK_VOUCHER_PRINT_AMOUNT_OFFSET_IN = 0;
const CHECK_VOUCHER_PRINT_AMOUNT_LEFT_OFFSET_IN = 0;
const CHECK_VOUCHER_PRINT_CHECK_NUMBER_LEFT_OFFSET_IN = 0;
const CHECK_VOUCHER_PRINT_PAGE_ORIGIN_Y_IN = 0;
const CHECK_VOUCHER_SIGNATURE_TOP_IN = 5.75; // 5 3/4"

type CheckVoucherPrintProps = {
  date: string;
  payee: string;
  particulars: string;
  amount: string;
  documentNo: string;
  checkNo: string;
  preparedBy: string;
};

type PrintableVoucherField = {
  topIn: number;
  leftIn: number;
  widthIn: number;
  fontSize: number;
  align?: "left" | "right" | "center";
};

export const Route = createFileRoute("/expenses/$id/check-voucher/print")({
  head: () => ({ meta: [{ title: `Print check voucher — ${COMPANY_PROFILE.name}` }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    from: search.from === "job" ? "job" : "reports",
    jobId: typeof search.jobId === "string" ? search.jobId : undefined,
    tab: typeof search.tab === "string" ? search.tab : "disbursements",
  }),
  errorComponent: ({ error }) => (
    <PrintShell backTo="/reports" backLabel="Back to reports">
      <Alert variant="destructive">
        <AlertTitle>Unable to load voucher</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : "Something went wrong while loading this voucher."}
        </AlertDescription>
      </Alert>
    </PrintShell>
  ),
  component: CheckVoucherPrintPage,
});

function CheckVoucherPrintPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const [calibration, setCalibration] = useState({ xMm: 0, yMm: 0 });
  const [alignmentTest, setAlignmentTest] = useState(false);

  useEffect(() => {
    if (!loading && !user) nav({ to: "/auth", replace: true });
  }, [loading, nav, user]);

  const expense = useQuery({
    queryKey: ["check-voucher-print", id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_expenses")
        .select("*, job_order:job_orders(id, job_number, project_name)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const printProps = useMemo<CheckVoucherPrintProps | null>(() => {
    if (!expense.data) return null;
    const e = expense.data;
    const job = e.job_order as { id: string; job_number: string; project_name: string } | null;
    const particulars = [e.description, job ? `${job.job_number} - ${job.project_name}` : ""]
      .filter(Boolean)
      .join(" / ");
    return {
      date: fmtDate(e.check_date ?? e.paid_at ?? e.expense_date),
      payee: e.supplier_name || "-",
      particulars,
      amount: formatPrintMoney(e.amount),
      documentNo: e.supplier_document_no || "-",
      checkNo: e.check_number || "-",
      preparedBy: e.prepared_by_name_snapshot ?? "",
    };
  }, [expense.data]);

  const confirmPrinted = useMutation({
    mutationFn: async () => {
      if (!expense.data) return;
      const { error } = await supabase
        .from("job_expenses")
        .update({
          voucher_printed_at: expense.data.voucher_printed_at ?? new Date().toISOString(),
          voucher_print_count: Number(expense.data.voucher_print_count ?? 0) + 1,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["check-voucher-print", id] });
    },
  });

  const pdfArtifact = useMemo(
    () =>
      printProps
        ? buildCheckVoucherPdf(printProps, {
            originYIn: CHECK_VOUCHER_PRINT_PAGE_ORIGIN_Y_IN,
            calibration,
            alignmentTest,
          })
        : null,
    [printProps, calibration, alignmentTest],
  );

  if (loading || expense.isLoading) {
    return (
      <div className="min-h-screen bg-background p-6 text-sm text-muted-foreground">
        Loading voucher...
      </div>
    );
  }

  if (expense.isError || !expense.data) {
    return (
      <PrintShell backTo="/reports" backLabel="Back to reports">
        <Alert variant="destructive">
          <AlertTitle>Payable not found.</AlertTitle>
          <AlertDescription>
            The expense may have been deleted or you may not have permission to view it.
          </AlertDescription>
        </Alert>
      </PrintShell>
    );
  }

  if (!printProps) return null;

  const e = expense.data;
  const missingVoucherFields = [
    !e.supplier_name?.trim() ? "Payee" : "",
    !e.check_number?.trim() ? "Check number" : "",
    !e.supplier_document_no?.trim() ? "DR / invoice number" : "",
  ].filter(Boolean);
  const backTo = search.from === "job" && search.jobId ? "/jobs/$id" : "/reports";
  const backParams = search.from === "job" && search.jobId ? { id: search.jobId } : undefined;
  const backSearch = search.from === "job" && search.jobId ? undefined : { tab: search.tab };

  return (
    <PrintShell
      backTo={backTo}
      backParams={backParams}
      backSearch={backSearch}
      backLabel={search.from === "job" && search.jobId ? "Back to job" : "Back to reports"}
      pdfPageSize={CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_PT}
      pageCssSize={`${CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_IN.width}in ${CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_IN.height}in`}
      printProfile={CHECK_VOUCHER_PRINT_PROFILE}
      printWithGeneratedPdf
      calibrationDocument="check-voucher"
      buildGeneratedPdf={(sharedCalibration) =>
        generateCheckVoucherPdf(
          {
            ...e,
            ...printProps,
          },
          undefined,
          "standard",
          "/templates/check-voucher-template.jpg",
          sharedCalibration,
        )
      }
      buildGeneratedPrintPdf={(sharedCalibration) =>
        generateCheckVoucherPdf(
          {
            ...e,
            ...printProps,
          },
          undefined,
          "standard",
          "/templates/check-voucher-template.jpg",
          sharedCalibration,
        )
      }
      hideDownloadPdf={false}
      hideDownloadExcel={true}
      directPrintJob={{
        identifier: id,
        label: `CV-${e.supplier_document_no || id.slice(0, 8)}`,
        jobData: {
          documentType: "check-voucher",
          id,
          date: printProps.date,
          payee: printProps.payee,
          particulars: printProps.particulars,
          amount: printProps.amount,
          documentNo: printProps.documentNo,
          checkNo: printProps.checkNo,
          checkDate: e.check_date ? fmtDate(e.check_date) : printProps.date,
          preparedBy: printProps.preparedBy,
          supplier_name: e.supplier_name,
          check_number: e.check_number,
          supplier_document_no: e.supplier_document_no,
          description: e.description,
          prepared_by_name_snapshot: e.prepared_by_name_snapshot,
        },
      }}
    >
      <div className="mx-auto max-w-[8.5in] space-y-4 print:hidden">
        {missingVoucherFields.length > 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 shadow-2xs">
            <p className="font-semibold text-slate-700">Some voucher details are still missing.</p>
            <p className="mt-0.5">
              Missing: {missingVoucherFields.join(", ")}. Complete these fields before issuing the final voucher.
            </p>
          </div>
        ) : null}

        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-md border bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 shadow-2xs text-slate-700"
            disabled={confirmPrinted.isPending}
            onClick={() => confirmPrinted.mutate()}
          >
            {confirmPrinted.isPending ? "Saving..." : "Confirm printed / reprinted"}
          </button>
        </div>        <div className="w-full space-y-5">
          <CheckVoucherDetailsCard printProps={printProps} expense={e} />
          <CheckVoucherInsertionGuide printProps={printProps} />
        </div>
      </div>
    </PrintShell>
  );
}

function CheckVoucherDetailsCard({
  printProps,
  expense,
}: {
  printProps: CheckVoucherPrintProps;
  expense: {
    id: string;
    description?: string | null;
    supplier_document_no?: string | null;
  };
}) {
  return (
    <div className="rounded-xl border bg-white p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm text-slate-900">Check Voucher Summary</span>
        </div>
        <span className="font-mono text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 border text-slate-800">
          Check #{printProps.checkNo || "None"}
        </span>
      </div>

      <div className="space-y-4 text-xs">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block mb-1">
            Paid To (Payee)
          </span>
          <div className="text-base font-bold text-slate-900 border-b border-dashed border-slate-300 pb-1">
            {printProps.payee || "—"}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg bg-slate-50/70 border p-3.5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block mb-1">
              Amount (Pesos)
            </span>
            <div className="font-mono text-xl font-extrabold text-emerald-700">
              ₱{printProps.amount}
            </div>
          </div>

          <div className="sm:text-right">
            <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block mb-1">
              Voucher Date
            </span>
            <div className="font-mono text-xs font-bold text-slate-800 pt-1">
              {printProps.date}
            </div>
          </div>
        </div>

        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block mb-1">
            Particulars / Description
          </span>
          <div className="font-mono text-[11px] text-slate-800 bg-slate-50 border rounded-lg p-3 leading-relaxed">
            {printProps.particulars || "No particulars specified."}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 border p-3 text-center">
          <div>
            <span className="text-[9.5px] uppercase font-bold tracking-wider text-muted-foreground block mb-0.5">
              Check Date
            </span>
            <div className="font-mono text-xs font-bold text-slate-800">
              {printProps.date || "—"}
            </div>
          </div>
          <div className="border-x border-slate-200">
            <span className="text-[9.5px] uppercase font-bold tracking-wider text-muted-foreground block mb-0.5">
              DR / Invoice Number
            </span>
            <div className="font-mono text-xs font-bold text-slate-800">
              {printProps.documentNo || "—"}
            </div>
          </div>
          <div>
            <span className="text-[9.5px] uppercase font-bold tracking-wider text-muted-foreground block mb-0.5">
              Check Number
            </span>
            <div className="font-mono text-xs font-bold text-slate-800">
              {printProps.checkNo || "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="pt-3 border-t text-[11px] text-muted-foreground flex flex-wrap items-center justify-between gap-2">
        <span>Doc Ref: {printProps.documentNo || expense.supplier_document_no || `EXP-${expense.id.slice(0, 8)}`}</span>
        {printProps.preparedBy ? <span>Prepared by: {printProps.preparedBy}</span> : null}
      </div>
    </div>
  );
}

function CheckVoucherInsertionGuide({ printProps }: { printProps?: CheckVoucherPrintProps }) {
  const { printerModel } = usePrintCalibrationContext();
  const isL121 = printerModel === "epson-l121";

  return (
    <div className="rounded-xl border bg-white p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-2">
          <Printer className="h-4 w-4 text-emerald-600" />
          <span className="font-semibold text-sm text-slate-900">Printer Insertion Guide</span>
        </div>
        <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
          {isL121 ? "Epson L120 / L121 Top-Load (A5 Landscape, 210mm)" : "3\" Guide Feeder (Facing Right)"}
        </span>
      </div>

      {isL121 ? (
        /* Epson L120 / L121 Top-Load (A5 Landscape 210mm Edge Enters First) */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
          {/* Visual Check Voucher & Printer Feed Slot Representation */}
          <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50/70 p-4">
            {/* Voucher Visual Representation - Landscape A5 */}
            <div className="w-[280px] h-[190px] rounded-sm border-2 border-dashed border-emerald-500 bg-white p-2 shadow-sm flex flex-col justify-between text-[9px] relative overflow-hidden">
              {/* Top / Leading Edge (Enters First) */}
              <div className="bg-emerald-600 text-white font-bold text-[8.5px] py-1 px-1 rounded-xs text-center tracking-tight leading-tight -mx-2 -mt-2 mb-1">
                ▼ TOP / LEADING EDGE (Enters First) ▼
                <div className="text-[7px] font-sans font-semibold pt-0.5 opacity-95">
                  Voucher Header &amp; Date Side
                </div>
              </div>

              {/* Upright Check Voucher Content */}
              <div className="flex-1 flex flex-col justify-between py-1 px-2 bg-[#f4fcf7] border border-emerald-200 rounded text-[8px] font-mono select-none space-y-1">
                <div className="flex justify-between items-center text-[7px] text-slate-500 border-b border-emerald-100 pb-0.5">
                  <span className="font-bold text-slate-700">
                    CV #{printProps?.checkNo || printProps?.documentNo || "VOUCHER"}
                  </span>
                  <span className="font-semibold text-slate-800">{printProps?.date || "2026-06-21"}</span>
                </div>
                <div className="font-sans font-bold text-[8.5px] text-slate-900 truncate">
                  PAY: {printProps?.payee || "PAYEE NAME"}
                </div>
                <div className="text-[7.5px] text-slate-600 truncate border-b border-emerald-100 pb-0.5">
                  FOR: {printProps?.particulars?.slice(0, 36) || "PAYMENT DETAILS"}
                </div>
                <div className="flex justify-between items-center text-[7.5px] font-bold text-emerald-800 pt-0.5">
                  <span>CHECK VOUCHER</span>
                  <span>₱{printProps?.amount || "0.00"}</span>
                </div>
              </div>

              {/* Bottom / Trailing Edge */}
              <div className="border-t border-slate-200 pt-0.5 mt-1 text-center text-[7px] font-semibold text-slate-500 bg-slate-50 -mx-2 -mb-2 pb-0.5">
                Trailing Edge (Prepared By &amp; Signatures Block)
              </div>
            </div>

            {/* Directional Feed Arrow pointing DOWN into slot */}
            <div className="flex items-center gap-1.5 py-2 text-emerald-700 font-bold text-[11px]">
              <ArrowDown className="h-3.5 w-3.5 animate-bounce" />
              <span>Insert Top Edge Downwards Into Feeder Slot</span>
              <ArrowDown className="h-3.5 w-3.5 animate-bounce" />
            </div>

            {/* Printer Feed Slot at the BOTTOM */}
            <div className="w-full max-w-[280px] flex items-center justify-between px-3 py-1.5 rounded-b-md bg-slate-800 text-white text-[10px] font-mono font-medium shadow-sm border-t-2 border-emerald-400">
              <span className="text-slate-400 font-bold">◄ Left Guide (210mm)</span>
              <span className="text-blue-300 font-bold">Full A5 Landscape Slot</span>
              <span className="text-amber-400 font-bold">Fixed Right Guide ▮</span>
            </div>
          </div>

          {/* Step-by-Step Instructions */}
          <div className="space-y-3 text-xs text-slate-700">
            <div className="flex items-start gap-3">
              <div className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                1
              </div>
              <div>
                <p className="font-semibold text-slate-900 text-xs">Full Carriage Width (A5 Landscape)</p>
                <p className="text-[11px] text-slate-600 leading-snug">
                  The voucher is 210 mm wide (full A4 carriage width). Load it across the tray flush against the fixed right guide.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                2
              </div>
              <div>
                <p className="font-semibold text-slate-900 text-xs">Top Edge Enters First (Voucher Title &amp; Date)</p>
                <p className="text-[11px] text-slate-600 leading-snug">
                  Facing the printer, the TOP edge enters the feeder slot first. Text is upright facing toward you.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                3
              </div>
              <div>
                <p className="font-semibold text-slate-900 text-xs">Face Up</p>
                <p className="text-[11px] text-slate-600 leading-snug">
                  Place voucher with pre-printed lines facing toward you.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                4
              </div>
              <div>
                <p className="font-semibold text-slate-900 text-xs">Insert Downward Top Edge First</p>
                <p className="text-[11px] text-slate-600 leading-snug">
                  Slide the top edge of the voucher downward into the feeder slot until seated.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Standard Center-Feed (Exact existing narrow-edge feed UNTOUCHED) */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
          {/* Visual Check Voucher & Printer Feed Slot Representation */}
          <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50/70 p-4">
            {/* Voucher Visual Representation */}
            <div className="w-[190px] h-[240px] rounded-sm border-2 border-dashed border-emerald-500 bg-white p-2 shadow-sm flex flex-col justify-between text-[9px] relative overflow-hidden">
              {/* Top / Trailing Edge */}
              <div className="border-b border-slate-200 pb-1 text-center text-[7.5px] font-semibold text-slate-500 bg-slate-50 -mx-2 -mt-2 pt-1">
                Trailing Edge (Continuous Form Sheet)
              </div>

              {/* Header indicating Left and Right */}
              <div className="flex justify-between w-full text-[7.5px] font-bold text-slate-500 font-mono px-0.5 pt-0.5">
                <span>◀ ACC NO. / TOP (LEFT)</span>
                <span>BDO / BOTTOM (RIGHT) ▶</span>
              </div>

              {/* Rotated Check Voucher Content */}
              <div className="flex-1 flex items-center justify-center py-1">
                <div className="-rotate-90 origin-center w-[165px] space-y-1 text-[8px] font-mono text-slate-700 select-none border border-emerald-200 rounded bg-[#f4fcf7] p-2 shadow-2xs">
                  <div className="flex justify-between items-center text-[7px] text-slate-500 border-b border-emerald-100 pb-0.5">
                    <span className="font-bold text-slate-700">CV #{printProps?.checkNo || printProps?.documentNo || "VOUCHER"}</span>
                    <span className="font-semibold text-slate-800">{printProps?.date || "2026-06-21"}</span>
                  </div>
                  <div className="font-sans font-bold text-[8.5px] text-slate-900 truncate">
                    PAY: {printProps?.payee || "PAYEE NAME"}
                  </div>
                  <div className="text-[7.5px] text-slate-600 truncate border-b border-emerald-100 pb-0.5">
                    FOR: {printProps?.particulars?.slice(0, 24) || "PAYMENT DETAILS"}
                  </div>
                  <div className="flex justify-between items-center text-[7.5px] font-bold text-emerald-800 pt-0.5">
                    <span>CHECK VOUCHER</span>
                    <span>₱{printProps?.amount || "0.00"}</span>
                  </div>
                </div>
              </div>

              <div className="text-center text-[7px] font-medium text-emerald-700 bg-emerald-50 py-0.5 border-y border-emerald-100 -mx-2">
                Facing Printer: Acc # (Left) | BDO (Right)
              </div>

              {/* Bottom / Leading Edge (Enters First) */}
              <div className="bg-emerald-600 text-white font-bold text-[8.5px] py-1 px-1 rounded-xs text-center tracking-tight leading-tight -mx-2 -mb-2">
                ▼ LEADING EDGE (Enters First) ▼
                <div className="text-[7px] font-sans font-semibold pt-0.5 opacity-95">
                  Voucher Leading Edge
                </div>
              </div>
            </div>

            {/* Directional Feed Arrow pointing DOWN into slot */}
            <div className="flex items-center gap-1.5 py-2 text-emerald-700 font-bold text-[11px]">
              <ArrowDown className="h-3.5 w-3.5 animate-bounce" />
              <span>Insert Downwards Into Feeder Slot</span>
              <ArrowDown className="h-3.5 w-3.5 animate-bounce" />
            </div>

            {/* Printer Feed Slot at the BOTTOM */}
            <div className="w-full max-w-[260px] flex items-center justify-between px-3 py-1.5 rounded-b-md bg-slate-800 text-white text-[10px] font-mono font-medium shadow-sm border-t-2 border-emerald-400">
              <span className="text-slate-400 font-bold">◄ Left Guide</span>
              <span className="text-emerald-300 font-bold">3&quot; Guide Feeder Slot</span>
              <span className="text-slate-400 font-bold">Right Guide ►</span>
            </div>
          </div>

          {/* Step-by-Step Instructions */}
          <div className="space-y-3 text-xs text-slate-700">
            <div className="flex items-start gap-3">
              <div className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                1
              </div>
              <div>
                <p className="font-semibold text-slate-900 text-xs">Set 3&quot; Guides on Feeder Slot Below</p>
                <p className="text-[11px] text-slate-600 leading-snug">
                  Set the printer feed slot guides to the narrow 3&quot; guide feeder width to keep the voucher straight in center.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                2
              </div>
              <div>
                <p className="font-semibold text-slate-900 text-xs">Account # on Left, BDO on Right (Text Faces Right)</p>
                <p className="text-[11px] text-slate-600 leading-snug">
                  Facing the printer, Account # is on the LEFT, BDO is on the RIGHT, and the text faces to the RIGHT (rotated 90° clockwise).
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                3
              </div>
              <div>
                <p className="font-semibold text-slate-900 text-xs">Face Up</p>
                <p className="text-[11px] text-slate-600 leading-snug">
                  Place paper with pre-printed voucher lines facing toward you.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                4
              </div>
              <div>
                <p className="font-semibold text-slate-900 text-xs">Insert Downward Leading Edge First</p>
                <p className="text-[11px] text-slate-600 leading-snug">
                  Slide the voucher downward into the 3&quot; feeder slot at the bottom until seated.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

async function buildCheckVoucherPdf(
  { date, payee, particulars, amount, documentNo, checkNo, preparedBy }: CheckVoucherPrintProps,
  {
    originYIn = 0,
    calibration = { xMm: 0, yMm: 0 },
    fieldOffsets = {},
    alignmentTest = false,
  }: {
    originYIn?: number;
    calibration?: { xMm: number; yMm: number };
    fieldOffsets?: Record<string, CalibrationOffset>;
    alignmentTest?: boolean;
  } = {},
) {
  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF("l", "pt", [...CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_PT]);
  await addTemplateBackground(
    pdf,
    "/templates/check-voucher-template.jpg",
    CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_PT[0],
    CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_PT[1],
  );
  const draw = (args: Omit<Parameters<typeof drawPreprintedText>[1], "pageWidth" | "unit">) =>
    drawPreprintedText(pdf, {
      ...args,
      pageWidth: CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_PT[0],
      unit: "in",
    });
  const xOffsetIn = calibration.xMm / 25.4;
  const yOffsetIn = calibration.yMm / 25.4;

  if (alignmentTest) {
    draw({
      text: "ALIGNMENT TEST - 100% / ACTUAL SIZE",
      top: 0.25 + yOffsetIn,
      left: 0.25 + xOffsetIn,
      width: 8,
      size: 9,
      align: "center",
    });
    draw({
      text: "+  1 inch  +  2 inch  +  3 inch  +",
      top: 0.52 + yOffsetIn,
      left: 0.25 + xOffsetIn,
      width: 8,
      size: 8,
      align: "center",
    });
  }

  drawField({
    text: date,
    field: CHECK_VOUCHER_FIELDS.date,
    fieldId: "date",
    extraTopIn: CHECK_VOUCHER_PRINT_DATE_OFFSET_IN,
  });
  drawField({
    text: payee,
    field: CHECK_VOUCHER_FIELDS.payee,
    fieldId: "payee",
    extraTopIn: CHECK_VOUCHER_PRINT_PAYEE_OFFSET_IN,
  });
  drawField({
    text: particulars,
    field: CHECK_VOUCHER_FIELDS.particulars,
    fieldId: "particulars",
    extraTopIn: CHECK_VOUCHER_PRINT_PARTICULARS_OFFSET_IN,
  });
  drawField({
    text: amount,
    field: CHECK_VOUCHER_FIELDS.amount1,
    fieldId: "amount",
    extraTopIn: CHECK_VOUCHER_PRINT_AMOUNT_OFFSET_IN,
    extraLeftIn: CHECK_VOUCHER_PRINT_AMOUNT_LEFT_OFFSET_IN,
  });
  drawField({
    text: amount,
    field: CHECK_VOUCHER_FIELDS.amount2,
    fieldId: "amount",
    extraTopIn: CHECK_VOUCHER_PRINT_AMOUNT_OFFSET_IN,
    extraLeftIn: CHECK_VOUCHER_PRINT_AMOUNT_LEFT_OFFSET_IN,
  });
  drawField({
    text: documentNo,
    field: { ...CHECK_VOUCHER_FIELDS.documentNo, topIn: CHECK_VOUCHER_FIELDS.particulars.topIn },
    fieldId: "documentNo",
    extraTopIn:
      CHECK_VOUCHER_PRINT_PARTICULARS_OFFSET_IN + CHECK_VOUCHER_PRINT_DOCUMENT_ROW_DOWN_OFFSET_IN,
  });
  drawField({
    text: checkNo,
    field: { ...CHECK_VOUCHER_FIELDS.checkNo, topIn: CHECK_VOUCHER_FIELDS.particulars.topIn },
    fieldId: "checkNo",
    extraTopIn:
      CHECK_VOUCHER_PRINT_PARTICULARS_OFFSET_IN + CHECK_VOUCHER_PRINT_DOCUMENT_ROW_DOWN_OFFSET_IN,
    extraLeftIn: CHECK_VOUCHER_PRINT_CHECK_NUMBER_LEFT_OFFSET_IN,
  });
  drawSignatureBlocks(preparedBy);

  return pdf;

  function drawSignatureBlocks(preparedByName: string) {
    const top =
      originYIn + CHECK_VOUCHER_PRINT_PAGE_ORIGIN_Y_IN * -1 + CHECK_VOUCHER_SIGNATURE_TOP_IN;
    const blocks = [
      { name: preparedByName, left: 0.92, width: 1.8, align: "left" as const },
      { name: "", left: 3.62, width: 1.95, align: "center" as const },
      { name: "", left: 6.42, width: 1.45, align: "center" as const },
    ];

    for (const block of blocks) {
      draw({
        text: block.name,
        top: top - 0.28 + yOffsetIn,
        left: block.left + xOffsetIn,
        width: block.width,
        size: 11,
        align: block.align,
      });
    }
  }

  function drawField({
    text,
    field,
    fieldId,
    extraTopIn = 0,
    extraLeftIn,
  }: {
    text: string;
    field: PrintableVoucherField;
    fieldId: string;
    extraTopIn?: number;
    extraLeftIn?: number;
  }) {
    const align = "align" in field ? field.align : "left";
    draw({
      text,
      top: field.topIn + originYIn + extraTopIn + yOffsetIn,
      left: field.leftIn + (extraLeftIn ?? 0) + xOffsetIn,
      width: field.widthIn,
      size: field.fontSize,
      minSize:
        fieldId === "particulars" || fieldId === "payee" ? 8 : Math.max(9, field.fontSize - 2),
      fitToWidth: true,
      align,
      offset: resolveFieldOffset(
        { page: { xMm: calibration.xMm, yMm: calibration.yMm }, fields: fieldOffsets },
        fieldId,
      ),
    });
  }
}
