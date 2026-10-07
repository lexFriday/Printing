import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { GeneratedPdfPreview, PrintShell } from "@/components/print/PrintShell";
import { fmtDate } from "@/lib/format";
import { drawPreprintedText } from "@/lib/preprintedPdf";
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
import { downloadPrintWorkbook } from "@/lib/printWorkbook";

assertCheckVoucherLayout();

const CHECK_VOUCHER_PRINT_PAYEE_OFFSET_IN = 0;
const CHECK_VOUCHER_PRINT_DATE_OFFSET_IN = 0;
const CHECK_VOUCHER_PRINT_PARTICULARS_OFFSET_IN = 0;
const CHECK_VOUCHER_PRINT_DOCUMENT_ROW_DOWN_OFFSET_IN = 0;
const CHECK_VOUCHER_PRINT_AMOUNT_OFFSET_IN = 0;
const CHECK_VOUCHER_PRINT_AMOUNT_LEFT_OFFSET_IN = 0;
const CHECK_VOUCHER_PRINT_CHECK_NUMBER_LEFT_OFFSET_IN = 0;
const CHECK_VOUCHER_PRINT_PAGE_ORIGIN_Y_IN = 0;
const CHECK_VOUCHER_SIGNATURE_TOP_IN = 5.32;

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
    () => (printProps ? buildCheckVoucherPdf(printProps, { originYIn: CHECK_VOUCHER_PRINT_PAGE_ORIGIN_Y_IN, calibration, alignmentTest }) : null),
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

  if (!printProps || !pdfArtifact) return null;

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
      buildGeneratedPdf={(sharedCalibration) => buildCheckVoucherPdf(printProps, { originYIn: CHECK_VOUCHER_PRINT_PAGE_ORIGIN_Y_IN, calibration: { xMm: sharedCalibration.page.xMm, yMm: sharedCalibration.page.yMm }, fieldOffsets: sharedCalibration.fields, alignmentTest })}
      buildGeneratedPrintPdf={(sharedCalibration) => buildCheckVoucherPdf(printProps, { originYIn: CHECK_VOUCHER_PRINT_PAGE_ORIGIN_Y_IN, calibration: { xMm: sharedCalibration.page.xMm, yMm: sharedCalibration.page.yMm }, fieldOffsets: sharedCalibration.fields, alignmentTest })}
      downloadExcel={() => downloadPrintWorkbook("CHECK VOUCHER", printProps, `${printProps.documentNo || "check-voucher"}.xlsx`)}
    >
      {missingVoucherFields.length > 0 ? (
        <div className="mx-auto mb-4 max-w-[8.5in] rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 print:hidden">
          <p className="font-medium text-slate-700">Some voucher details are still missing.</p>
          <p className="mt-1">
            Missing: {missingVoucherFields.join(", ")}. You can preview this now; complete these
            fields before using it as the final voucher.
          </p>
        </div>
      ) : null}
      <div className="mx-auto mb-4 flex max-w-[8.5in] justify-end print:hidden">
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50"
          disabled={confirmPrinted.isPending}
          onClick={() => confirmPrinted.mutate()}
        >
          {confirmPrinted.isPending ? "Saving..." : "Confirm printed / reprinted"}
        </button>
      </div>
      <GeneratedPdfPreview
        pdfArtifact={pdfArtifact}
        title="Check voucher PDF preview"
        pageSizeIn={CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_IN}
      />
    </PrintShell>
  );
}

async function buildCheckVoucherPdf({
  date,
  payee,
  particulars,
  amount,
  documentNo,
  checkNo,
  preparedBy,
}: CheckVoucherPrintProps, { originYIn = 0, calibration = { xMm: 0, yMm: 0 }, fieldOffsets = {}, alignmentTest = false }: { originYIn?: number; calibration?: { xMm: number; yMm: number }; fieldOffsets?: Record<string, CalibrationOffset>; alignmentTest?: boolean } = {}) {
  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF("l", "pt", [...CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_PT]);
  const draw = (args: Omit<Parameters<typeof drawPreprintedText>[1], "pageWidth" | "unit">) =>
    drawPreprintedText(pdf, {
      ...args,
      pageWidth: CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_PT[0],
      unit: "in",
    });
  const xOffsetIn = calibration.xMm / 25.4;
  const yOffsetIn = calibration.yMm / 25.4;

  if (alignmentTest) {
    draw({ text: "ALIGNMENT TEST - 100% / ACTUAL SIZE", top: 0.25 + yOffsetIn, left: 0.25 + xOffsetIn, width: 8, size: 9, align: "center" });
    draw({ text: "+  1 inch  +  2 inch  +  3 inch  +", top: 0.52 + yOffsetIn, left: 0.25 + xOffsetIn, width: 8, size: 8, align: "center" });
  }

  drawField({ text: date, field: CHECK_VOUCHER_FIELDS.date, fieldId: "date", extraTopIn: CHECK_VOUCHER_PRINT_DATE_OFFSET_IN });
  drawField({ text: payee, field: CHECK_VOUCHER_FIELDS.payee, fieldId: "payee", extraTopIn: CHECK_VOUCHER_PRINT_PAYEE_OFFSET_IN });
  drawField({ text: particulars, field: CHECK_VOUCHER_FIELDS.particulars, fieldId: "particulars", extraTopIn: CHECK_VOUCHER_PRINT_PARTICULARS_OFFSET_IN });
  drawField({ text: amount, field: CHECK_VOUCHER_FIELDS.amount1, fieldId: "amount", extraTopIn: CHECK_VOUCHER_PRINT_AMOUNT_OFFSET_IN, extraLeftIn: CHECK_VOUCHER_PRINT_AMOUNT_LEFT_OFFSET_IN });
  drawField({ text: amount, field: CHECK_VOUCHER_FIELDS.amount2, fieldId: "amount", extraTopIn: CHECK_VOUCHER_PRINT_AMOUNT_OFFSET_IN, extraLeftIn: CHECK_VOUCHER_PRINT_AMOUNT_LEFT_OFFSET_IN });
  drawField({
    text: documentNo,
    field: { ...CHECK_VOUCHER_FIELDS.documentNo, topIn: CHECK_VOUCHER_FIELDS.particulars.topIn }, fieldId: "documentNo",
    extraTopIn:
      CHECK_VOUCHER_PRINT_PARTICULARS_OFFSET_IN + CHECK_VOUCHER_PRINT_DOCUMENT_ROW_DOWN_OFFSET_IN,
  });
  drawField({
    text: checkNo,
    field: { ...CHECK_VOUCHER_FIELDS.checkNo, topIn: CHECK_VOUCHER_FIELDS.particulars.topIn }, fieldId: "checkNo",
    extraTopIn:
      CHECK_VOUCHER_PRINT_PARTICULARS_OFFSET_IN + CHECK_VOUCHER_PRINT_DOCUMENT_ROW_DOWN_OFFSET_IN,
    extraLeftIn: CHECK_VOUCHER_PRINT_CHECK_NUMBER_LEFT_OFFSET_IN,
  });
  drawSignatureBlocks(preparedBy);

  return pdf;

  function drawSignatureBlocks(preparedByName: string) {
    const top = originYIn + CHECK_VOUCHER_PRINT_PAGE_ORIGIN_Y_IN * -1 + CHECK_VOUCHER_SIGNATURE_TOP_IN;
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
      minSize: fieldId === "particulars" || fieldId === "payee" ? 8 : Math.max(9, field.fontSize - 2),
      fitToWidth: true,
      align,
      offset: resolveFieldOffset({ page: { xMm: calibration.xMm, yMm: calibration.yMm }, fields: fieldOffsets }, fieldId),
    });
  }
}
