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

function upper(value?: string | null): string {
  return (value ?? "").trim().toUpperCase();
}

export async function downloadSalesInvoiceExcel(input: SalesInvoiceExcelInput) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sales Invoice", {
    pageSetup: { paperSize: 1, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  // Match ServiceInvoiceForm columns: Description | Qty | Unit Price | Amount
  ws.columns = [{ width: 44 }, { width: 8 }, { width: 14 }, { width: 16 }];

  const dateRow = ws.addRow(["", "", "", fmtDate(input.invoiceDate).toUpperCase()]);
  dateRow.getCell(4).font = { name: "Arial", size: 10, bold: true };
  dateRow.getCell(4).alignment = { horizontal: "right", vertical: "middle" };

  const soldToRow = ws.addRow([upper(input.customerName)]);
  soldToRow.getCell(1).font = { name: "Arial", size: 9, bold: true };

  const projectOrCustomer = upper(input.projectName) || upper(input.customerName);
  const poRow = ws.addRow([projectOrCustomer]);
  poRow.getCell(1).font = { name: "Arial", size: 8, bold: true };
  poRow.getCell(1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  if (input.clientPoNumber) {
    const poCell = poRow.getCell(4);
    poCell.value = {
      richText: [
        { text: "CE/P.O NO: ", font: { name: "Arial", size: 9, bold: true, color: { argb: "FF000000" } } },
        { text: upper(input.clientPoNumber), font: { name: "Arial", size: 9, bold: true, color: { argb: "FFDC2626" } } },
      ],
    };
    poCell.alignment = { horizontal: "right", vertical: "middle" };
  }

  const tinRow = ws.addRow([upper(input.customerTin)]);
  tinRow.getCell(1).font = { name: "Arial", size: 9, bold: true };

  const addrRow = ws.addRow([upper(input.customerAddress)]);
  addrRow.getCell(1).font = { name: "Arial", size: 8, bold: true };
  addrRow.getCell(1).alignment = { horizontal: "left", vertical: "top", wrapText: true };

  ws.addRow([]);

  for (const line of input.lines) {
    if (line.description === "[BLANK_LINE]") continue;
    const row = ws.addRow([upper(line.description), line.quantity, line.unitPrice, line.lineTotal]);
    row.getCell(1).font = { name: "Arial", size: 9, bold: true };
    row.getCell(1).alignment = { horizontal: "left", vertical: "top", wrapText: true };
    row.getCell(2).font = { name: "Arial", size: 10, bold: true };
    row.getCell(2).alignment = { horizontal: "right", vertical: "top" };
    row.getCell(3).font = { name: "Arial", size: 10, bold: true };
    row.getCell(3).alignment = { horizontal: "right", vertical: "top" };
    row.getCell(3).numFmt = "#,##0.00";
    row.getCell(4).font = { name: "Arial", size: 10, bold: true };
    row.getCell(4).alignment = { horizontal: "right", vertical: "top" };
    row.getCell(4).numFmt = "#,##0.00";
  }

  ws.addRow([]);

  const isVatable = input.taxType === "vatable";
  const showEwt = input.ewtEnabled && input.ewtAmount > 0;
  const finalAmount = showEwt ? Math.max(input.grossTotal - input.ewtAmount, 0) : input.amountDue;

  // Match the 7 pre-printed total slots in ServiceInvoiceForm (no labels, values only)
  const totalSlots: Array<{ value: number | ""; size?: number }> = [
    { value: input.grossTotal },
    { value: isVatable ? input.vatAmount : "" },
    { value: isVatable ? input.vatableSales : input.amountDue },
    { value: "" },
    { value: isVatable ? input.vatAmount : "" },
    { value: showEwt ? input.ewtAmount : "" },
    { value: finalAmount, size: 11 },
  ];

  for (const slot of totalSlots) {
    const row = ws.addRow(["", "", "", slot.value]);
    const cell = row.getCell(4);
    cell.font = { name: "Arial", size: slot.size ?? 10, bold: true };
    cell.alignment = { horizontal: "right", vertical: "middle" };
    if (typeof slot.value === "number") cell.numFmt = "#,##0.00";
  }

  const buffer = await wb.xlsx.writeBuffer();
  downloadWorkbookBuffer(buffer, `${input.invoiceNumber || "sales-invoice"}.xlsx`);
}

export async function downloadDeliveryReceiptExcel(input: DeliveryReceiptExcelInput) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Delivery Receipt", {
    pageSetup: { paperSize: 1, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  // Match DeliveryReceiptForm columns: Qty | Unit | Description | Unit Price | Amount
  ws.columns = [{ width: 8 }, { width: 10 }, { width: 34 }, { width: 12 }, { width: 14 }];

  const dateRow = ws.addRow(["", "", "", "", fmtDate(input.date).toUpperCase()]);
  dateRow.getCell(5).font = { name: "Arial", size: 9, bold: true };
  dateRow.getCell(5).alignment = { horizontal: "right", vertical: "middle" };

  const custRow = ws.addRow([upper(input.customerName)]);
  custRow.getCell(1).font = { name: "Arial", size: 9, bold: true };

  const tinTermsRow = ws.addRow([upper(input.customerTin), "", "", "", upper(input.terms)]);
  tinTermsRow.getCell(1).font = { name: "Arial", size: 9, bold: true };
  tinTermsRow.getCell(5).font = { name: "Arial", size: 8, bold: true };
  tinTermsRow.getCell(5).alignment = { horizontal: "right", vertical: "middle" };

  const poValue = input.includePo ? upper(input.quoteNumber || input.clientPoNumber) : "";
  const addrPoRow = ws.addRow([upper(input.customerAddress), "", "", "", poValue]);
  addrPoRow.getCell(1).font = { name: "Arial", size: 8, bold: true };
  addrPoRow.getCell(1).alignment = { horizontal: "left", vertical: "top", wrapText: true };
  addrPoRow.getCell(5).font = { name: "Arial", size: 9, bold: true };
  addrPoRow.getCell(5).alignment = { horizontal: "right", vertical: "middle" };

  ws.addRow([]);

  for (const line of input.lines) {
    const values = input.priced
      ? [
          line.quantity,
          upper(line.unit) || "PCS",
          upper(line.description),
          line.unitPrice ?? 0,
          line.lineTotal ?? 0,
        ]
      : [line.quantity, upper(line.unit) || "PCS", upper(line.description)];
    const row = ws.addRow(values);
    row.getCell(1).font = { name: "Arial", size: 9, bold: true };
    row.getCell(1).alignment = { horizontal: "center", vertical: "top" };
    row.getCell(2).font = { name: "Arial", size: 9, bold: true };
    row.getCell(2).alignment = { horizontal: "center", vertical: "top" };
    row.getCell(3).font = { name: "Arial", size: 8, bold: true };
    row.getCell(3).alignment = { horizontal: "left", vertical: "top", wrapText: true };
    if (input.priced) {
      row.getCell(4).font = { name: "Arial", size: 9, bold: true };
      row.getCell(4).alignment = { horizontal: "right", vertical: "top" };
      row.getCell(4).numFmt = "#,##0.00";
      row.getCell(5).font = { name: "Arial", size: 9, bold: true };
      row.getCell(5).alignment = { horizontal: "right", vertical: "top" };
      row.getCell(5).numFmt = "#,##0.00";
    }
  }

  if (input.priced) {
    ws.addRow([]);
    const subtotalRow = ws.addRow(["", "", "", "SUBTOTAL", input.lineSubtotal ?? input.totalAmount ?? 0]);
    subtotalRow.getCell(4).font = { name: "Arial", size: 8, bold: true };
    subtotalRow.getCell(4).alignment = { horizontal: "right", vertical: "middle" };
    subtotalRow.getCell(5).font = { name: "Arial", size: 9, bold: true };
    subtotalRow.getCell(5).alignment = { horizontal: "right", vertical: "middle" };
    subtotalRow.getCell(5).numFmt = "#,##0.00";

    const vatRow = ws.addRow(["", "", "", "", input.vatAmount ?? 0]);
    vatRow.getCell(5).font = { name: "Arial", size: 9, bold: true };
    vatRow.getCell(5).alignment = { horizontal: "right", vertical: "middle" };
    vatRow.getCell(5).numFmt = "#,##0.00";

    const totalRow = ws.addRow(["", "", "", "", input.totalAmount ?? 0]);
    totalRow.getCell(5).font = { name: "Arial", size: 9, bold: true };
    totalRow.getCell(5).alignment = { horizontal: "right", vertical: "middle" };
    totalRow.getCell(5).numFmt = "#,##0.00";
  }

  const buffer = await wb.xlsx.writeBuffer();
  downloadWorkbookBuffer(buffer, `${input.jobNumber || "delivery-receipt"}.xlsx`);
}
