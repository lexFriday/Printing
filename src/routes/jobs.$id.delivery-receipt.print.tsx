import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ArrowDown, FileText, Printer } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { PrintShell, usePrintCalibrationContext } from "@/components/print/PrintShell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { computeInclusiveVat } from "@/lib/calc";
import { fmtDate } from "@/lib/format";
import { addTemplateBackground, drawPreprintedText, fitPreprintedFontSize } from "@/lib/preprintedPdf";
import { generateDeliveryReceiptPdf } from "@/lib/physicalPrintPdf";
import { formatPrintMoney, formatPrintQty } from "@/lib/printFormat";
import {
  DEFAULT_PRINT_CALIBRATION,
  resolveFieldOffset,
  type PrintCalibration,
} from "@/lib/printCalibration";
import { COMPANY_PROFILE } from "@/lib/brand";

export const Route = createFileRoute("/jobs/$id/delivery-receipt/print")({
  head: () => ({ meta: [{ title: `Print delivery receipt - ${COMPANY_PROFILE.name}` }] }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { priced: boolean; includePo?: boolean } => ({
    priced:
      search.priced === true ||
      search.priced === "true" ||
      search.prices === true ||
      search.prices === "true",
    includePo:
      search.includePo !== false &&
      search.includePo !== "false" &&
      search.hidePo !== true &&
      search.hidePo !== "true",
  }),
  errorComponent: ({ error }) => (
    <PrintShell backTo="/jobs" backLabel="Back to jobs">
      <Alert variant="destructive">
        <AlertTitle>Unable to load delivery receipt</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : "Something went wrong while loading this delivery receipt."}
        </AlertDescription>
      </Alert>
    </PrintShell>
  ),
  component: DeliveryReceiptPrintPage,
});

type Customer = {
  customer_name: string;
  contact_person: string;
  contact_number: string;
  address: string | null;
  tin_number?: string | null;
};

type JobLine = {
  id: string;
  description: string;
  quantity: number;
  unit_of_measure: string | null;
  unit_price: number;
  line_total: number;
  sort_order: number | null;
};

const DR_LINE_LIMIT = 7;
const DELIVERY_RECEIPT_PDF_SIZE_PT = [396, 612];
const DELIVERY_RECEIPT_VERTICAL_OFFSET_IN = 0.06;
const DELIVERY_RECEIPT_LINE_VERTICAL_OFFSET_IN = 0.1;
const DR_NUMBER_TOP_IN = 1.54;
const DR_DATE_TOP_IN = 2.15;
const DR_CUSTOMER_TOP_IN = 2.15;
const DR_TIN_TOP_IN = 2.36;
const DR_ADDRESS_TOP_IN = 2.54;
const DR_TERMS_TOP_IN = 2.36;
const DR_PO_TOP_IN = 2.74;
const DR_DATE_LEFT_IN = 4.02;
const DR_TERMS_LEFT_IN = 4.02;
const DR_TERMS_WIDTH_IN = 1.4;
const DR_CUSTOMER_LEFT_IN = 0.84 + 0.3 / 2.54;
const DR_TIN_ADDRESS_LEFT_IN = 0.46;
const DR_AMOUNT_LEFT_IN = 4.18 + 0.5 / 2.54;
const DR_HEADER_SHIFT_IN = -1 / 2.54;
const DR_CUSTOMER_DELTA_IN = 0.3 / 2.54;
const DR_TERMS_DELTA_IN = 0.18 / 2.54;
const DR_TERMS_RIGHT_DELTA_IN = 0.05 / 2.54;
const DR_TIN_DELTA_IN = 0.38 / 2.54;
const DR_ADDRESS_DELTA_IN = 0.5 / 2.54;
const DR_PO_DELTA_IN = -0.108 / 2.54;
const DR_PO_RIGHT_DELTA_IN = 1 - 0.8 / 2.54;
const DR_NUMBER_TOP_CALIBRATED_IN = DR_NUMBER_TOP_IN + 0.2;

function formatDeliveryReceiptTerms(terms: string | null) {
  switch (terms?.trim().toLowerCase()) {
    case "50% downpayment, balance upon completion":
      return "50% DOWNPAYMENT";
    case "full payment upon completion":
      return "FULL PAYMENT";
    case "30 days after invoice":
      return "30 DAYS";
    case "cod":
      return "COD";
    default:
      return terms?.trim() || null;
  }
}

function DeliveryReceiptPrintPage() {
  const { id } = Route.useParams();
  const { priced, includePo: searchIncludePo } = Route.useSearch();
  const [includePo, setIncludePo] = useState<boolean>(searchIncludePo !== false);
  const nav = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) nav({ to: "/auth", replace: true });
  }, [loading, nav, user]);

  const job = useQuery({
    queryKey: ["delivery-receipt-print", id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_orders")
        .select(
          "*, customer:customers(*), quotation:quotations(quote_number, terms), lines:job_order_line_items(*)",
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  if (loading || job.isLoading) {
    return (
      <div className="min-h-screen bg-background p-6 text-sm text-muted-foreground">
        Loading delivery receipt...
      </div>
    );
  }

  if (job.isError || !job.data) {
    return (
      <PrintShell backTo="/jobs" backLabel="Back to jobs">
        <Alert variant="destructive">
          <AlertTitle>Job order not found.</AlertTitle>
          <AlertDescription>
            The job may have been deleted or you may not have permission to view it.
          </AlertDescription>
        </Alert>
      </PrintShell>
    );
  }

  const customer = job.data.customer as Customer | null;
  const printCustomer = customer
    ? {
        ...customer,
        contact_person: job.data.contact_name_snapshot ?? customer.contact_person,
        contact_number: job.data.contact_phone_snapshot ?? customer.contact_number,
      }
    : null;
  const lines = ((job.data.lines as JobLine[] | null) ?? []).sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  const printedLines = lines.slice(0, DR_LINE_LIMIT);
  const receiptDate = job.data.delivered_at ?? new Date();
  const lineSubtotal = lines.reduce((sum, line) => sum + Number(line.line_total || 0), 0);
  const totalAmount =
    job.data.tax_type === "vatable" ? computeInclusiveVat(lineSubtotal).grossTotal : lineSubtotal;
  const vatAmount = job.data.tax_type === "vatable" ? computeInclusiveVat(lineSubtotal).vat : 0;
  const displayLines =
    job.data.tax_type === "vatable"
      ? printedLines.map((line) => ({
          ...line,
          line_total: computeInclusiveVat(line.line_total).grossTotal,
        }))
      : printedLines;
  const quotation = job.data.quotation as { quote_number: string; terms: string | null } | null;
  const quoteNumber = quotation?.quote_number;
  const printProps = {
    customer: printCustomer,
    receiptDate,
    projectName: job.data.project_name,
    jobNumber: job.data.job_number,
    quoteNumber,
    terms: formatDeliveryReceiptTerms(quotation?.terms ?? null),
    drNumber: job.data.dr_number,
    clientPoNumber: job.data.client_po_number,
    includePo,
    priced,
    lines: displayLines,
    lineSubtotal,
    vatAmount,
    totalAmount,
  } satisfies DeliveryReceiptFormProps;

  return (
    <PrintShell
      backTo="/jobs/$id"
      backParams={{ id }}
      backLabel="Back to job"
      pdfFileName={`${job.data.job_number}-delivery-receipt.pdf`}
      calibrationDocument="delivery-receipt"
      pdfPageSize={DELIVERY_RECEIPT_PDF_SIZE_PT}
      pageCssSize="5.5in 8.5in"
      printWithGeneratedPdf
      buildGeneratedPdf={(calibration) =>
        generateDeliveryReceiptPdf(
          {
            ...job.data,
            ...printProps,
            customer: printCustomer,
            quotation,
            lines: displayLines,
            priced,
            includePo,
          },
          undefined,
          "standard",
          "/templates/delivery-receipt-template.jpg",
          calibration,
        )
      }
      buildGeneratedPrintPdf={(calibration) =>
        generateDeliveryReceiptPdf(
          {
            ...job.data,
            ...printProps,
            customer: printCustomer,
            quotation,
            lines: displayLines,
            priced,
            includePo,
          },
          undefined,
          "standard",
          "/templates/delivery-receipt-template.jpg",
          calibration,
        )
      }
      directPrintJob={{
        identifier: id,
        label: job.data.job_number,
        jobData: { ...job.data, customer: printCustomer, quotation, lines: displayLines, priced, includePo },
      }}
      hideDownloadPdf={false}
      hideDownloadExcel={true}
    >
      <div className="mx-auto w-full max-w-[8.5in] space-y-5 print:hidden">
        <DeliveryReceiptDetailsCard
          printProps={printProps}
          includePo={includePo}
          onToggleIncludePo={setIncludePo}
        />
        <DeliveryReceiptInsertionGuide printProps={printProps} />
      </div>

      <div className="hidden print:block">
        <h1 className="sr-only">Delivery Receipt{priced ? " - Priced" : ""}</h1>
        {job.data.tax_type !== "vatable" ? <p className="sr-only">Non-VAT</p> : null}
        <DeliveryReceiptForm {...printProps} />
      </div>
    </PrintShell>
  );
}

function DeliveryReceiptDetailsCard({
  printProps,
  includePo,
  onToggleIncludePo,
}: {
  printProps: DeliveryReceiptFormProps;
  includePo: boolean;
  onToggleIncludePo: (val: boolean) => void;
}) {
  const poValueToPrint = printProps.clientPoNumber || printProps.quoteNumber;

  return (
    <div className="rounded-xl border bg-white p-5 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm text-slate-900">Delivery Receipt Details</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 border text-slate-800">
            {printProps.drNumber ? `DR #${printProps.drNumber}` : "DR # (Not Set)"}
          </span>
          <span className="font-mono text-xs text-muted-foreground px-2 py-1 rounded-md bg-slate-50 border">
            Job #{printProps.jobNumber}
          </span>
        </div>
      </div>

      {/* P.O. Number Print Toggle */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-900">Include P.O. Number on DR</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide border ${
                includePo
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-slate-100 text-slate-600 border-slate-200"
              }`}
            >
              {includePo ? "Will Print" : "Hidden"}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {includePo
              ? `Prints "${poValueToPrint || "—"}" on the pre-printed P.O. No. field.`
              : "Leaves the pre-printed P.O. No. field blank on the delivery receipt."}
          </p>
        </div>
        <div className="flex items-center gap-2.5 self-end sm:self-auto">
          <span className="text-xs font-medium text-slate-600">
            {includePo ? "Include P.O." : "Hide P.O."}
          </span>
          <Switch
            id="toggle-dr-po"
            checked={includePo}
            onCheckedChange={onToggleIncludePo}
            aria-label="Toggle P.O. Number print visibility"
          />
        </div>
      </div>

      {/* Delivered To & Receipt Info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg bg-slate-50/70 border p-3.5 text-xs">
        <div className="space-y-1">
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block">
            Delivered To
          </span>
          <div className="font-bold text-slate-900 text-sm">
            {printProps.customer?.customer_name || "Customer"}
          </div>
          {printProps.customer?.tin_number ? (
            <div className="text-[11px] text-muted-foreground font-mono">
              TIN: {printProps.customer.tin_number}
            </div>
          ) : null}
          {printProps.customer?.address ? (
            <div className="text-[11px] text-muted-foreground leading-snug">
              {printProps.customer.address}
            </div>
          ) : null}
          {printProps.customer?.contact_person ? (
            <div className="text-[11px] text-slate-600 pt-0.5">
              Contact: {printProps.customer.contact_person}
              {printProps.customer?.contact_number ? ` (${printProps.customer.contact_number})` : ""}
            </div>
          ) : null}
        </div>

        <div className="space-y-1 sm:text-right">
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block">
            Receipt Details
          </span>
          <div className="text-xs text-slate-800">
            Date: <span className="font-semibold text-slate-900">{fmtDate(printProps.receiptDate)}</span>
          </div>
          {printProps.clientPoNumber ? (
            <div className="text-[11px] text-muted-foreground">
              Client PO #:{" "}
              <span
                className={`font-semibold font-mono ${
                  includePo ? "text-slate-800" : "line-through text-slate-400"
                }`}
              >
                {printProps.clientPoNumber}
              </span>
              {!includePo ? (
                <span className="ml-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                  Hidden in print
                </span>
              ) : null}
            </div>
          ) : null}
          {printProps.quoteNumber ? (
            <div className="text-[11px] text-muted-foreground">
              Quote #:{" "}
              <span
                className={`font-semibold font-mono ${
                  includePo || printProps.clientPoNumber ? "text-slate-800" : "line-through text-slate-400"
                }`}
              >
                {printProps.quoteNumber}
              </span>
              {!includePo && !printProps.clientPoNumber ? (
                <span className="ml-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                  Hidden in print
                </span>
              ) : null}
            </div>
          ) : null}
          {printProps.terms ? (
            <div className="text-[11px] text-muted-foreground">
              Terms: <span className="font-medium text-slate-800">{printProps.terms}</span>
            </div>
          ) : null}
          {printProps.projectName ? (
            <div className="text-[11px] text-slate-600 truncate max-w-xs sm:ml-auto" title={printProps.projectName}>
              Project: <span className="font-medium text-slate-800">{printProps.projectName}</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Line Items Table */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block">
            Line Items ({printProps.lines.length})
          </span>
          <span className="text-[11px] text-muted-foreground">
            {printProps.priced ? "Priced Delivery Receipt" : "Standard Delivery Receipt"}
          </span>
        </div>
        <div className="rounded-lg border bg-slate-50/50 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-[11px] uppercase font-semibold text-slate-600 border-b">
              <tr>
                <th className="py-2 px-3 w-16 text-center">Qty</th>
                <th className="py-2 px-3">Description</th>
                {printProps.priced ? (
                  <>
                    <th className="py-2 px-3 text-right w-28">Unit Price</th>
                    <th className="py-2 px-3 text-right w-32">Total</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 font-mono">
              {printProps.lines.map((line, idx) => (
                <tr key={line.id || idx} className="hover:bg-slate-100/50">
                  <td className="py-2 px-3 text-center font-bold text-slate-900 tabular-nums">
                    {formatPrintQty(line.quantity)}
                  </td>
                  <td className="py-2 px-3 font-sans text-slate-800">
                    {line.description}
                  </td>
                  {printProps.priced ? (
                    <>
                      <td className="py-2 px-3 text-right text-slate-600 tabular-nums whitespace-nowrap">
                        ₱{formatPrintMoney(line.unit_price)}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        ₱{formatPrintMoney(line.line_total)}
                      </td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Financial Summary */}
      {printProps.priced ? (
        <div className="pt-3 border-t flex flex-col items-end gap-1.5 text-xs font-mono">
          <div className="flex justify-between w-64 text-slate-600">
            <span>Subtotal:</span>
            <span className="tabular-nums">₱{formatPrintMoney(printProps.lineSubtotal)}</span>
          </div>
          {printProps.vatAmount > 0 ? (
            <div className="flex justify-between w-64 text-slate-600">
              <span>VAT (12%):</span>
              <span className="tabular-nums">₱{formatPrintMoney(printProps.vatAmount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between w-64 text-sm font-bold text-slate-900 pt-1.5 border-t">
            <span>Total:</span>
            <span className="text-primary font-bold tabular-nums">₱{formatPrintMoney(printProps.totalAmount)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DeliveryReceiptInsertionGuide({ printProps }: { printProps?: DeliveryReceiptFormProps }) {
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
          {isL121 ? "Epson L121 Right-Load (5.5\" × 8.5\")" : "5.5\" × 8.5\" Portrait Feed"}
        </span>
      </div>

      {/* Grid with Diagram on Left, Step Instructions on Right */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
        {/* Visual Delivery Receipt & Printer Feed Slot Representation */}
        <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50/70 p-4">
          {/* Delivery Receipt Visual Representation */}
          <div className="w-[190px] h-[230px] rounded-sm border-2 border-dashed border-emerald-500 bg-white p-2 shadow-sm flex flex-col justify-between text-[9px] relative overflow-hidden">
            {/* Top / Trailing Edge */}
            <div className="border-b border-slate-200 pb-1 text-center text-[7.5px] font-semibold text-slate-500 bg-slate-50 -mx-2 -mt-2 pt-1">
              Trailing Edge (Signatures &amp; Received By)
            </div>

            {/* Form Body Illustration */}
            <div className="space-y-1.5 py-1 text-slate-600 font-mono text-[8px] bg-slate-50/50 p-1.5 rounded border border-slate-100 flex-1 flex flex-col justify-between my-1">
              <div>
                <div className="flex justify-between text-slate-500 text-[7px] border-b pb-0.5">
                  <span className="font-bold truncate max-w-[100px]">{printProps?.customer?.customer_name || "CUSTOMER"}</span>
                  <span>{printProps?.drNumber ? `DR #${printProps.drNumber}` : "DR #"}</span>
                </div>
                <div className="pt-1 text-[7.5px] text-slate-700 font-sans font-medium line-clamp-2">
                  {printProps?.lines?.[0]?.description || "DELIVERY ITEMS & PACKAGES"}
                </div>
              </div>
              <div className="border-t pt-1 flex justify-between items-center text-[7px] text-slate-500">
                <span>ITEMS: {printProps?.lines?.length || 1}</span>
                <span className="font-bold text-slate-700">{printProps?.priced && printProps?.totalAmount ? `₱${formatPrintMoney(printProps.totalAmount)}` : "OFFICIAL DR"}</span>
              </div>
            </div>

            {/* Font Orientation indicator */}
            <div className="text-center text-[7.5px] font-bold text-emerald-700 bg-emerald-50 py-0.5 border-y border-emerald-100 -mx-2">
              Font Orientation: Upright (Reads Top to Bottom)
            </div>

            {/* Bottom / Leading Edge Badge (Top of Paper Enters First) */}
            <div className="bg-emerald-600 text-white font-bold text-[8.5px] py-1 px-1 rounded-xs text-center tracking-tight leading-tight -mx-2 -mb-2">
              ▼ TOP OF PAPER (Enters First) ▼
              <div className="text-[7px] font-sans font-semibold pt-0.5 opacity-95">
                DELIVERY RECEIPT HEADER
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
            {isL121 ? (
              <>
                <span className="text-slate-400 font-bold">◄ Slide Left Guide</span>
                <span className="text-blue-300 font-bold">5.5&quot; Slot</span>
                <span className="text-amber-400 font-bold">Fixed Right Guide ▮</span>
              </>
            ) : (
              <>
                <span className="text-slate-400 font-bold">◄ Left Guide</span>
                <span className="text-emerald-300 font-bold">5.5&quot; Guide Feeder Slot</span>
                <span className="text-slate-400 font-bold">Right Guide ►</span>
              </>
            )}
          </div>
        </div>

        {/* Step-by-Step Instructions */}
        <div className="space-y-3 text-xs text-slate-700">
          <div className="flex items-start gap-3">
            <div className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
              1
            </div>
            <div>
              <p className="font-semibold text-slate-900 text-xs">
                {isL121 ? "Align Against Fixed Right Guide" : "Set 5.5\" Guides on Feeder Slot Below"}
              </p>
              <p className="text-[11px] text-slate-600 leading-snug">
                {isL121
                  ? "Load receipt flush against the fixed right guide, then slide the left guide snugly to 5.5\" width."
                  : "Snug the feeder guide rails to 5.5\" width to hold the delivery receipt straight in center."}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
              2
            </div>
            <div>
              <p className="font-semibold text-slate-900 text-xs">Top of Paper First (Insert Downward)</p>
              <p className="text-[11px] text-slate-600 leading-snug">
                Insert the top edge (where &quot;DELIVERY RECEIPT&quot; is printed) downward into the feed slot first.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
              3
            </div>
            <div>
              <p className="font-semibold text-slate-900 text-xs">Face Up (Font Reads Upright)</p>
              <p className="text-[11px] text-slate-600 leading-snug">
                Insert paper with the printed delivery receipt lines facing toward you.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
              4
            </div>
            <div>
              <p className="font-semibold text-slate-900 text-xs">Slide Downward Until Seated</p>
              <p className="text-[11px] text-slate-600 leading-snug">
                Gently push the top edge down into the 5.5&quot; feeder slot at the bottom until engaged.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type DeliveryReceiptFormProps = {
  calibration?: PrintCalibration;
  customer: Customer | null;
  receiptDate: string | Date;
  projectName: string;
  jobNumber: string;
  quoteNumber: string | null | undefined;
  terms: string | null;
  drNumber: string | null;
  clientPoNumber: string | null;
  includePo?: boolean;
  priced: boolean;
  lines: JobLine[];
  lineSubtotal: number;
  vatAmount: number;
  totalAmount: number;
};

async function buildDeliveryReceiptPdf({
  customer,
  receiptDate,
  jobNumber,
  quoteNumber,
  terms,
  drNumber,
  clientPoNumber,
  includePo = true,
  priced,
  lines,
  lineSubtotal,
  vatAmount,
  totalAmount,
  calibration,
}: DeliveryReceiptFormProps) {
  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF("p", "pt", DELIVERY_RECEIPT_PDF_SIZE_PT);
  const pageWidth = DELIVERY_RECEIPT_PDF_SIZE_PT[0];
  const pageHeight = DELIVERY_RECEIPT_PDF_SIZE_PT[1];
  await addTemplateBackground(pdf, "/templates/delivery-receipt-template.jpg", pageWidth, pageHeight);
  const draw = (
    args: Omit<Parameters<typeof drawPreprintedText>[1], "pageWidth" | "unit">,
    field?: string,
  ) =>
    drawPreprintedText(pdf, {
      ...args,
      offset: field
        ? resolveFieldOffset(calibration ?? DEFAULT_PRINT_CALIBRATION, field)
        : (calibration ?? DEFAULT_PRINT_CALIBRATION).page,
      pageWidth,
      unit: "in",
    });

  draw(
    {
      text: terms,
      top: drTopValue(DR_TERMS_TOP_IN + DR_HEADER_SHIFT_IN + DR_TERMS_DELTA_IN),
      left: DR_TERMS_LEFT_IN + DR_TERMS_RIGHT_DELTA_IN - (DR_TERMS_WIDTH_IN - 1.1),
      width: DR_TERMS_WIDTH_IN,
      align: "right",
      size: 8,
    },
    "terms",
  );
  draw(
    {
      text: fmtDate(receiptDate),
      top: drTopValue(DR_DATE_TOP_IN + DR_HEADER_SHIFT_IN),
      left: DR_DATE_LEFT_IN,
      width: 1.1,
      align: "right",
    },
    "date",
  );
  draw(
    {
      text: customer?.customer_name,
      top: drTopValue(DR_CUSTOMER_TOP_IN + DR_HEADER_SHIFT_IN + DR_CUSTOMER_DELTA_IN),
      left: DR_CUSTOMER_LEFT_IN,
      width: 2.27,
    },
    "customerName",
  );
  draw(
    {
      text: customer?.tin_number,
      top: drTopValue(DR_TIN_TOP_IN + DR_HEADER_SHIFT_IN + DR_TIN_DELTA_IN),
      left: DR_TIN_ADDRESS_LEFT_IN,
      width: 2.65,
    },
    "tin",
  );
  draw(
    {
      text: customer?.address,
      top: drTopValue(DR_ADDRESS_TOP_IN + DR_HEADER_SHIFT_IN + DR_ADDRESS_DELTA_IN),
      left: DR_TIN_ADDRESS_LEFT_IN,
      width: 2.65,
      size: 8,
    },
    "address",
  );
  if (includePo) {
    draw(
      {
        text: quoteNumber || clientPoNumber,
        top: drTopValue(DR_PO_TOP_IN + DR_HEADER_SHIFT_IN + DR_PO_DELTA_IN),
        left: 3.52 + DR_PO_RIGHT_DELTA_IN,
        width: 1.1,
        align: "right",
      },
      "poNumber",
    );
  }

  lines.forEach((line, index) => {
    const top = drLineTopValue(3.52 + index * 0.48);
    draw(
      { text: formatPrintQty(line.quantity), top, left: 0.43, width: 0.38, align: "center" },
      "lineQuantity",
    );
    draw(
      {
        text: (line.unit_of_measure ?? "PCS").toUpperCase(),
        top,
        left: 0.93,
        width: 0.48,
        align: "center",
      },
      "lineUnit",
    );
    draw(
      {
        text: line.description,
        top,
        left: 1.55,
        width: 2.45,
        size: 8,
        minSize: 6,
        fitToWidth: true,
      },
      "lineDescription",
    );
    if (priced) {
      draw(
        {
          text: formatPrintMoney(line.line_total),
          top,
          left: DR_AMOUNT_LEFT_IN,
          width: 0.82,
          align: "right",
        },
        "lineAmount",
      );
      draw(
        {
          text: formatPrintMoney(line.unit_price),
          top,
          left: 3.45,
          width: 0.62,
          align: "right",
        },
        "lineUnitPrice",
      );
    }
  });

  if (priced) {
    draw(
      {
        text: "SUBTOTAL",
        top: drLineTopValue(6.58),
        left: 3.08,
        width: 1.1,
        align: "right",
        size: 8,
      },
      "subtotal",
    );
    draw(
      {
        text: formatPrintMoney(lineSubtotal),
        top: drLineTopValue(6.58),
        left: DR_AMOUNT_LEFT_IN,
        width: 0.82,
        align: "right",
      },
      "subtotal",
    );
    draw(
      {
        text: formatPrintMoney(vatAmount),
        top: drLineTopValue(6.82),
        left: DR_AMOUNT_LEFT_IN,
        width: 0.82,
        align: "right",
      },
      "vat",
    );
    draw(
      {
        text: formatPrintMoney(totalAmount),
        top: drLineTopValue(7.06),
        left: DR_AMOUNT_LEFT_IN,
        width: 0.82,
        align: "right",
      },
      "total",
    );
  }

  return pdf;
}

function DeliveryReceiptForm({
  customer,
  receiptDate,
  jobNumber,
  quoteNumber,
  terms,
  drNumber,
  clientPoNumber,
  includePo = true,
  priced,
  lines,
  lineSubtotal,
  vatAmount,
  totalAmount,
}: DeliveryReceiptFormProps) {
  return (
    <article className="print-document relative mx-auto h-[8.5in] w-[5.5in] bg-white text-[9px] font-semibold leading-tight text-black shadow-sm">
      <OverlayValue
        top={drTop(DR_DATE_TOP_IN + DR_HEADER_SHIFT_IN)}
        left={`${DR_DATE_LEFT_IN}in`}
        width="1.1in"
        align="right"
      >
        {fmtDate(receiptDate)}
      </OverlayValue>
      <OverlayValue
        top={drTop(DR_CUSTOMER_TOP_IN + DR_HEADER_SHIFT_IN + DR_CUSTOMER_DELTA_IN)}
        left={`${DR_CUSTOMER_LEFT_IN}in`}
        width="2.27in"
      >
        {customer?.customer_name ?? "Customer"}
      </OverlayValue>
      <OverlayValue
        top={drTop(DR_TIN_TOP_IN + DR_HEADER_SHIFT_IN + DR_TIN_DELTA_IN)}
        left={`${DR_TIN_ADDRESS_LEFT_IN}in`}
        width="2.65in"
      >
        {customer?.tin_number ?? ""}
      </OverlayValue>
      <OverlayValue
        top={drTop(DR_TERMS_TOP_IN + DR_HEADER_SHIFT_IN + DR_TERMS_DELTA_IN)}
        left={`${DR_TERMS_LEFT_IN + DR_TERMS_RIGHT_DELTA_IN - (DR_TERMS_WIDTH_IN - 1.1)}in`}
        width={`${DR_TERMS_WIDTH_IN}in`}
        align="right"
        size="8px"
      >
        {terms ?? ""}
      </OverlayValue>
      <OverlayValue
        top={drTop(DR_ADDRESS_TOP_IN + DR_HEADER_SHIFT_IN + DR_ADDRESS_DELTA_IN)}
        left={`${DR_TIN_ADDRESS_LEFT_IN}in`}
        width="2.65in"
        size="8px"
      >
        {customer?.address ?? ""}
      </OverlayValue>
      {includePo ? (
        <OverlayValue
          top={drTop(DR_PO_TOP_IN + DR_HEADER_SHIFT_IN + DR_PO_DELTA_IN)}
          left={`${3.52 + DR_PO_RIGHT_DELTA_IN}in`}
          width="1.1in"
          align="right"
        >
          {quoteNumber || clientPoNumber || ""}
        </OverlayValue>
      ) : null}

      {lines.map((line, index) => (
        <div key={line.id}>
          <OverlayValue
            top={drLineTop(3.52 + index * 0.48)}
            left="0.43in"
            width="0.38in"
            align="center"
          >
            {formatPrintQty(line.quantity)}
          </OverlayValue>
          <OverlayValue
            top={drLineTop(3.52 + index * 0.48)}
            left="0.93in"
            width="0.48in"
            align="center"
          >
            {(line.unit_of_measure ?? "PCS").toUpperCase()}
          </OverlayValue>
          <OverlayValue
            top={drLineTop(3.52 + index * 0.48)}
            left="1.55in"
            width="1.82in"
            size="8px"
            minSize="6px"
            fitDescription
          >
            {line.description}
          </OverlayValue>
          {priced ? (
            <>
              <OverlayValue
                top={drLineTop(3.52 + index * 0.48)}
                left="3.45in"
                width="0.62in"
                align="right"
              >
                {formatPrintMoney(line.unit_price)}
              </OverlayValue>
              <OverlayValue
                top={drLineTop(3.52 + index * 0.48)}
                left={`${DR_AMOUNT_LEFT_IN}in`}
                width="0.82in"
                align="right"
              >
                {formatPrintMoney(line.line_total)}
              </OverlayValue>
            </>
          ) : null}
        </div>
      ))}

      {priced ? (
        <>
          <OverlayValue top={drLineTop(6.58)} left="3.08in" width="1.1in" align="right" size="8px">
            SUBTOTAL
          </OverlayValue>
          <OverlayValue
            top={drLineTop(6.58)}
            left={`${DR_AMOUNT_LEFT_IN}in`}
            width="0.82in"
            align="right"
          >
            {formatPrintMoney(lineSubtotal)}
          </OverlayValue>
          <OverlayValue
            top={drLineTop(6.82)}
            left={`${DR_AMOUNT_LEFT_IN}in`}
            width="0.82in"
            align="right"
          >
            {formatPrintMoney(vatAmount)}
          </OverlayValue>
          <OverlayValue
            top={drLineTop(7.06)}
            left={`${DR_AMOUNT_LEFT_IN}in`}
            width="0.82in"
            align="right"
          >
            {formatPrintMoney(totalAmount)}
          </OverlayValue>
        </>
      ) : null}
    </article>
  );
}

function drTop(value: number) {
  return `${drTopValue(value)}in`;
}

function drLineTop(value: number) {
  return `${drLineTopValue(value)}in`;
}

function drTopValue(value: number) {
  return value + DELIVERY_RECEIPT_VERTICAL_OFFSET_IN;
}

function drLineTopValue(value: number) {
  return value + DELIVERY_RECEIPT_VERTICAL_OFFSET_IN + DELIVERY_RECEIPT_LINE_VERTICAL_OFFSET_IN;
}

function OverlayValue({
  children,
  top,
  left,
  right,
  width,
  align = "left",
  size = "9px",
  minSize,
  fitDescription = false,
}: {
  children: ReactNode;
  top: string;
  left?: string;
  right?: string;
  width: string;
  align?: "left" | "right" | "center";
  size?: string;
  minSize?: string;
  fitDescription?: boolean;
}) {
  const fontSize = fitDescription
    ? `${fitPreprintedFontSize(
        String(children ?? ""),
        2.45 * 96,
        Number.parseFloat(size),
        Number.parseFloat(minSize ?? size),
      )}px`
    : size;
  return (
    <div
      className="absolute overflow-hidden whitespace-nowrap uppercase tabular-nums"
      style={{ top, left, right, width, textAlign: align, fontSize }}
    >
      {children}
    </div>
  );
}
