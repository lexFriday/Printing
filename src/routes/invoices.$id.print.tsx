import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { jsPDF as JsPDF } from "jspdf";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowDown, FileText, Printer } from "lucide-react";
import { PrintShell as BasePrintShell, usePrintCalibrationContext } from "@/components/print/PrintShell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/lib/format";
import { drawPreprintedText } from "@/lib/preprintedPdf";
import { formatPrintMoney, formatPrintQty } from "@/lib/printFormat";
import {
  DEFAULT_PRINT_CALIBRATION,
  resolveFieldOffset,
  type PrintCalibration,
} from "@/lib/printCalibration";
import { COMPANY_PROFILE } from "@/lib/brand";

export const Route = createFileRoute("/invoices/$id/print")({
  head: () => ({ meta: [{ title: `Print invoice - ${COMPANY_PROFILE.name}` }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    includeEwt: search.includeEwt === true || search.includeEwt === "true",
    ewtRate: Number(search.ewtRate ?? 0.02),
  }),
  errorComponent: ({ error }) => (
    <BasePrintShell backTo="/invoices" backLabel="Back to invoices">
      <Alert variant="destructive">
        <AlertTitle>Unable to load invoice</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : "Something went wrong while loading this invoice."}
        </AlertDescription>
      </Alert>
    </BasePrintShell>
  ),
  component: PrintInvoicePage,
});

type Customer = {
  customer_name: string;
  contact_person: string;
  contact_number: string;
  email: string | null;
  address: string | null;
  tin_number?: string | null;
};

type InvoiceLine = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  sort_order: number | null;
};

type InvoiceJob = {
  client_po_number: string | null;
};

const SERVICE_INVOICE_LINE_LIMIT = 6;
const SERVICE_INVOICE_PDF_SIZE_PT = [425.2, 566.93];

// Ruler Measurements for 15cm x 20cm pre-printed Service Invoice (shifted up ~1.2mm to center in boxes):
// Date: 3.75 cm
const SI_DATE_TOP_CM = 3.75;
// SOLD TO: 4.22 cm
const SI_SOLD_TO_TOP_CM = 4.22;
// Registered Name: 4.86 cm
const SI_REGISTERED_NAME_TOP_CM = 4.86;
// TIN: 5.33 cm
const SI_TIN_TOP_CM = 5.33;
// Business Address: 5.97 cm
const SI_ADDRESS_TOP_CM = 5.97;

// Item table starts at 7.09 cm (centered within row box)
const SI_ITEMS_START_TOP_CM = 7.09;
// Totals summary table starts at 13.75 cm (centered within totals box)
const SI_TOTALS_START_TOP_CM = 13.75;

// Uniform row pitch for pre-printed carbonless form:
// 1/5 inch = 5.08 mm = 0.508 cm (~5mm per row)
const SI_ROW_STEP_CM = 0.508;

function getSiRowOffsetCm(rowIndex: number): number {
  if (rowIndex <= 0) return 0;
  return rowIndex * SI_ROW_STEP_CM;
}

function siItemTopCm(index: number): number {
  return SI_ITEMS_START_TOP_CM + index * SI_ROW_STEP_CM;
}

function siTotalsTopCm(index: number): number {
  return SI_TOTALS_START_TOP_CM + index * SI_ROW_STEP_CM;
}

function PrintInvoicePage() {
  const { id } = Route.useParams();
  const { includeEwt, ewtRate } = Route.useSearch();
  const nav = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) nav({ to: "/auth", replace: true });
  }, [loading, nav, user]);

  const invoice = useQuery({
    queryKey: ["invoice-print", id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select(
          "*, customer:customers(*), job:job_orders(client_po_number), lines:invoice_line_items(*)",
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  if (loading || (!user && !invoice.isError)) {
    return (
      <div className="min-h-screen bg-background p-6 text-sm text-muted-foreground">
        Loading invoice...
      </div>
    );
  }

  if (invoice.isLoading) {
    return (
      <div className="min-h-screen bg-background p-6 text-sm text-muted-foreground">
        Loading invoice...
      </div>
    );
  }

  if (invoice.isError || !invoice.data) {
    return (
      <PrintShell>
        <Alert variant="destructive">
          <AlertTitle>Invoice not found.</AlertTitle>
          <AlertDescription>
            The invoice may have been deleted or you may not have permission to view it.
          </AlertDescription>
        </Alert>
      </PrintShell>
    );
  }

  const customer = invoice.data.customer as Customer | null;
  const printCustomer = customer
    ? {
        ...customer,
        contact_person: invoice.data.contact_name_snapshot ?? customer.contact_person,
        contact_number: invoice.data.contact_phone_snapshot ?? customer.contact_number,
        email: invoice.data.contact_email_snapshot ?? customer.email,
      }
    : null;
  const lines = ((invoice.data.lines as InvoiceLine[] | null) ?? []).sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  const printedLines = lines.slice(0, SERVICE_INVOICE_LINE_LIMIT);
  const hiddenLineCount = lines.length - printedLines.length;
  const job = invoice.data.job as InvoiceJob | null;

  const isVatable = invoice.data.tax_type === "vatable";
  const printableGrossTotal = Number(
    invoice.data.gross_total_snapshot ?? invoice.data.invoice_amount ?? 0,
  );
  const rawVatableSales = Number(invoice.data.vatable_sales_snapshot ?? 0);
  const effectiveVatableSales =
    rawVatableSales > 0
      ? rawVatableSales
      : isVatable
        ? Math.round((printableGrossTotal / 1.12) * 100) / 100
        : printableGrossTotal;
  const rawVatAmount = Number(invoice.data.vat_amount_snapshot ?? 0);
  const effectiveVatAmount =
    rawVatAmount > 0
      ? rawVatAmount
      : isVatable
        ? Math.round((printableGrossTotal - effectiveVatableSales) * 100) / 100
        : 0;
  const activeEwtRate = ewtRate > 0 ? ewtRate : 0.02;
  const rawEwtAmount = Number(invoice.data.ewt_amount_snapshot ?? 0);
  const computedEwtAmount = includeEwt
    ? rawEwtAmount > 0
      ? rawEwtAmount
      : Math.round(effectiveVatableSales * activeEwtRate * 100) / 100
    : 0;
  const activeShowEwt = includeEwt && computedEwtAmount > 0;
  const computedAmountDue = activeShowEwt
    ? Math.max(printableGrossTotal - computedEwtAmount, 0)
    : Number(invoice.data.amount_due_snapshot ?? printableGrossTotal);

  const printProps = {
    customer: printCustomer,
    invoiceNumber: invoice.data.invoice_number,
    clientPoNumber: job?.client_po_number ?? null,
    invoiceDate: invoice.data.invoice_date,
    invoiceAmount: invoice.data.invoice_amount,
    vatableSales: effectiveVatableSales,
    vatAmount: effectiveVatAmount,
    ewtEnabled: activeShowEwt,
    ewtAmount: computedEwtAmount,
    grossTotal: printableGrossTotal,
    ewtTreatment:
      invoice.data.ewt_treatment_snapshot === "deducted_from_amount_due"
        ? "deducted_from_amount_due"
        : "reference_only",
    amountDue: computedAmountDue,
    taxType: invoice.data.tax_type ?? "non_vat",
    lines: printedLines,
    includeEwt,
    ewtRate: activeEwtRate,
  } satisfies ServiceInvoiceFormProps;

  if (lines.length === 0) {
    return (
      <PrintShell invoiceId={id}>
        <Alert>
          <AlertTitle>This invoice has no line items.</AlertTitle>
          <AlertDescription>
            Invoice printouts require at least one invoice line item.
          </AlertDescription>
        </Alert>
      </PrintShell>
    );
  }

  return (
    <PrintShell
      invoiceId={id}
      pdfFileName={`${invoice.data.invoice_number}-invoice.pdf`}
      buildGeneratedPdf={(calibration) => buildServiceInvoicePdf({ ...printProps, calibration })}
      directPrintJob={{
        identifier: id,
        label: invoice.data.invoice_number,
        jobData: {
          documentType: "service-invoice",
          invoiceNumber: invoice.data.invoice_number,
          invoiceDate: invoice.data.invoice_date,
          customer: printCustomer,
          clientPoNumber: job?.client_po_number ?? null,
          lines: printedLines,
          invoiceAmount: invoice.data.invoice_amount,
          vatableSales: effectiveVatableSales,
          vatAmount: effectiveVatAmount,
          grossTotal: printableGrossTotal,
          amountDue: computedAmountDue,
          ewtEnabled: activeShowEwt,
          ewtAmount: computedEwtAmount,
          ewtTreatment: invoice.data.ewt_treatment_snapshot,
          taxType: invoice.data.tax_type ?? "non_vat",
          includeEwt: activeShowEwt,
          ewtRate: activeEwtRate,
        },
      }}
    >
      {hiddenLineCount > 0 ? (
        <Alert className="print:hidden mx-auto mb-3 max-w-[8.5in] border-amber-300 bg-amber-50 text-amber-950">
          <AlertTitle>Some line items will not fit this official form.</AlertTitle>
          <AlertDescription>
            This print layout fits {SERVICE_INVOICE_LINE_LIMIT} rows. {hiddenLineCount} more line
            item{hiddenLineCount === 1 ? "" : "s"} will not print on this page.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mx-auto w-full max-w-[8.5in] space-y-5 print:hidden">
        <ServiceInvoiceDetailsCard printProps={printProps} />
        <ServiceInvoiceInsertionGuide printProps={printProps} />
      </div>

      <div className="hidden print:block">
        <ServiceInvoiceForm {...printProps} />
      </div>
    </PrintShell>
  );
}

function ServiceInvoiceDetailsCard({
  printProps,
}: {
  printProps: ServiceInvoiceFormProps;
}) {
  const isVatable = printProps.taxType === "vatable";
  const printableGrossTotal = printProps.grossTotal || printProps.invoiceAmount;
  const printableAmountDue = printProps.amountDue || printableGrossTotal;
  const printEwtAmount = printProps.includeEwt
    ? printProps.ewtAmount > 0
      ? printProps.ewtAmount
      : printProps.vatableSales * (printProps.ewtRate > 0 ? printProps.ewtRate : 0.02)
    : 0;
  const showEwt = printProps.includeEwt && printEwtAmount > 0;
  const finalAmount = showEwt
    ? Math.max(printableGrossTotal - printEwtAmount, 0)
    : printableAmountDue;

  return (
    <div className="rounded-xl border bg-white p-5 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm text-slate-900">Service Invoice Details</span>
        </div>
        <span className="font-mono text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 border text-slate-800">
          Invoice #{printProps.invoiceNumber}
        </span>
      </div>

      {/* Sold To & Invoice Details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg bg-slate-50/70 border p-3.5 text-xs">
        <div className="space-y-1">
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block">
            Sold To
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
        </div>

        <div className="space-y-1 sm:text-right">
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block">
            Invoice Details
          </span>
          <div className="text-xs text-slate-800">
            Date: <span className="font-semibold text-slate-900">{fmtDate(printProps.invoiceDate)}</span>
          </div>
          {printProps.clientPoNumber ? (
            <div className="text-[11px] text-muted-foreground">
              Client PO #: <span className="font-semibold font-mono text-slate-800">{printProps.clientPoNumber}</span>
            </div>
          ) : null}
          <div className="text-[11px] text-muted-foreground">
            Tax Classification: <span className="font-medium text-slate-800 uppercase">{printProps.taxType || "Non-VAT"}</span>
          </div>
        </div>
      </div>

      {/* Line Items Table */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block">
            Line Items ({printProps.lines.filter((l) => l.description !== "[BLANK_LINE]").length})
          </span>
        </div>
        <div className="rounded-lg border bg-slate-50/50 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-[11px] uppercase font-semibold text-slate-600 border-b">
              <tr>
                <th className="py-2 px-3 w-16 text-center">Qty</th>
                <th className="py-2 px-3">Description</th>
                <th className="py-2 px-3 text-right w-28">Unit Price</th>
                <th className="py-2 px-3 text-right w-32">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 font-mono">
              {printProps.lines
                .filter((l) => l.description !== "[BLANK_LINE]")
                .map((line, idx) => (
                  <tr key={line.id || idx} className="hover:bg-slate-100/50">
                    <td className="py-2 px-3 text-center font-bold text-slate-900 tabular-nums">
                      {formatPrintQty(line.quantity)}
                    </td>
                    <td className="py-2 px-3 font-sans text-slate-800">
                      {line.description}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-600 tabular-nums whitespace-nowrap">
                      ₱{formatPrintMoney(line.unit_price)}
                    </td>
                    <td className="py-2 px-3 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                      ₱{formatPrintMoney(line.line_total)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Financial Summary */}
      <div className="pt-3 border-t flex flex-col items-end gap-1.5 text-xs font-mono">
        <div className="flex justify-between w-64 text-slate-600">
          <span>Gross Total:</span>
          <span className="tabular-nums">₱{formatPrintMoney(printableGrossTotal)}</span>
        </div>
        {isVatable ? (
          <>
            <div className="flex justify-between w-64 text-slate-600">
              <span>Vatable Sales:</span>
              <span className="tabular-nums">₱{formatPrintMoney(printProps.vatableSales)}</span>
            </div>
            <div className="flex justify-between w-64 text-slate-600">
              <span>12% VAT:</span>
              <span className="tabular-nums">₱{formatPrintMoney(printProps.vatAmount)}</span>
            </div>
          </>
        ) : null}
        {showEwt ? (
          <div className="flex justify-between w-64 text-slate-600">
            <span>Withholding Tax:</span>
            <span className="text-amber-700 tabular-nums">-₱{formatPrintMoney(printEwtAmount)}</span>
          </div>
        ) : null}
        <div className="flex justify-between w-64 text-sm font-bold text-slate-900 pt-1.5 border-t">
          <span>Amount Due:</span>
          <span className="text-primary font-bold tabular-nums">₱{formatPrintMoney(finalAmount)}</span>
        </div>
      </div>
    </div>
  );
}

function ServiceInvoiceInsertionGuide({ printProps }: { printProps?: ServiceInvoiceFormProps }) {
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
          {isL121 ? "Epson L121 Right-Load (15 cm / 5.9\")" : "15 cm (5.9\") Portrait Feed"}
        </span>
      </div>

      {/* Grid with Diagram on Left, Step Instructions on Right */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
        {/* Visual Service Invoice & Printer Feed Slot Representation */}
        <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50/70 p-4">
          {/* Service Invoice Visual Representation */}
          <div className="w-[190px] h-[230px] rounded-sm border-2 border-dashed border-emerald-500 bg-white p-2 shadow-sm flex flex-col justify-between text-[9px] relative overflow-hidden">
            {/* Top / Trailing Edge */}
            <div className="border-b border-slate-200 pb-1 text-center text-[7.5px] font-semibold text-slate-500 bg-slate-50 -mx-2 -mt-2 pt-1">
              Trailing Edge (Signatures &amp; Total Due)
            </div>

            {/* Form Body Illustration */}
            <div className="space-y-1.5 py-1 text-slate-600 font-mono text-[8px] bg-slate-50/50 p-1.5 rounded border border-slate-100 flex-1 flex flex-col justify-between my-1">
              <div>
                <div className="flex justify-between text-slate-500 text-[7px] border-b pb-0.5">
                  <span className="font-bold truncate max-w-[100px]">{printProps?.customer?.customer_name || "CUSTOMER"}</span>
                  <span>{printProps?.invoiceNumber ? `INV #${printProps.invoiceNumber}` : "INVOICE #"}</span>
                </div>
                <div className="pt-1 text-[7.5px] text-slate-700 font-sans font-medium line-clamp-2">
                  {printProps?.lines?.filter((l) => l.description !== "[BLANK_LINE]")?.[0]?.description || "OFFICIAL INVOICE SERVICES"}
                </div>
              </div>
              <div className="border-t pt-1 flex justify-between items-center text-[7px] text-slate-500">
                <span>ITEMS: {printProps?.lines?.filter((l) => l.description !== "[BLANK_LINE]")?.length || 1}</span>
                <span className="font-bold text-slate-700">₱{formatPrintMoney(printProps?.amountDue || printProps?.grossTotal || printProps?.invoiceAmount || 0)}</span>
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
                SERVICE INVOICE HEADER
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
                <span className="text-blue-300 font-bold">15 cm Slot</span>
                <span className="text-amber-400 font-bold">Fixed Right Guide ▮</span>
              </>
            ) : (
              <>
                <span className="text-slate-400 font-bold">◄ Left Guide</span>
                <span className="text-emerald-300 font-bold">15 cm Guide Feeder Slot</span>
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
                {isL121 ? "Align Against Fixed Right Guide" : "Set 15 cm Guides on Feeder Slot Below"}
              </p>
              <p className="text-[11px] text-slate-600 leading-snug">
                {isL121
                  ? "Load invoice flush against the fixed right guide rail, then slide the left guide snugly to 15 cm (~5.9\") width."
                  : "Snug the paper feed guide rails to 15 cm (~5.9\") width to prevent skew during printing in center."}
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
                Insert the top edge (where &quot;SERVICE INVOICE&quot; is printed) downward into the feed slot first.
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
                Insert paper with the printed invoice lines facing toward you.
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
                Gently push the top edge down into the 15 cm feeder slot at the bottom until engaged.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PrintShell({
  children,
  invoiceId,
  pdfFileName,
  buildGeneratedPdf,
  downloadExcel,
  directPrintJob,
}: {
  children: ReactNode;
  invoiceId?: string;
  pdfFileName?: string;
  buildGeneratedPdf?: (calibration: PrintCalibration) => Promise<JsPDF>;
  downloadExcel?: () => void;
  directPrintJob?: { identifier: string; label?: string; jobData?: unknown };
}) {
  return (
    <BasePrintShell
      backTo={invoiceId ? "/invoices/$id" : "/invoices"}
      backParams={invoiceId ? { id: invoiceId } : undefined}
      backLabel={invoiceId ? "Back to invoice" : "Back to invoices"}
      pdfFileName={pdfFileName}
      pdfPageSize={SERVICE_INVOICE_PDF_SIZE_PT}
      pageCssSize="15cm 20cm"
      calibrationDocument="invoice"
      printWithGeneratedPdf
      buildGeneratedPdf={buildGeneratedPdf}
      downloadExcel={downloadExcel}
      hideDownloadPdf={true}
      hideDownloadExcel={true}
      directPrintJob={directPrintJob}
    >
      {children}
    </BasePrintShell>
  );
}

type ServiceInvoiceFormProps = {
  calibration?: PrintCalibration;
  customer: Customer | null;
  invoiceNumber: string;
  clientPoNumber: string | null;
  invoiceDate: string;
  invoiceAmount: number;
  vatableSales: number;
  vatAmount: number;
  ewtEnabled: boolean;
  ewtAmount: number;
  grossTotal: number;
  ewtTreatment: "reference_only" | "deducted_from_amount_due";
  amountDue: number;
  taxType: "vatable" | "non_vat";
  includeEwt: boolean;
  ewtRate: number;
  lines: InvoiceLine[];
};

async function buildServiceInvoicePdf({
  customer,
  invoiceNumber: _invoiceNumber,
  clientPoNumber,
  invoiceDate,
  invoiceAmount,
  vatableSales,
  vatAmount,
  ewtAmount = 0,
  grossTotal,
  amountDue,
  taxType,
  includeEwt,
  ewtRate,
  lines,
  calibration,
}: ServiceInvoiceFormProps) {
  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF("p", "pt", SERVICE_INVOICE_PDF_SIZE_PT);
  const pageWidth = SERVICE_INVOICE_PDF_SIZE_PT[0];
  const isVatable = taxType === "vatable";
  const printableGrossTotal = grossTotal || invoiceAmount;
  const printableAmountDue = amountDue || printableGrossTotal;
  const printEwtAmount = includeEwt
    ? ewtAmount > 0
      ? ewtAmount
      : vatableSales * (ewtRate > 0 ? ewtRate : 0.02)
    : 0;
  const showEwt = includeEwt && printEwtAmount > 0;
  const finalAmount = showEwt
    ? Math.max(printableGrossTotal - printEwtAmount, 0)
    : printableAmountDue;

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
      unit: "cm",
    });

  draw(
    {
      text: fmtDate(invoiceDate),
      top: SI_DATE_TOP_CM,
      right: 1.37,
      width: 2.5,
      align: "right",
    },
    "date",
  );
  draw(
    {
      text: customer?.customer_name,
      top: SI_SOLD_TO_TOP_CM,
      left: 3.42,
      width: 7.4,
      size: 9,
      minSize: 7,
      fitToWidth: true,
    },
    "customerName",
  );
  draw(
    {
      text: customer?.customer_name,
      top: SI_REGISTERED_NAME_TOP_CM,
      left: 3.42,
      width: 7.4,
      size: 9,
      minSize: 7,
      fitToWidth: true,
    },
    "customerName",
  );
  draw(
    {
      text: customer?.tin_number,
      top: SI_TIN_TOP_CM,
      left: 3.42,
      width: 4.1,
      size: 9,
    },
    "tin",
  );
  draw({
    text: clientPoNumber,
    top: SI_TIN_TOP_CM,
    left: 10.02,
    width: 2.7,
    align: "right",
    size: 9,
  });
  draw(
    {
      text: customer?.address,
      top: SI_ADDRESS_TOP_CM,
      left: 3.42,
      width: 9.9,
      size: 7.5,
      wrap: true,
      maxLines: 3,
      lineHeightFactor: 1.15,
    },
    "address",
  );

  lines.forEach((line, index) => {
    const top = siItemTopCm(index);
    const descText = (line.description || "").trim();
    pdf.setFontSize(8.5);
    const fieldWidthPt = 6.85 * (72 / 2.54);
    const singleLineWidth = pdf.getTextWidth(descText.toUpperCase());
    const isSingleLine = singleLineWidth <= fieldWidthPt;

    if (isSingleLine) {
      draw(
        {
          text: descText,
          top,
          left: 1.05,
          width: 6.85,
          size: 8.5,
          minSize: 6.5,
          fitToWidth: true,
        },
        "lineDescription",
      );
    } else {
      draw(
        {
          text: descText,
          top: top - 0.14,
          left: 1.05,
          width: 6.85,
          size: 6.0,
          wrap: true,
          maxLines: 2,
          lineHeightFactor: 0.9,
        },
        "lineDescription",
      );
    }
    draw(
      { text: formatPrintQty(line.quantity), top, left: 8.29, width: 0.72, align: "right" },
      "lineQuantity",
    );
    draw(
      { text: formatPrintMoney(line.unit_price), top, left: 9.32, width: 2, align: "right" },
      "lineUnitPrice",
    );
    draw(
      {
        text: formatPrintMoney(line.line_total),
        top,
        left: 11.85,
        width: 2.35,
        align: "right",
      },
      "lineAmount",
    );
  });

  draw(
    {
      text: formatPrintMoney(printableGrossTotal),
      top: siTotalsTopCm(0),
      left: 11.85,
      width: 2.35,
      align: "right",
    },
    "totalSales",
  );
  draw(
    {
      text: isVatable ? formatPrintMoney(vatAmount) : "",
      top: siTotalsTopCm(1),
      left: 11.85,
      width: 2.35,
      align: "right",
    },
    "vat",
  );
  draw(
    {
      text: formatPrintMoney(isVatable ? vatableSales : printableAmountDue),
      top: siTotalsTopCm(2),
      left: 11.85,
      width: 2.35,
      align: "right",
    },
    "amountNetOfVat",
  );
  draw(
    {
      text: isVatable ? formatPrintMoney(vatAmount) : "",
      top: siTotalsTopCm(4),
      left: 11.85,
      width: 2.35,
      align: "right",
    },
    "addVat",
  );
  draw(
    {
      text: showEwt ? formatPrintMoney(printEwtAmount) : "",
      top: siTotalsTopCm(5),
      left: 11.85,
      width: 2.35,
      align: "right",
    },
    "withholdingTax",
  );
  draw(
    {
      text: formatPrintMoney(finalAmount),
      top: siTotalsTopCm(6),
      left: 11.85,
      width: 2.35,
      align: "right",
      size: 11,
    },
    "amountDue",
  );

  return pdf;
}

function ServiceInvoiceForm({
  customer,
  invoiceNumber: _invoiceNumber,
  clientPoNumber,
  invoiceDate,
  invoiceAmount,
  vatableSales,
  vatAmount,
  ewtAmount = 0,
  grossTotal,
  amountDue,
  taxType,
  includeEwt,
  ewtRate,
  lines,
}: ServiceInvoiceFormProps) {
  const isVatable = taxType === "vatable";
  const printableGrossTotal = grossTotal || invoiceAmount;
  const printableAmountDue = amountDue || printableGrossTotal;
  const printEwtAmount = includeEwt
    ? ewtAmount > 0
      ? ewtAmount
      : vatableSales * (ewtRate > 0 ? ewtRate : 0.02)
    : 0;
  const showEwt = includeEwt && printEwtAmount > 0;
  const finalAmount = showEwt
    ? Math.max(printableGrossTotal - printEwtAmount, 0)
    : printableAmountDue;

  return (
    <article className="print-document relative mx-auto h-[20cm] w-[15cm] bg-white text-[10px] font-semibold leading-tight text-black shadow-sm">
      <OverlayValue top={`${SI_DATE_TOP_CM}cm`} right="1.24cm" width="2.5cm" align="right">
        {fmtDate(invoiceDate)}
      </OverlayValue>

      <OverlayValue top={`${SI_SOLD_TO_TOP_CM}cm`} left="3.55cm" width="7.4cm" size="9px">
        {customer?.customer_name ?? "Customer"}
      </OverlayValue>
      <OverlayValue top={`${SI_REGISTERED_NAME_TOP_CM}cm`} left="3.55cm" width="7.4cm" size="9px">
        {customer?.customer_name ?? "Customer"}
      </OverlayValue>
      <OverlayValue top={`${SI_TIN_TOP_CM}cm`} left="3.55cm" width="4.1cm" size="9px">
        {customer?.tin_number ?? ""}
      </OverlayValue>
      <OverlayValue
        top={`${SI_TIN_TOP_CM}cm`}
        left="10.15cm"
        width="2.7cm"
        align="right"
        size="9px"
      >
        {clientPoNumber ?? ""}
      </OverlayValue>
      <OverlayValue top={`${SI_ADDRESS_TOP_CM}cm`} left="3.55cm" width="9.9cm" size="7.5px" wrap>
        {customer?.address ?? ""}
      </OverlayValue>

      {lines
        .filter((line) => line.description !== "[BLANK_LINE]")
        .map((line, index) => {
          const isMultiLine = (line.description?.length ?? 0) > 42;
          return (
            <div key={line.id}>
              <OverlayValue
                top={`${isMultiLine ? siItemTopCm(index) - 0.14 : siItemTopCm(index)}cm`}
                left="1.16cm"
                width="6.85cm"
                size={isMultiLine ? "6.0px" : "9px"}
                lineHeight={isMultiLine ? "1.1" : undefined}
                wrap
              >
                {line.description}
              </OverlayValue>
              <OverlayValue
                top={`${siItemTopCm(index)}cm`}
                left="8.42cm"
                width="0.72cm"
                align="right"
              >
                {formatPrintQty(line.quantity)}
              </OverlayValue>
              <OverlayValue top={`${siItemTopCm(index)}cm`} left="9.45cm" width="2.0cm" align="right">
                {formatPrintMoney(line.unit_price)}
              </OverlayValue>
              <OverlayValue
                top={`${siItemTopCm(index)}cm`}
                left="11.85cm"
                width="2.35cm"
                align="right"
              >
                {formatPrintMoney(line.line_total)}
              </OverlayValue>
            </div>
          );
        })}

      <OverlayValue top={`${siTotalsTopCm(0)}cm`} left="11.85cm" width="2.35cm" align="right">
        {formatPrintMoney(printableGrossTotal)}
      </OverlayValue>
      <OverlayValue top={`${siTotalsTopCm(1)}cm`} left="11.85cm" width="2.35cm" align="right">
        {isVatable ? formatPrintMoney(vatAmount) : ""}
      </OverlayValue>
      <OverlayValue top={`${siTotalsTopCm(2)}cm`} left="11.85cm" width="2.35cm" align="right">
        {formatPrintMoney(isVatable ? vatableSales : printableAmountDue)}
      </OverlayValue>
      <OverlayValue top={`${siTotalsTopCm(4)}cm`} left="11.85cm" width="2.35cm" align="right">
        {isVatable ? formatPrintMoney(vatAmount) : ""}
      </OverlayValue>
      <OverlayValue top={`${siTotalsTopCm(5)}cm`} left="11.85cm" width="2.35cm" align="right">
        {showEwt ? formatPrintMoney(printEwtAmount) : ""}
      </OverlayValue>
      <OverlayValue
        top={`${siTotalsTopCm(6)}cm`}
        left="11.85cm"
        width="2.35cm"
        align="right"
        size="11px"
      >
        {formatPrintMoney(finalAmount)}
      </OverlayValue>
    </article>
  );
}

function OverlayValue({
  children,
  top,
  left,
  right,
  width,
  align = "left",
  size = "10px",
  wrap = false,
}: {
  children: ReactNode;
  top: string;
  left?: string;
  right?: string;
  width: string;
  align?: "left" | "right" | "center";
  size?: string;
  wrap?: boolean;
}) {
  return (
    <div
      className={`absolute uppercase tabular-nums ${
        wrap
          ? "whitespace-normal break-words leading-tight max-h-[1.1cm] overflow-hidden"
          : "overflow-hidden whitespace-nowrap"
      }`}
      style={{ top, left, right, width, textAlign: align, fontSize: size }}
    >
      {children}
    </div>
  );
}
