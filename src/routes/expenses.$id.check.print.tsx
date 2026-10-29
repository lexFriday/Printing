import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PrintShell, usePrintCalibrationContext } from "@/components/print/PrintShell";
import { amountToPesoWords } from "@/lib/amountWords";
import { formatPrintMoney } from "@/lib/printFormat";
import { generateCheckPdf, CHECK_LAYOUT_CONFIG } from "@/lib/physicalPrintPdf";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_PRINT_CALIBRATION,
  resolveFieldOffset,
  type PrintCalibration,
} from "@/lib/printCalibration";
import { resetPrintCalibration } from "@/lib/printCalibrationData";
import { COMPANY_PROFILE } from "@/lib/brand";
import { ArrowDown, CheckCircle2, FileText, Printer, RotateCcw } from "lucide-react";
import { toast } from "sonner";

const CHECK_PAGE_SIZE_IN = { width: 8, height: 3 } as const;
const CHECK_PAGE_SIZE_PT = [CHECK_PAGE_SIZE_IN.width * 72, CHECK_PAGE_SIZE_IN.height * 72] as const;
const CHECK_PRINT_PROFILE = {
  mediaWidthIn: CHECK_PAGE_SIZE_IN.width,
  mediaHeightIn: CHECK_PAGE_SIZE_IN.height,
  orientation: "landscape" as const,
  scalePercent: 100,
  marginsIn: 0,
  fitToPage: false,
  centerOnPage: false,
} as const;

const CHECK_FIELDS = CHECK_LAYOUT_CONFIG.fields;


type CheckPrintProps = {
  checkNo: string;
  payee: string;
  amount: string;
  amountWords: string;
  dateMonth: string;
  dateDay: string;
  dateYear: string;
};

export const Route = createFileRoute("/expenses/$id/check/print")({
  head: () => ({ meta: [{ title: `Print check - ${COMPANY_PROFILE.name}` }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    from: search.from === "job" ? "job" : "reports",
    jobId: typeof search.jobId === "string" ? search.jobId : undefined,
    tab: typeof search.tab === "string" ? search.tab : "disbursements",
  }),
  errorComponent: ({ error }) => (
    <PrintShell backTo="/reports" backLabel="Back to reports">
      <Alert variant="destructive">
        <AlertTitle>Unable to load check</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : "Something went wrong while loading this check."}
        </AlertDescription>
      </Alert>
    </PrintShell>
  ),
  component: CheckPrintPage,
});

function CheckPrintPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const nav = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) nav({ to: "/auth", replace: true });
  }, [loading, nav, user]);

  useEffect(() => {
    try {
      localStorage.removeItem("print-calibration-v2:default:check");
      localStorage.removeItem("print-calibration-v2:check");
    } catch {}
  }, []);

  const expense = useQuery({
    queryKey: ["check-print", id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_expenses")
        .select(
          "id, supplier_name, description, amount, check_date, paid_at, expense_date, supplier_document_no, check_number",
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const printProps = useMemo<CheckPrintProps | null>(() => {
    if (!expense.data) return null;
    const e = expense.data;
    const rawDate = e.check_date ?? e.paid_at ?? e.expense_date;
    const parsedDate = rawDate ? new Date(rawDate) : new Date();
    const date = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
    return {
      checkNo: e.check_number || "",
      payee: e.supplier_name || "PAYEE",
      amount: formatPrintMoney(e.amount),
      amountWords: amountToPesoWords(e.amount),
      dateMonth: String(date.getMonth() + 1).padStart(2, "0"),
      dateDay: String(date.getDate()).padStart(2, "0"),
      dateYear: String(date.getFullYear()),
    };
  }, [expense.data]);

  if (loading || expense.isLoading) {
    return (
      <div className="min-h-screen bg-background p-6 text-sm text-muted-foreground">
        Loading check...
      </div>
    );
  }

  if (expense.isError || !expense.data || !printProps) {
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

  const e = expense.data;
  const backTo = search.from === "job" && search.jobId ? "/jobs/$id" : "/reports";
  const backParams = search.from === "job" && search.jobId ? { id: search.jobId } : undefined;
  const backSearch = search.from === "job" && search.jobId ? undefined : { tab: search.tab };

  return (
    <PrintShell
      backTo={backTo}
      backParams={backParams}
      backSearch={backSearch}
      backLabel={search.from === "job" && search.jobId ? "Back to job" : "Back to reports"}
      pdfPageSize={CHECK_PAGE_SIZE_PT}
      pageCssSize="8in 3.3in"
      printProfile={CHECK_PRINT_PROFILE}
      printWithGeneratedPdf
      buildGeneratedPdf={(calibration) => buildCheckPdf({ ...printProps, calibration })}
      hideDownloadPdf={true}
      hideDownloadExcel={true}
      calibrationDocument="check"
      directPrintJob={{
        identifier: id,
        label: `CHK-${e.check_number || (id || "").slice(0, 8)}`,
        jobData: {
          documentType: "check",
          id,
          checkNo: printProps.checkNo,
          payee: String(printProps.payee || "").replace(/\*/g, "").trim(),
          amount: String(printProps.amount || "").replace(/\*/g, "").trim(),
          amountWords: String(printProps.amountWords || "").replace(/\*/g, "").trim(),
          dateMonth: printProps.dateMonth,
          dateDay: printProps.dateDay,
          dateYear: printProps.dateYear,
          date: `${printProps.dateYear}-${printProps.dateMonth}-${printProps.dateDay}`,
        },
      }}
    >
      <div className="mx-auto max-w-[8.5in] space-y-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-3 text-sm shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="font-medium text-slate-900">Standard Check Alignment Active</span>
            <span className="text-xs text-muted-foreground">(BDO 3&quot; &times; 8&quot; physical check)</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={async () => {
              try {
                await resetPrintCalibration("check");
              } catch {}
              try {
                localStorage.removeItem("print-calibration-v2:default:check");
                localStorage.removeItem("print-calibration-v2:check");
              } catch {}
              toast.success("Check alignment reset to verified standard layout.");
              window.location.reload();
            }}
          >
            <RotateCcw className="h-3 w-3" />
            Reset Alignment to Standard
          </Button>
        </div>

        {!e.supplier_name?.trim() || !e.check_number?.trim() ? (
          <Alert variant="destructive">
            <AlertTitle>Check details are incomplete.</AlertTitle>
            <AlertDescription>
              Add the supplier / payee and check number before printing the actual check.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="w-full space-y-5">
          <CheckDetailsCard printProps={printProps} expense={e} />
          <PrinterInsertionGuide printProps={printProps} />
        </div>
      </div>
    </PrintShell>
  );
}

function CheckDetailsCard({
  printProps,
  expense,
}: {
  printProps: CheckPrintProps;
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
          <span className="font-semibold text-sm text-slate-900">Check Voucher Details</span>
        </div>
        <span className="font-mono text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 border text-slate-800">
          Check #{printProps.checkNo || "Not Specified"}
        </span>
      </div>

      <div className="space-y-4 text-xs">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block mb-1">
            Pay To The Order Of
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
              Date (MM - DD - YYYY)
            </span>
            <div className="flex items-center sm:justify-end gap-1 font-mono text-xs font-bold text-slate-800 pt-1">
              <span className="bg-slate-100 border px-2 py-0.5 rounded">{printProps.dateMonth}</span>
              <span>-</span>
              <span className="bg-slate-100 border px-2 py-0.5 rounded">{printProps.dateDay}</span>
              <span>-</span>
              <span className="bg-slate-100 border px-2 py-0.5 rounded">{printProps.dateYear}</span>
            </div>
          </div>
        </div>

        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block mb-1">
            Pesos In Words
          </span>
          <div className="font-mono text-[11px] font-semibold uppercase text-slate-800 bg-slate-50 border rounded-lg p-3 leading-relaxed">
            {printProps.amountWords}
          </div>
        </div>
      </div>

      <div className="pt-3 border-t text-[11px] text-muted-foreground flex flex-wrap items-center justify-between gap-2">
        <span>Ref: {expense.supplier_document_no || `Expense #${(expense.id || "").slice(0, 8)}`}</span>
        {expense.description ? <span className="truncate max-w-xs">{expense.description}</span> : null}
      </div>
    </div>
  );
}

function PrinterInsertionGuide({ printProps }: { printProps?: CheckPrintProps }) {
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
          {isL121 ? "Epson L120 / L121 Top-Load (8\" Wide)" : "3\" × 8\" Portrait Feed (Narrow-Edge)"}
        </span>
      </div>

      {isL121 ? (
        /* Epson L120 / L121 Top-Load (8" Wide Edge Enters First) */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
          {/* Visual Check & Printer Feed Slot Representation */}
          <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50/70 p-4">
            {/* Check Visual Representation - Wide Horizontal */}
            <div className="w-[280px] h-[135px] rounded-sm border-2 border-dashed border-emerald-500 bg-white p-2 shadow-sm flex flex-col justify-between text-[9px] relative overflow-hidden">
              {/* Top / Leading Edge (Enters First) */}
              <div className="bg-emerald-600 text-white font-bold text-[8.5px] py-1 px-1 rounded-xs text-center tracking-tight leading-tight -mx-2 -mt-2 mb-1">
                ▼ TOP / LEADING EDGE (Enters First) ▼
                <div className="text-[7px] font-sans font-semibold pt-0.5 opacity-95">
                  Date &amp; Payee Header Side
                </div>
              </div>

              {/* Upright Check Content */}
              <div className="flex-1 flex flex-col justify-between py-1 px-2 bg-[#f4f9fc] border border-blue-200 rounded text-[8px] font-mono select-none">
                <div className="flex justify-between items-center text-[7px] text-slate-500 border-b border-blue-100 pb-0.5">
                  <span>ACC: 001248019895</span>
                  <span className="font-semibold text-slate-800">
                    {printProps?.dateMonth
                      ? `${printProps.dateMonth}-${printProps.dateDay}-${printProps.dateYear}`
                      : "06-21-2026"}
                  </span>
                </div>
                <div className="font-sans font-bold text-[8.5px] text-slate-900 truncate">
                  PAY: {printProps?.payee || "ARLECHINO CONCEPTS"}
                </div>
                <div className="flex justify-between items-center text-[7.5px] text-slate-700">
                  <span className="truncate max-w-[170px]">
                    PESOS: {printProps?.amountWords || "TEN THOUSAND PESOS ONLY"}
                  </span>
                  <span className="font-bold text-emerald-800">
                    ₱{printProps?.amount || "10,000.00"}
                  </span>
                </div>
              </div>

              {/* Bottom / Trailing Edge */}
              <div className="border-t border-slate-200 pt-0.5 mt-1 text-center text-[7px] font-semibold text-slate-500 bg-slate-50 -mx-2 -mb-2 pb-0.5">
                Trailing Edge (MICR / Check #{printProps?.checkNo || "None"})
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
              <span className="text-slate-400 font-bold">◄ Slide Left Guide</span>
              <span className="text-blue-300 font-bold">8&quot; Check Top Slot</span>
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
                <p className="font-semibold text-slate-900 text-xs">Align Against Fixed Right Guide</p>
                <p className="text-[11px] text-slate-600 leading-snug">
                  Load check flush against the fixed right guide rail, then slide the left guide snugly against the 8&quot; check width.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                2
              </div>
              <div>
                <p className="font-semibold text-slate-900 text-xs">Top Edge Enters First (Date &amp; Payee Header)</p>
                <p className="text-[11px] text-slate-600 leading-snug">
                  Facing the printer, the TOP edge of the check enters the feeder slot first. Text is upright facing toward you.
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
                  Place check with printed lines facing toward you.
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
                  Slide the top edge of the check downward into the feeder slot until seated.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Standard Center-Feed (Exact existing narrow-edge feed UNTOUCHED) */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
          {/* Visual Check & Printer Feed Slot Representation */}
          <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50/70 p-4">
            {/* Check Visual Representation */}
            <div className="w-[190px] h-[240px] rounded-sm border-2 border-dashed border-emerald-500 bg-white p-2 shadow-sm flex flex-col justify-between text-[9px] relative overflow-hidden">
              {/* Top / Trailing Edge (Date / Check No Side) */}
              <div className="border-b border-slate-200 pb-1 text-center text-[7.5px] font-semibold text-slate-500 bg-slate-50 -mx-2 -mt-2 pt-1">
                Trailing Edge (Date &amp; Signatures)
              </div>

              {/* Header indicating Left and Right guides */}
              <div className="flex justify-between w-full text-[7.5px] font-bold text-slate-500 font-mono px-0.5 pt-0.5">
                <span>◀ ACC NO. (LEFT)</span>
                <span>BDO (RIGHT) ▶</span>
              </div>

              {/* Rotated Check Content: Top on Left, BDO on Right, Stub at Bottom */}
              <div className="flex-1 flex items-center justify-center py-1">
                <div className="-rotate-90 origin-center w-[165px] space-y-1 text-[8px] font-mono text-slate-700 select-none border border-blue-200 rounded bg-[#f4f9fc] p-2 shadow-2xs">
                  <div className="flex justify-between items-center text-[7px] text-slate-500 border-b border-blue-100 pb-0.5">
                    <span className="font-bold text-slate-700">ACC: 001248019895</span>
                    <span className="font-semibold text-slate-800">{printProps?.dateMonth ? `${printProps.dateMonth}-${printProps.dateDay}-${printProps.dateYear}` : "06-21-2026"}</span>
                  </div>
                  <div className="font-sans font-bold text-[8.5px] text-slate-900 truncate">
                    PAY: {printProps?.payee || "ARLECHINO CONCEPTS"}
                  </div>
                  <div className="text-[7.5px] text-slate-600 truncate border-b border-blue-100 pb-0.5">
                    PESOS: {printProps?.amountWords ? printProps.amountWords.replace(/\*/g, "") : "TEN THOUSAND PESOS ONLY"}
                  </div>
                  <div className="flex justify-between items-center text-[7.5px] font-bold text-emerald-800 pt-0.5">
                    <span>BDO TIMOG</span>
                    <span>₱{printProps?.amount || "10,000.00"}</span>
                  </div>
                </div>
              </div>

              <div className="text-center text-[7px] font-medium text-emerald-700 bg-emerald-50 py-0.5 border-y border-emerald-100 -mx-2">
                Facing Printer: Acc # (Left) | BDO (Right)
              </div>

              {/* Bottom / Leading Edge (Stub Enters First) */}
              <div className="bg-emerald-600 text-white font-bold text-[8.5px] py-1 px-1 rounded-xs text-center tracking-tight leading-tight -mx-2 -mb-2">
                ▼ LEADING EDGE (Enters First) ▼
                <div className="text-[7px] font-sans font-semibold pt-0.5 opacity-95">
                  Stub / Payee Start Side
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
                  Adjust the printer feed slot guides to the narrow 3&quot; width to hold the check straight in center.
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
                  Facing the printer, Account # is on the LEFT, BDO logo is on the RIGHT, and the printed text faces to the RIGHT (rotated 90° clockwise).
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
                  Place check with printed lines facing toward you.
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
                  Slide the check downward into the 3&quot; feeder slot at the bottom until seated.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

async function buildCheckPdf({
  checkNo,
  payee,
  amount,
  amountWords,
  dateMonth,
  dateDay,
  dateYear,
  calibration,
}: CheckPrintProps & { calibration?: PrintCalibration }) {
  return generateCheckPdf(
    {
      checkNo,
      payee,
      amount,
      amountWords,
      dateMonth,
      dateDay,
      dateYear,
    },
    CHECK_LAYOUT_CONFIG,
    "standard",
    "/templates/check-template.jpg",
    calibration,
  );
}
