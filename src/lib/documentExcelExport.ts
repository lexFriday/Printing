import type ExcelJS from "exceljs";
import { COMPANY_PROFILE } from "./brand";
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
  clientPoNumber?: string | null;
  projectName?: string | null;
  priced: boolean;
  includePo: boolean;
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice?: number;
    lineTotal?: number;
  }>;
  totalAmount?: number;
}

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFCBD5E1" } },
  left: { style: "thin", color: { argb: "FFCBD5E1" } },
  bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
  right: { style: "thin", color: { argb: "FFCBD5E1" } },
};

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE8EEF5" },
};

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

function addDocumentHeader(
  ws: ExcelJS.Worksheet,
  colCount: number,
  title: string,
  subtitle: string,
) {
  const endCol = String.fromCharCode(64 + colCount);
  ws.mergeCells(`A1:${endCol}1`);
  const companyCell = ws.getCell("A1");
  companyCell.value = COMPANY_PROFILE.name.toUpperCase();
  companyCell.font = { name: "Arial", size: 13, bold: true };
  companyCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 22;

  ws.mergeCells(`A2:${endCol}2`);
  const addressCell = ws.getCell("A2");
  addressCell.value = `${COMPANY_PROFILE.address} · TIN ${COMPANY_PROFILE.tin}`;
  addressCell.font = { name: "Arial", size: 9, color: { argb: "FF475569" } };
  addressCell.alignment = { horizontal: "center", vertical: "middle" };

  ws.mergeCells(`A3:${endCol}3`);
  const titleCell = ws.getCell("A3");
  titleCell.value = title;
  titleCell.font = { name: "Arial", size: 12, bold: true, color: { argb: "FF1E293B" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(3).height = 22;

  ws.mergeCells(`A4:${endCol}4`);
  const subCell = ws.getCell("A4");
  subCell.value = subtitle;
  subCell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF334155" } };
  subCell.alignment = { horizontal: "center", vertical: "middle" };
}

function addMetaPairs(
  ws: ExcelJS.Worksheet,
  pairs: Array<[string, string]>,
  colCount: number,
) {
  const endCol = String.fromCharCode(64 + colCount);
  ws.addRow([]);
  for (const [label, value] of pairs) {
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { name: "Arial", size: 9, bold: true, color: { argb: "FF475569" } };
    row.getCell(2).font = { name: "Arial", size: 10 };
    if (colCount > 2) {
      ws.mergeCells(`B${row.number}:${endCol}${row.number}`);
    }
    row.getCell(2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  }
  ws.addRow([]);
}

function styleTableHeader(row: ExcelJS.Row, rightAlignedCols: number[]) {
  row.height = 22;
  row.eachCell((cell, colNumber) => {
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF0F172A" } };
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
    cell.alignment = {
      horizontal: rightAlignedCols.includes(colNumber) ? "right" : "left",
      vertical: "middle",
    };
  });
}

export async function downloadSalesInvoiceExcel(input: SalesInvoiceExcelInput) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sales Invoice", {
    pageSetup: { paperSize: 1, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.columns = [
    { width: 10 },
    { width: 12 },
    { width: 46 },
    { width: 16 },
    { width: 18 },
  ];

  const isVatable = input.taxType === "vatable";
  addDocumentHeader(
    ws,
    5,
    "SALES INVOICE",
    `${input.invoiceNumber} · ${fmtDate(input.invoiceDate)} · ${isVatable ? "VATABLE" : "NON-VAT"}`,
  );

  addMetaPairs(
    ws,
    [
      ["Sold to", input.customerName || "—"],
      ["TIN", input.customerTin || "—"],
      ["Address", input.customerAddress || "—"],
      ...(input.projectName ? [["Project", input.projectName] as [string, string]] : []),
      ...(input.clientPoNumber ? [["PO Number", input.clientPoNumber] as [string, string]] : []),
    ],
    5,
  );

  const headerRow = ws.addRow(["QTY", "UNIT", "DESCRIPTION", "UNIT PRICE", "AMOUNT"]);
  styleTableHeader(headerRow, [1, 4, 5]);

  for (const line of input.lines) {
    const row = ws.addRow([
      line.quantity,
      line.unit || "",
      line.description,
      line.unitPrice,
      line.lineTotal,
    ]);
    row.eachCell((cell, col) => {
      cell.font = { name: "Arial", size: 10 };
      cell.border = THIN_BORDER;
      cell.alignment = {
        horizontal: col === 1 || col >= 4 ? "right" : "left",
        vertical: "top",
        wrapText: true,
      };
      if (col === 4 || col === 5) cell.numFmt = "#,##0.00";
    });
  }

  ws.addRow([]);

  const summaryRows: Array<[string, number, boolean]> = [
    ["Total Sales", input.grossTotal, false],
    ...(isVatable
      ? ([
          ["VATable Sales", input.vatableSales, false],
          ["12% VAT", input.vatAmount, false],
        ] as Array<[string, number, boolean]>)
      : []),
    ...(input.ewtEnabled
      ? ([
          [
            input.ewtTreatment === "deducted_from_amount_due" ? "Less: EWT" : "EWT",
            input.ewtAmount,
            false,
          ],
        ] as Array<[string, number, boolean]>)
      : []),
    ["Total Amount Due", input.amountDue, true],
  ];

  for (const [label, amount, bold] of summaryRows) {
    const row = ws.addRow(["", "", "", label, amount]);
    const labelCell = row.getCell(4);
    const valCell = row.getCell(5);
    labelCell.font = { name: "Arial", size: 10, bold: true };
    labelCell.alignment = { horizontal: "right", vertical: "middle" };
    labelCell.border = THIN_BORDER;
    if (bold) labelCell.fill = HEADER_FILL;

    valCell.numFmt = "#,##0.00";
    valCell.font = { name: "Arial", size: bold ? 11 : 10, bold };
    valCell.alignment = { horizontal: "right", vertical: "middle" };
    valCell.border = THIN_BORDER;
    if (bold) valCell.fill = HEADER_FILL;
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

  const colCount = input.priced ? 5 : 3;
  ws.columns = input.priced
    ? [
        { width: 10 },
        { width: 12 },
        { width: 46 },
        { width: 16 },
        { width: 18 },
      ]
    : [{ width: 10 }, { width: 14 }, { width: 62 }];

  const poValue = input.includePo ? input.clientPoNumber || input.quoteNumber : null;
  addDocumentHeader(
    ws,
    colCount,
    "DELIVERY RECEIPT",
    `${input.jobNumber} · ${fmtDate(input.date)}`,
  );

  addMetaPairs(
    ws,
    [
      ["Delivered to", input.customerName || "—"],
      ["TIN", input.customerTin || "—"],
      ["Address", input.customerAddress || "—"],
      ...(input.projectName ? [["Project", input.projectName] as [string, string]] : []),
      ...(poValue ? [["PO / Ref", poValue] as [string, string]] : []),
    ],
    colCount,
  );

  const headers = input.priced
    ? ["ITEM", "QTY", "DESCRIPTION", "UNIT PRICE", "AMOUNT"]
    : ["ITEM", "QTY", "DESCRIPTION"];
  const headerRow = ws.addRow(headers);
  styleTableHeader(headerRow, input.priced ? [2, 4, 5] : [2]);

  input.lines.forEach((line, idx) => {
    const rowValues = input.priced
      ? [idx + 1, line.quantity, line.description, line.unitPrice ?? 0, line.lineTotal ?? 0]
      : [idx + 1, line.quantity, line.description];
    const row = ws.addRow(rowValues);
    row.eachCell((cell, col) => {
      cell.font = { name: "Arial", size: 10 };
      cell.border = THIN_BORDER;
      cell.alignment = {
        horizontal: col === 1 ? "center" : col === 2 || col >= 4 ? "right" : "left",
        vertical: "top",
        wrapText: true,
      };
      if (col === 4 || col === 5) cell.numFmt = "#,##0.00";
    });
  });

  if (input.priced && input.totalAmount !== undefined) {
    ws.addRow([]);
    const totalRow = ws.addRow(["", "", "", "TOTAL", input.totalAmount]);
    totalRow.getCell(4).font = { name: "Arial", size: 10, bold: true };
    totalRow.getCell(4).alignment = { horizontal: "right", vertical: "middle" };
    totalRow.getCell(4).border = THIN_BORDER;
    totalRow.getCell(4).fill = HEADER_FILL;
    totalRow.getCell(5).numFmt = "#,##0.00";
    totalRow.getCell(5).font = { name: "Arial", size: 11, bold: true };
    totalRow.getCell(5).alignment = { horizontal: "right", vertical: "middle" };
    totalRow.getCell(5).border = THIN_BORDER;
    totalRow.getCell(5).fill = HEADER_FILL;
  }

  ws.addRow([]);
  const sigRow = ws.addRow(["", "", "Received in good order and condition by: ___________________________   Date: ____________"]);
  sigRow.getCell(3).font = { name: "Arial", size: 9, italic: true, color: { argb: "FF475569" } };

  const buffer = await wb.xlsx.writeBuffer();
  downloadWorkbookBuffer(buffer, `${input.jobNumber || "delivery-receipt"}-DR.xlsx`);
}
