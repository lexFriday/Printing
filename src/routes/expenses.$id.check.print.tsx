import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { GeneratedPdfPreview, PrintShell } from "@/components/print/PrintShell";
import { amountToPesoWords } from "@/lib/amountWords";
import { drawPreprintedText } from "@/lib/preprintedPdf";
import { formatPrintMoney } from "@/lib/printFormat";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_PRINT_CALIBRATION, resolveFieldOffset, type PrintCalibration } from "@/lib/printCalibration";
import { COMPANY_PROFILE } from "@/lib/brand";
import { downloadPrintWorkbook } from "@/lib/printWorkbook";

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

const CHECK_FIELDS = {
  checkNo: { top: 1.9855, left: 4.05, width: 1.45, size: 12, align: "right" as const },
  payee: { top: 0.8831, left: 1.55, width: 3.95, size: 12 },
  amount: { top: 0.8692, left: 6.05, width: 1.42, size: 12, align: "right" as const },
  amountWords: { top: 1.2044, left: 1.43, width: 5.35, size: 12 },
  dateMonth: { top: 0.4860, left: 6.5787, width: 0.38, size: 14 },
  dateDay: { top: 0.4860, left: 6.985, width: 0.38, size: 14 },
  dateYear: { top: 0.4860, left: 7.45, width: 0.52, size: 14 },
} as const;

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
  head: () => ({ meta: [{ title: `Print BDO check - ${COMPANY_PROFILE.name}` }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    from: search.from === "job" ? "job" : "reports",
    jobId: typeof search.jobId === "string" ? search.jobId : undefined,
    tab: typeof search.tab === "string" ? search.tab : "disbursements",
  }),
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

  const expense = useQuery({
    queryKey: ["check-print", id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_expenses")
        .select(
          "id, supplier_name, description, amount, paid_at, expense_date, supplier_document_no, check_number",
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
    const date = new Date(e.paid_at ?? e.expense_date);
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

  const pdfArtifact = useMemo(
    () => (printProps ? buildCheckPdf(printProps) : null),
    [printProps],
  );

  if (loading || expense.isLoading) {
    return (
      <div className="min-h-screen bg-background p-6 text-sm text-muted-foreground">
        Loading check...
      </div>
    );
  }

  if (expense.isError || !expense.data || !printProps || !pdfArtifact) {
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
      downloadExcel={() => downloadPrintWorkbook("CHECK", printProps, `${printProps.checkNo || "check"}.xlsx`)}
      calibrationDocument="check"
    >
      <div className="mx-auto mb-4 grid max-w-[8in] gap-3 rounded-md border bg-white p-4 text-sm shadow-sm print:hidden">
        {!e.supplier_name?.trim() || !e.check_number?.trim() ? (
          <Alert variant="destructive">
            <AlertTitle>Check details are incomplete.</AlertTitle>
            <AlertDescription>
              Add the supplier / payee and check number before printing the actual check.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
      <GeneratedPdfPreview
        pdfArtifact={pdfArtifact}
        title="BDO check PDF preview"
        pageSizeIn={CHECK_PAGE_SIZE_IN}
      />
    </PrintShell>
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
  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF("l", "pt", [...CHECK_PAGE_SIZE_PT]);

  const draw = (args: Omit<Parameters<typeof drawPreprintedText>[1], "pageWidth" | "unit">, field?: string) =>
    drawPreprintedText(pdf, {
      ...args,
      offset: field ? resolveFieldOffset(calibration ?? DEFAULT_PRINT_CALIBRATION, field) : (calibration ?? DEFAULT_PRINT_CALIBRATION).page,
      pageWidth: CHECK_PAGE_SIZE_PT[0],
      unit: "in",
    });

  draw({ text: checkNo, ...CHECK_FIELDS.checkNo, fitToWidth: true, minSize: 9 }, "checkNo");
  draw({ text: payee, ...CHECK_FIELDS.payee, fitToWidth: true, minSize: 8 }, "payee");
  draw({ text: amount, ...CHECK_FIELDS.amount, fitToWidth: true, minSize: 10 }, "amount");
  draw({ text: amountWords, ...CHECK_FIELDS.amountWords, fitToWidth: true, minSize: 8 }, "amountWords");
  draw({ text: dateMonth, ...CHECK_FIELDS.dateMonth }, "dateMonth");
  draw({ text: dateDay, ...CHECK_FIELDS.dateDay }, "dateDay");
  draw({ text: dateYear, ...CHECK_FIELDS.dateYear }, "dateYear");
  return pdf;
}
