import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PrintShell } from "@/components/print/PrintShell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { computeInclusiveVat } from "@/lib/calc";
import { fmtDate } from "@/lib/format";
import { drawPreprintedText, fitPreprintedFontSize } from "@/lib/preprintedPdf";
import { formatPrintMoney, formatPrintQty } from "@/lib/printFormat";
import { DEFAULT_PRINT_CALIBRATION, resolveFieldOffset, type PrintCalibration } from "@/lib/printCalibration";
import { COMPANY_PROFILE } from "@/lib/brand";
import { downloadFilledTemplate } from "@/lib/templateWorkbook";

export const Route = createFileRoute("/jobs/$id/delivery-receipt/print")({
  head: () => ({ meta: [{ title: `Print delivery receipt - ${COMPANY_PROFILE.name}` }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    priced:
      search.priced === true ||
      search.priced === "true" ||
      search.prices === true ||
      search.prices === "true",
  }),
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
const DR_TERMS_RIGHT_DELTA_IN = 0.7 / 2.54;
const DR_TIN_DELTA_IN = 0.38 / 2.54;
const DR_ADDRESS_DELTA_IN = 0.6 / 2.54;
const DR_PO_DELTA_IN = -0.108 / 2.54;
const DR_PO_RIGHT_DELTA_IN = 1 - 0.3 / 2.54;
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
  const { priced } = Route.useSearch();
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
    priced,
    lines: displayLines,
    lineSubtotal,
    vatAmount,
    totalAmount,
  } satisfies DeliveryReceiptFormProps;

  const excelLines =
    job.data.tax_type === "vatable"
      ? lines.map((line) => ({
          ...line,
          line_total: computeInclusiveVat(line.line_total).grossTotal,
        }))
      : lines;
  // The DR SSOT workbook contains one worksheet only; VAT/non-VAT is rendered
  // into the same calibrated form rather than selecting a legacy extra tab.
  const excelSheetIndex = 0;
  const excelLineCapacity = job.data.tax_type === "vatable" ? 9 : 15;
  const excelCells = buildDeliveryReceiptCells(
    { ...printProps, lines: excelLines },
    job.data.tax_type === "vatable",
  );
  const extraExcelRows = Math.max(0, excelLines.length - excelLineCapacity);

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
      buildGeneratedPdf={(calibration) => buildDeliveryReceiptPdf({ ...printProps, calibration })}
      downloadExcel={() =>
        downloadFilledTemplate(
          "delivery-receipt",
          excelSheetIndex,
          excelCells,
          `${printProps.jobNumber}-DR.xlsx`,
          {
            onlySelectedSheet: true,
            ...(extraExcelRows > 0
              ? {
                  insertRows: {
                    beforeRow: excelLineCapacity === 9 ? 28 : 34,
                    count: extraExcelRows,
                    copyStyleFromRow: excelLineCapacity === 9 ? 27 : 33,
                    printAreaStartRow: excelLineCapacity === 9 ? 3 : 1,
                    printAreaEndRow: excelLineCapacity === 9 ? 34 : 34,
                  },
                }
              : {}),
          },
        )
      }
    >
      <h1 className="sr-only">Delivery Receipt{priced ? " - Priced" : ""}</h1>
      {job.data.tax_type !== "vatable" ? <p className="sr-only">Non-VAT</p> : null}
      <DeliveryReceiptForm {...printProps} />
    </PrintShell>
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
  priced: boolean;
  lines: JobLine[];
  lineSubtotal: number;
  vatAmount: number;
  totalAmount: number;
};

function buildDeliveryReceiptCells(
  props: DeliveryReceiptFormProps,
  isVatable: boolean,
): Record<string, string | number | Date> {
  const startRow = 19;
  const cells: Record<string, string | number | Date> = {};
  const date = props.receiptDate instanceof Date ? props.receiptDate : new Date(props.receiptDate);
  // DR SSOT layout: customer/date on row 9, project title on row 10.
  cells.B9 = props.customer?.customer_name ?? "";
  cells.F9 = date;
  cells.C15 = props.projectName;
  cells.B11 = props.customer?.tin_number ?? "";
  cells.B12 = props.customer?.address ?? "";
  cells.F11 = props.quoteNumber ?? props.drNumber ?? "";

  const rowsAvailable = 9;
  for (let index = 0; index < Math.max(rowsAvailable, props.lines.length); index += 1) {
    const row = startRow + index;
    const line = props.lines[index];
    cells[`B${row}`] = line?.quantity ?? "";
    cells[`C${row}`] = line ? [line.unit_of_measure, line.description].filter(Boolean).join(" ") : "";
    cells[`D${row}`] = props.priced ? line?.unit_price ?? "" : "";
    cells[`F${row}`] = props.priced ? line?.line_total ?? "" : "";
  }

  const subtotalRow = 28 + Math.max(0, props.lines.length - rowsAvailable);
  cells[`F${subtotalRow}`] = props.priced ? props.lineSubtotal : "";
  cells[`F${subtotalRow + 1}`] = props.priced ? props.vatAmount : "";
  cells[`F${subtotalRow + 3}`] = props.priced ? props.totalAmount : "";
  return cells;
}

async function buildDeliveryReceiptPdf({
  customer,
  receiptDate,
  jobNumber,
  quoteNumber,
  terms,
  drNumber,
  clientPoNumber,
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
  const draw = (args: Omit<Parameters<typeof drawPreprintedText>[1], "pageWidth" | "unit">, field?: string) =>
    drawPreprintedText(pdf, { ...args, offset: field ? resolveFieldOffset(calibration ?? DEFAULT_PRINT_CALIBRATION, field) : (calibration ?? DEFAULT_PRINT_CALIBRATION).page, pageWidth, unit: "in" });

  draw({
    text: terms,
    top: drTopValue(DR_TERMS_TOP_IN + DR_HEADER_SHIFT_IN + DR_TERMS_DELTA_IN),
    left: DR_TERMS_LEFT_IN + DR_TERMS_RIGHT_DELTA_IN - (DR_TERMS_WIDTH_IN - 1.1),
    width: DR_TERMS_WIDTH_IN,
    align: "right",
    size: 8,
  }, "terms");
  draw({
    text: fmtDate(receiptDate),
    top: drTopValue(DR_DATE_TOP_IN + DR_HEADER_SHIFT_IN),
    left: DR_DATE_LEFT_IN,
    width: 1.1,
    align: "right",
  }, "date");
  draw({
    text: customer?.customer_name,
    top: drTopValue(DR_CUSTOMER_TOP_IN + DR_HEADER_SHIFT_IN + DR_CUSTOMER_DELTA_IN),
    left: DR_CUSTOMER_LEFT_IN,
    width: 2.27,
  }, "customerName");
  draw({
    text: customer?.tin_number,
    top: drTopValue(DR_TIN_TOP_IN + DR_HEADER_SHIFT_IN + DR_TIN_DELTA_IN),
    left: DR_TIN_ADDRESS_LEFT_IN,
    width: 2.65,
  }, "tin");
  draw({
    text: customer?.address,
    top: drTopValue(DR_ADDRESS_TOP_IN + DR_HEADER_SHIFT_IN + DR_ADDRESS_DELTA_IN),
    left: DR_TIN_ADDRESS_LEFT_IN,
    width: 2.65,
    size: 8,
  }, "address");
  draw({
    text: quoteNumber || clientPoNumber,
    top: drTopValue(DR_PO_TOP_IN + DR_HEADER_SHIFT_IN + DR_PO_DELTA_IN),
    left: 3.52 + DR_PO_RIGHT_DELTA_IN,
    width: 1.1,
    align: "right",
  }, "poNumber");

  lines.forEach((line, index) => {
    const top = drLineTopValue(3.52 + index * 0.48);
    draw({ text: formatPrintQty(line.quantity), top, left: 0.43, width: 0.38, align: "center" }, "lineQuantity");
    draw({
      text: (line.unit_of_measure ?? "PCS").toUpperCase(),
      top,
      left: 0.93,
      width: 0.48,
      align: "center",
    }, "lineUnit");
    draw({
      text: line.description,
      top,
      left: 1.55,
      width: 2.45,
      size: 8,
      minSize: 6,
      fitToWidth: true,
    }, "lineDescription");
    if (priced) {
      draw({
        text: formatPrintMoney(line.line_total),
        top,
        left: DR_AMOUNT_LEFT_IN,
        width: 0.82,
        align: "right",
      }, "lineAmount");
      draw({
        text: formatPrintMoney(line.unit_price),
        top,
        left: 3.45,
        width: 0.62,
        align: "right",
      }, "lineUnitPrice");
    }
  });

  if (priced) {
    draw({
      text: "SUBTOTAL",
      top: drLineTopValue(6.58),
      left: 3.08,
      width: 1.1,
      align: "right",
      size: 8,
    }, "subtotal");
    draw({
      text: formatPrintMoney(lineSubtotal),
      top: drLineTopValue(6.58),
      left: DR_AMOUNT_LEFT_IN,
      width: 0.82,
      align: "right",
    }, "subtotal");
    draw({
      text: formatPrintMoney(vatAmount),
      top: drLineTopValue(6.82),
      left: DR_AMOUNT_LEFT_IN,
      width: 0.82,
      align: "right",
    }, "vat");
    draw({
      text: formatPrintMoney(totalAmount),
      top: drLineTopValue(7.06),
      left: DR_AMOUNT_LEFT_IN,
      width: 0.82,
      align: "right",
    }, "total");
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
      <OverlayValue
        top={drTop(DR_PO_TOP_IN + DR_HEADER_SHIFT_IN + DR_PO_DELTA_IN)}
        left={`${3.52 + DR_PO_RIGHT_DELTA_IN}in`}
        width="1.1in"
        align="right"
      >
        {quoteNumber || clientPoNumber || ""}
      </OverlayValue>

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
