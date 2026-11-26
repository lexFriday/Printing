import type ExcelJS from "exceljs";
import { fmtDate } from "./format";

export interface SalesInvoiceExcelInput {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerAddress?: string | null;
  customerTin?: string | null;
  clientPoNumber?: string | null;
  projectName?: string | null;
  taxType: string;
  lines: Array<{
    description: string;
    quantity: number;
    unit?: string | null;
    unitPrice: number;
    lineTotal: number;
  }>;
  grossTotal: number;
  vatableSales: number;
  vatAmount: number;
  ewtEnabled: boolean;
  ewtAmount: number;
  ewtTreatment?: string | null;
  amountDue: number;
}

export interface DeliveryReceiptExcelInput {
  jobNumber: string;
  quoteNumber?: string | null;
  date: string;
  customerName: string;
  customerAddress?: string | null;
  customerTin?: string | null;
  terms?: string | null;
  clientPoNumber?: string | null;
  projectName?: string | null;
  priced: boolean;
  includePo: boolean;
  lines: Array<{
    description: string;
    quantity: number;
    unit?: string | null;
    unitPrice?: number;
    lineTotal?: number;
  }>;
  lineSubtotal?: number;
  vatAmount?: number;
  totalAmount?: number;
}

const CM_TO_PT = 72 / 2.54;
const IN_TO_PT = 72;

function cmToPt(cm: number): number {
  return cm * CM_TO_PT;
}

function inToPt(inches: number): number {
  return inches * IN_TO_PT;
}

function inToColWidth(inches: number): number {
  return Math.max(0.5, (inches * 96 - 5) / 7);
}

function cmToColWidth(cm: number): number {
  return inToColWidth(cm / 2.54);
}

function upper(value?: string | null): string {
  return (value ?? "").trim().toUpperCase();
}

function downloadWorkbookBuffer(buffer: ArrayBuffer | Uint8Array, fileName: string) {
  const blob = new Blob([buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface PositionedRow {
  topPt: number;
  heightPt: number;
  render: (row: ExcelJS.Row, ws: ExcelJS.Worksheet) => void;
}

function renderPositionedRows(ws: ExcelJS.Worksheet, items: PositionedRow[]) {
  const sorted = [...items].sort((a, b) => a.topPt - b.topPt);
  let cursorPt = 0;

  for (const item of sorted) {
    const gap = item.topPt - cursorPt;
    if (gap > 0.5) {
      const spacer = ws.addRow([]);
      spacer.height = Number(gap.toFixed(2));
      cursorPt += gap;
    }
    const row = ws.addRow([]);
    row.height = Number(item.heightPt.toFixed(2));
    item.render(row, ws);
    cursorPt += item.heightPt;
  }
}

export async function downloadSalesInvoiceExcel(input: SalesInvoiceExcelInput) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sales Invoice", {
    pageSetup: {
      paperSize: 1,
      orientation: "portrait",
      fitToPage: false,
      scale: 100,
      margins: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 },
    },
  });

  // Match ServiceInvoiceForm horizontal positions (cm from left edge):
  // A: 0..1.16 | B: 1.16..3.55 | C: 3.55..8.42 | D: 8.42..9.45 | E: 9.45..11.85 | F: 11.85..14.20
  ws.columns = [
    { width: cmToColWidth(1.16) },
    { width: cmToColWidth(3.55 - 1.16) },
    { width: cmToColWidth(8.42 - 3.55) },
    { width: cmToColWidth(9.45 - 8.42) },
    { width: cmToColWidth(11.85 - 9.45) },
    { width: cmToColWidth(14.2 - 11.85) },
  ];

  const rows: PositionedRow[] = [
    {
      topPt: cmToPt(3.75),
      heightPt: cmToPt(0.47),
      render: (row) => {
        const cell = row.getCell(6);
        cell.value = fmtDate(input.invoiceDate).toUpperCase();
        cell.font = { name: "Arial", size: 10, bold: true };
        cell.alignment = { horizontal: "right", vertical: "top" };
      },
    },
    {
      topPt: cmToPt(4.22),
      heightPt: cmToPt(0.64),
      render: (row, sheet) => {
        sheet.mergeCells(`C${row.number}:F${row.number}`);
        const cell = row.getCell(3);
        cell.value = upper(input.customerName);
        cell.font = { name: "Arial", size: 9, bold: true };
        cell.alignment = { horizontal: "left", vertical: "top" };
      },
    },
    {
      topPt: cmToPt(4.86),
      heightPt: cmToPt(0.47),
      render: (row, sheet) => {
        sheet.mergeCells(`C${row.number}:D${row.number}`);
        const projCell = row.getCell(3);
        projCell.value = upper(input.projectName) || upper(input.customerName);
        projCell.font = { name: "Arial", size: 8, bold: true };
        projCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };

        if (input.clientPoNumber) {
          sheet.mergeCells(`E${row.number}:F${row.number}`);
          const poCell = row.getCell(5);
          poCell.value = {
            richText: [
              { text: "CE/P.O NO: ", font: { name: "Arial", size: 9, bold: true, color: { argb: "FF000000" } } },
              { text: upper(input.clientPoNumber), font: { name: "Arial", size: 9, bold: true, color: { argb: "FFDC2626" } } },
            ],
          };
          poCell.alignment = { horizontal: "left", vertical: "top" };
        }
      },
    },
    {
      topPt: cmToPt(5.33),
      heightPt: cmToPt(0.64),
      render: (row, sheet) => {
        sheet.mergeCells(`C${row.number}:E${row.number}`);
        const cell = row.getCell(3);
        cell.value = upper(input.customerTin);
        cell.font = { name: "Arial", size: 9, bold: true };
        cell.alignment = { horizontal: "left", vertical: "top" };
      },
    },
    {
      topPt: cmToPt(5.97),
      heightPt: cmToPt(1.12),
      render: (row, sheet) => {
        sheet.mergeCells(`C${row.number}:F${row.number}`);
        const cell = row.getCell(3);
        cell.value = upper(input.customerAddress);
        cell.font = { name: "Arial", size: 7.5, bold: true };
        cell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
      },
    },
  ];

  const printableLines = input.lines.filter((line) => line.description !== "[BLANK_LINE]").slice(0, 12);
  printableLines.forEach((line, index) => {
    const isMultiLine = line.description.length > 42;
    rows.push({
      topPt: cmToPt(7.09 + index * 0.508),
      heightPt: cmToPt(0.508),
      render: (row, sheet) => {
        sheet.mergeCells(`B${row.number}:C${row.number}`);
        const descCell = row.getCell(2);
        descCell.value = upper(line.description);
        descCell.font = { name: "Arial", size: isMultiLine ? 6.5 : 9, bold: true };
        descCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };

        const qtyCell = row.getCell(4);
        qtyCell.value = line.quantity;
        qtyCell.font = { name: "Arial", size: 10, bold: true };
        qtyCell.alignment = { horizontal: "right", vertical: "top" };

        const unitPriceCell = row.getCell(5);
        unitPriceCell.value = line.unitPrice;
        unitPriceCell.font = { name: "Arial", size: 10, bold: true };
        unitPriceCell.alignment = { horizontal: "right", vertical: "top" };
        unitPriceCell.numFmt = "#,##0.00";

        const amountCell = row.getCell(6);
        amountCell.value = line.lineTotal;
        amountCell.font = { name: "Arial", size: 10, bold: true };
        amountCell.alignment = { horizontal: "right", vertical: "top" };
        amountCell.numFmt = "#,##0.00";
      },
    });
  });

  const isVatable = input.taxType === "vatable";
  const showEwt = input.ewtEnabled && input.ewtAmount > 0;
  const finalAmount = showEwt ? Math.max(input.grossTotal - input.ewtAmount, 0) : input.amountDue;

  const totalSlots: Array<{ slot: number; value: number; size?: number }> = [
    { slot: 0, value: input.grossTotal },
    ...(isVatable ? [{ slot: 1, value: input.vatAmount }] : []),
    { slot: 2, value: isVatable ? input.vatableSales : input.amountDue },
    ...(isVatable ? [{ slot: 4, value: input.vatAmount }] : []),
    ...(showEwt ? [{ slot: 5, value: input.ewtAmount }] : []),
    { slot: 6, value: finalAmount, size: 11 },
  ];

  for (const entry of totalSlots) {
    rows.push({
      topPt: cmToPt(13.75 + entry.slot * 0.508),
      heightPt: cmToPt(0.508),
      render: (row) => {
        const cell = row.getCell(6);
        cell.value = entry.value;
        cell.font = { name: "Arial", size: entry.size ?? 10, bold: true };
        cell.alignment = { horizontal: "right", vertical: "top" };
        cell.numFmt = "#,##0.00";
      },
    });
  }

  renderPositionedRows(ws, rows);

  const buffer = await wb.xlsx.writeBuffer();
  downloadWorkbookBuffer(buffer, `${input.invoiceNumber || "sales-invoice"}.xlsx`);
}

export async function downloadDeliveryReceiptExcel(input: DeliveryReceiptExcelInput) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Delivery Receipt", {
    pageSetup: {
      paperSize: 6, // Statement: 5.5in x 8.5in
      orientation: "portrait",
      fitToPage: false,
      scale: 100,
      margins: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 },
    },
  });

  // Match DeliveryReceiptForm horizontal positions (in from left edge):
  // A: 0..0.43 | B: 0.43..0.93 | C: 0.93..1.55 | D: 1.55..3.45 | E: 3.45..4.38 | F: 4.38..5.20
  ws.columns = [
    { width: inToColWidth(0.43) },
    { width: inToColWidth(0.93 - 0.43) },
    { width: inToColWidth(1.55 - 0.93) },
    { width: inToColWidth(3.45 - 1.55) },
    { width: inToColWidth(4.38 - 3.45) },
    { width: inToColWidth(5.2 - 4.38) },
  ];

  const headerShiftIn = -1 / 2.54;
  const vOffsetIn = 0.06;
  const lineVOffsetIn = 0.1;

  const poValue = input.includePo ? upper(input.quoteNumber || input.clientPoNumber) : "";

  const rows: PositionedRow[] = [
    {
      topPt: inToPt(2.15 + headerShiftIn + vOffsetIn),
      heightPt: inToPt(0.14),
      render: (row) => {
        const dateCell = row.getCell(6);
        dateCell.value = fmtDate(input.date).toUpperCase();
        dateCell.font = { name: "Arial", size: 9, bold: true };
        dateCell.alignment = { horizontal: "right", vertical: "top" };
      },
    },
    {
      topPt: inToPt(2.15 + headerShiftIn + 0.3 / 2.54 + vOffsetIn),
      heightPt: inToPt(0.2),
      render: (row, sheet) => {
        sheet.mergeCells(`C${row.number}:E${row.number}`);
        const cell = row.getCell(3);
        cell.value = upper(input.customerName);
        cell.font = { name: "Arial", size: 9, bold: true };
        cell.alignment = { horizontal: "left", vertical: "top" };
      },
    },
    {
      topPt: inToPt(2.36 + headerShiftIn + 0.38 / 2.54 + vOffsetIn),
      heightPt: inToPt(0.22),
      render: (row, sheet) => {
        sheet.mergeCells(`B${row.number}:D${row.number}`);
        const tinCell = row.getCell(2);
        tinCell.value = upper(input.customerTin);
        tinCell.font = { name: "Arial", size: 9, bold: true };
        tinCell.alignment = { horizontal: "left", vertical: "top" };

        const termsCell = row.getCell(6);
        termsCell.value = upper(input.terms);
        termsCell.font = { name: "Arial", size: 8, bold: true };
        termsCell.alignment = { horizontal: "right", vertical: "top" };
      },
    },
    {
      topPt: inToPt(2.54 + headerShiftIn + 0.5 / 2.54 + vOffsetIn),
      heightPt: inToPt(0.32),
      render: (row, sheet) => {
        sheet.mergeCells(`B${row.number}:D${row.number}`);
        const addrCell = row.getCell(2);
        addrCell.value = upper(input.customerAddress);
        addrCell.font = { name: "Arial", size: 8, bold: true };
        addrCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };

        if (poValue) {
          const poCell = row.getCell(6);
          poCell.value = poValue;
          poCell.font = { name: "Arial", size: 9, bold: true };
          poCell.alignment = { horizontal: "right", vertical: "top" };
        }
      },
    },
  ];

  input.lines.slice(0, 7).forEach((line, index) => {
    rows.push({
      topPt: inToPt(3.52 + index * 0.48 + vOffsetIn + lineVOffsetIn),
      heightPt: inToPt(0.48),
      render: (row) => {
        const qtyCell = row.getCell(2);
        qtyCell.value = line.quantity;
        qtyCell.font = { name: "Arial", size: 9, bold: true };
        qtyCell.alignment = { horizontal: "center", vertical: "top" };

        const unitCell = row.getCell(3);
        unitCell.value = upper(line.unit) || "PCS";
        unitCell.font = { name: "Arial", size: 9, bold: true };
        unitCell.alignment = { horizontal: "center", vertical: "top" };

        const descCell = row.getCell(4);
        descCell.value = upper(line.description);
        descCell.font = { name: "Arial", size: 8, bold: true };
        descCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };

        if (input.priced) {
          const unitPriceCell = row.getCell(5);
          unitPriceCell.value = line.unitPrice ?? 0;
          unitPriceCell.font = { name: "Arial", size: 9, bold: true };
          unitPriceCell.alignment = { horizontal: "right", vertical: "top" };
          unitPriceCell.numFmt = "#,##0.00";

          const amountCell = row.getCell(6);
          amountCell.value = line.lineTotal ?? 0;
          amountCell.font = { name: "Arial", size: 9, bold: true };
          amountCell.alignment = { horizontal: "right", vertical: "top" };
          amountCell.numFmt = "#,##0.00";
        }
      },
    });
  });

  if (input.priced) {
    rows.push(
      {
        topPt: inToPt(6.58 + vOffsetIn + lineVOffsetIn),
        heightPt: inToPt(0.24),
        render: (row) => {
          const labelCell = row.getCell(5);
          labelCell.value = "SUBTOTAL";
          labelCell.font = { name: "Arial", size: 8, bold: true };
          labelCell.alignment = { horizontal: "right", vertical: "top" };

          const valCell = row.getCell(6);
          valCell.value = input.lineSubtotal ?? input.totalAmount ?? 0;
          valCell.font = { name: "Arial", size: 9, bold: true };
          valCell.alignment = { horizontal: "right", vertical: "top" };
          valCell.numFmt = "#,##0.00";
        },
      },
      {
        topPt: inToPt(6.82 + vOffsetIn + lineVOffsetIn),
        heightPt: inToPt(0.24),
        render: (row) => {
          const valCell = row.getCell(6);
          valCell.value = input.vatAmount ?? 0;
          valCell.font = { name: "Arial", size: 9, bold: true };
          valCell.alignment = { horizontal: "right", vertical: "top" };
          valCell.numFmt = "#,##0.00";
        },
      },
      {
        topPt: inToPt(7.06 + vOffsetIn + lineVOffsetIn),
        heightPt: inToPt(0.24),
        render: (row) => {
          const valCell = row.getCell(6);
          valCell.value = input.totalAmount ?? 0;
          valCell.font = { name: "Arial", size: 9, bold: true };
          valCell.alignment = { horizontal: "right", vertical: "top" };
          valCell.numFmt = "#,##0.00";
        },
      },
    );
  }

  renderPositionedRows(ws, rows);

  const buffer = await wb.xlsx.writeBuffer();
  downloadWorkbookBuffer(buffer, `${input.jobNumber || "delivery-receipt"}.xlsx`);
}
