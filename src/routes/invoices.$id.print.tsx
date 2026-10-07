import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { jsPDF as JsPDF } from "jspdf";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PrintShell as BasePrintShell } from "@/components/print/PrintShell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/lib/format";
import { drawPreprintedText } from "@/lib/preprintedPdf";
import { formatPrintMoney, formatPrintQty } from "@/lib/printFormat";
import { DEFAULT_PRINT_CALIBRATION, resolveFieldOffset, type PrintCalibration } from "@/lib/printCalibration";
import { COMPANY_PROFILE } from "@/lib/brand";
import { downloadFilledTemplate } from "@/lib/templateWorkbook";

export const Route = createFileRoute("/invoices/$id/print")({
  head: () => ({ meta: [{ title: `Print invoice - ${COMPANY_PROFILE.name}` }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    includeEwt: search.includeEwt === true || search.includeEwt === "true",
    ewtRate: Number(search.ewtRate ?? 0.02),
  }),
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
const SERVICE_INVOICE_VERTICAL_OFFSET_CM = 0.55;
const SI_DATE_TOP_CM = 3.05;
const SERVICE_INVOICE_LINE_VERTICAL_OFFSET_CM = 0.22;
const SI_SECOND_ITEM_LINE_TOP_CM = 6.83;
const SI_ITEM_LINE_STEP_CM = 0.55;
const SI_FIRST_ITEM_LINE_ADJUSTMENT_CM = 0.1;
const SI_INVOICE_NUMBER_TOP_CM = 3.55;
const SI_SOLD_TO_COMPANY_LABEL = COMPANY_PROFILE.name;
const SI_TOTAL_SALES_TOP_CM = 12.97;
const SI_VAT_TOP_CM = 13.51;
const SI_AMOUNT_NET_OF_VAT_TOP_CM = 14.05;
const SI_ADD_VAT_TOP_CM = 15.15;
const SI_WITHHOLDING_TAX_TOP_CM = 15.66;
const SI_AMOUNT_DUE_TOP_CM = 16.15;

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
  const printProps = {
    customer: printCustomer,
    invoiceNumber: invoice.data.invoice_number,
    clientPoNumber: job?.client_po_number ?? null,
    invoiceDate: invoice.data.invoice_date,
    invoiceAmount: invoice.data.invoice_amount,
    vatableSales: invoice.data.vatable_sales_snapshot,
    vatAmount: invoice.data.vat_amount_snapshot,
    ewtEnabled: invoice.data.ewt_enabled,
    ewtAmount: invoice.data.ewt_amount_snapshot,
    grossTotal: invoice.data.gross_total_snapshot,
    ewtTreatment:
      invoice.data.ewt_treatment_snapshot === "deducted_from_amount_due"
        ? "deducted_from_amount_due"
        : "reference_only",
    amountDue: invoice.data.amount_due_snapshot,
    taxType: invoice.data.tax_type ?? "non_vat",
    lines: printedLines,
    includeEwt,
    ewtRate,
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
      downloadExcel={() => downloadFilledTemplate("sales-invoice", 0, { F8: printProps.invoiceDate, B9: printProps.customer?.customer_name ?? "", A11: printProps.customer?.tin_number ?? "", B13: printProps.customer?.address ?? "", A18: printProps.lines[0]?.description ?? "", E22: printProps.lines[0]?.quantity ?? 0, F22: printProps.lines[0]?.unit_price ?? 0, G22: printProps.lines[0]?.line_total ?? 0 }, `${printProps.invoiceNumber}-SI.xlsx`)}
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

      <ServiceInvoiceForm {...printProps} />
    </PrintShell>
  );
}

function PrintShell({
  children,
  invoiceId,
  pdfFileName,
  buildGeneratedPdf,
  downloadExcel,
}: {
  children: ReactNode;
  invoiceId?: string;
  pdfFileName?: string;
  buildGeneratedPdf?: (calibration: PrintCalibration) => Promise<JsPDF>;
  downloadExcel?: () => void;
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
  invoiceNumber,
  clientPoNumber,
  invoiceDate,
  invoiceAmount,
  vatableSales,
  vatAmount,
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
  const printableAmountDue = amountDue || invoiceAmount;
  const printEwtAmount = isVatable && ewtRate > 0 ? vatableSales * ewtRate : 0;
  const showEwt = includeEwt && isVatable && printEwtAmount > 0;
  const finalAmount = showEwt
    ? Math.max(printableGrossTotal - printEwtAmount, 0)
    : printableGrossTotal;

  const draw = (args: Omit<Parameters<typeof drawPreprintedText>[1], "pageWidth" | "unit">, field?: string) =>
    drawPreprintedText(pdf, { ...args, offset: field ? resolveFieldOffset(calibration ?? DEFAULT_PRINT_CALIBRATION, field) : (calibration ?? DEFAULT_PRINT_CALIBRATION).page, pageWidth, unit: "cm" });

  draw({
    text: invoiceNumber,
    top: siTopValue(SI_INVOICE_NUMBER_TOP_CM),
    right: 1.24,
    width: 2.5,
    align: "right",
    size: 9,
  }, "invoiceNumber");
  draw({
    text: SI_SOLD_TO_COMPANY_LABEL,
    top: siTopValue(SI_INVOICE_NUMBER_TOP_CM),
    left: 3.55,
    width: 7.4,
    size: 9,
  }, "customerName");
  draw({
    text: fmtDate(invoiceDate),
    top: siTopValue(SI_DATE_TOP_CM),
    right: 1.24,
    width: 2.5,
    align: "right",
  }, "date");
    draw({ text: customer?.customer_name, top: siTopValue(4.17), left: 3.55, width: 7.4, size: 9, minSize: 7, fitToWidth: true }, "customerName");
    draw({ text: customer?.tin_number, top: siTopValue(4.75), left: 3.55, width: 4.1, size: 9 }, "tin");
  draw({
    text: clientPoNumber,
    top: siTopValue(4.75),
    left: 10.15,
    width: 2.7,
    align: "right",
    size: 9,
  });
  draw({ text: customer?.address, top: siTopValue(5.4), left: 3.55, width: 9.9, size: 7, minSize: 5.5, fitToWidth: true }, "address");

  lines.forEach((line, index) => {
    const top = siLineTopValue(siItemTopCm(index));
    draw({ text: line.description, top, left: 1.16, width: 6.95, size: 9, minSize: 6, fitToWidth: true }, "lineDescription");
    draw({ text: formatPrintQty(line.quantity), top, left: 8.42, width: 0.72, align: "right" }, "lineQuantity");
    draw({ text: formatPrintMoney(line.unit_price), top, left: 9.45, width: 2, align: "right" }, "lineUnitPrice");
    draw({
      text: formatPrintMoney(line.line_total),
      top,
      left: 11.67,
      width: 2.25,
      align: "right",
    }, "lineAmount");
  }, "totalSales");

  draw({
    text: formatPrintMoney(printableGrossTotal),
    top: siLineTopValue(SI_TOTAL_SALES_TOP_CM),
    left: 11.55,
    width: 2.3,
    align: "right",
  }, "vat");
  draw({
    text: isVatable ? formatPrintMoney(vatAmount) : "",
    top: siLineTopValue(SI_VAT_TOP_CM),
    left: 11.55,
    width: 2.3,
    align: "right",
  }, "amountNetOfVat");
  draw({
    text: formatPrintMoney(isVatable ? vatableSales : printableAmountDue),
    top: siLineTopValue(SI_AMOUNT_NET_OF_VAT_TOP_CM),
    left: 11.55,
    width: 2.3,
    align: "right",
  }, "addVat");
  draw({
    text: isVatable ? formatPrintMoney(vatAmount) : "",
    top: siLineTopValue(SI_ADD_VAT_TOP_CM),
    left: 11.55,
    width: 2.3,
    align: "right",
  }, "withholdingTax");
  draw({
    text: showEwt ? formatPrintMoney(printEwtAmount) : "",
    top: siLineTopValue(SI_WITHHOLDING_TAX_TOP_CM),
    left: 11.55,
    width: 2.3,
    align: "right",
  }, "amountDue");
  draw({
    text: formatPrintMoney(finalAmount),
    top: siLineTopValue(SI_AMOUNT_DUE_TOP_CM),
    left: 11.55,
    width: 2.3,
    align: "right",
    size: 11,
  });

  return pdf;
}

function ServiceInvoiceForm({
  customer,
  invoiceNumber,
  clientPoNumber,
  invoiceDate,
  invoiceAmount,
  vatableSales,
  vatAmount,
  grossTotal,
  amountDue,
  taxType,
  includeEwt,
  ewtRate,
  lines,
}: ServiceInvoiceFormProps) {
  const isVatable = taxType === "vatable";
  const printableGrossTotal = grossTotal || invoiceAmount;
  const printableAmountDue = amountDue || invoiceAmount;
  const printEwtAmount = isVatable && ewtRate > 0 ? vatableSales * ewtRate : 0;
  const showEwt = includeEwt && isVatable && printEwtAmount > 0;
  const finalAmount = showEwt
    ? Math.max(printableGrossTotal - printEwtAmount, 0)
    : printableGrossTotal;

  return (
    <article className="print-document relative mx-auto h-[20cm] w-[15cm] bg-white text-[10px] font-semibold leading-tight text-black shadow-sm">
      <OverlayValue
        top={siTop(SI_INVOICE_NUMBER_TOP_CM)}
        right="1.24cm"
        width="2.5cm"
        align="right"
        size="9px"
      >
        {invoiceNumber}
      </OverlayValue>
      <OverlayValue top={siTop(SI_INVOICE_NUMBER_TOP_CM)} left="3.55cm" width="7.4cm" size="9px">
        {SI_SOLD_TO_COMPANY_LABEL}
      </OverlayValue>
      <OverlayValue top={siTop(SI_DATE_TOP_CM)} right="1.24cm" width="2.5cm" align="right">
        {fmtDate(invoiceDate)}
      </OverlayValue>

      <OverlayValue top={siTop(4.17)} left="3.55cm" width="7.4cm" size="9px">
        {customer?.customer_name ?? "Customer"}
      </OverlayValue>
      <OverlayValue top={siTop(4.75)} left="3.55cm" width="4.1cm" size="9px">
        {customer?.tin_number ?? ""}
      </OverlayValue>
      <OverlayValue top={siTop(4.75)} left="10.15cm" width="2.7cm" align="right" size="9px">
        {clientPoNumber ?? ""}
      </OverlayValue>
      <OverlayValue top={siTop(5.4)} left="3.55cm" width="9.9cm" size="7px">
        {customer?.address ?? ""}
      </OverlayValue>

      {lines.filter((line) => line.description !== "[BLANK_LINE]").map((line, index) => (
        <div key={line.id}>
          <OverlayValue top={siLineTop(siItemTopCm(index))} left="1.16cm" width="6.95cm" size="9px">
            {line.description}
          </OverlayValue>
          <OverlayValue
            top={siLineTop(siItemTopCm(index))}
            left="8.42cm"
            width="0.72cm"
            align="right"
          >
            {formatPrintQty(line.quantity)}
          </OverlayValue>
          <OverlayValue
            top={siLineTop(siItemTopCm(index))}
            left="9.45cm"
            width="2.0cm"
            align="right"
          >
            {formatPrintMoney(line.unit_price)}
          </OverlayValue>
          <OverlayValue
            top={siLineTop(siItemTopCm(index))}
            left="11.67cm"
            width="2.25cm"
            align="right"
          >
            {formatPrintMoney(line.line_total)}
          </OverlayValue>
        </div>
      ))}

      <OverlayValue
        top={siLineTop(SI_TOTAL_SALES_TOP_CM)}
        left="11.55cm"
        width="2.3cm"
        align="right"
      >
        {formatPrintMoney(printableGrossTotal)}
      </OverlayValue>
      <OverlayValue top={siLineTop(SI_VAT_TOP_CM)} left="11.55cm" width="2.3cm" align="right">
        {isVatable ? formatPrintMoney(vatAmount) : ""}
      </OverlayValue>
      <OverlayValue
        top={siLineTop(SI_AMOUNT_NET_OF_VAT_TOP_CM)}
        left="11.55cm"
        width="2.3cm"
        align="right"
      >
        {formatPrintMoney(isVatable ? vatableSales : printableAmountDue)}
      </OverlayValue>
      <OverlayValue top={siLineTop(SI_ADD_VAT_TOP_CM)} left="11.55cm" width="2.3cm" align="right">
        {isVatable ? formatPrintMoney(vatAmount) : ""}
      </OverlayValue>
      <OverlayValue
        top={siLineTop(SI_WITHHOLDING_TAX_TOP_CM)}
        left="11.55cm"
        width="2.3cm"
        align="right"
      >
        {showEwt ? formatPrintMoney(printEwtAmount) : ""}
      </OverlayValue>
      <OverlayValue
        top={siLineTop(SI_AMOUNT_DUE_TOP_CM)}
        left="11.55cm"
        width="2.3cm"
        align="right"
        size="11px"
      >
        {formatPrintMoney(finalAmount)}
      </OverlayValue>
    </article>
  );
}

function siTop(value: number) {
  return `${siTopValue(value)}cm`;
}

function siLineTop(value: number) {
  return `${siLineTopValue(value)}cm`;
}

function siItemTopCm(index: number) {
  if (index === 0) {
    return SI_SECOND_ITEM_LINE_TOP_CM - SI_ITEM_LINE_STEP_CM + SI_FIRST_ITEM_LINE_ADJUSTMENT_CM;
  }

  return SI_SECOND_ITEM_LINE_TOP_CM + (index - 1) * SI_ITEM_LINE_STEP_CM;
}

function siTopValue(value: number) {
  return value + SERVICE_INVOICE_VERTICAL_OFFSET_CM;
}

function siLineTopValue(value: number) {
  return value + SERVICE_INVOICE_VERTICAL_OFFSET_CM + SERVICE_INVOICE_LINE_VERTICAL_OFFSET_CM;
}

function OverlayValue({
  children,
  top,
  left,
  right,
  width,
  align = "left",
  size = "10px",
}: {
  children: ReactNode;
  top: string;
  left?: string;
  right?: string;
  width: string;
  align?: "left" | "right" | "center";
  size?: string;
}) {
  return (
    <div
      className="absolute overflow-hidden whitespace-nowrap uppercase tabular-nums"
      style={{ top, left, right, width, textAlign: align, fontSize: size }}
    >
      {children}
    </div>
  );
}
