import * as XLSX from "xlsx";

type InvoiceExcelLine = {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

type InvoiceExcelData = {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerAddress: string;
  customerTin: string;
  clientPoNumber: string;
  taxType: string;
  lines: InvoiceExcelLine[];
  grossTotal: number;
  vatableSales: number;
  vatAmount: number;
  ewtAmount: number;
  amountDue: number;
};

const TEMPLATE_URL = "/invoice-template.xlsx";
const LINE_START_ROW = 22;
const LINE_END_ROW = 29;

export async function downloadInvoiceExcel(data: InvoiceExcelData) {
  const response = await fetch(TEMPLATE_URL);
  if (!response.ok) throw new Error("Invoice Excel template could not be loaded.");

  const workbook = XLSX.read(await response.arrayBuffer(), { type: "array", cellStyles: true });
  const sheetName = data.taxType === "vatable" ? "Service Invoice VAT INC" : "Service Invoice VAT EX";
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Invoice template sheet \"${sheetName}\" was not found.`);

  const clear = (cell: string) => {
    if (!sheet[cell]) return;
    const previous = sheet[cell];
    delete previous.v;
    delete previous.f;
    delete previous.F;
    previous.t = "s";
  };
  ["B9", "F8", "F10", "A11", "B13", "A13", "A14", "A15", "A16", "A17", "A18", "A19", "A20", "A21", "A22", "A23", "A24", "A25", "A26", "A27", "A28", "A29", "A30"].forEach(clear);
  for (let row = LINE_START_ROW; row <= LINE_END_ROW; row += 1) {
    ["A", "E", "F", "G"].forEach((column) => clear(`${column}${row}`));
  }

  const set = (cell: string, value: string | number | Date | null | undefined) => {
    sheet[cell] = {
      ...(sheet[cell] ?? {}),
      v: value ?? "",
      t: typeof value === "number" ? "n" : value instanceof Date ? "d" : "s",
    };
  };

  set("F8", data.invoiceDate ? new Date(`${data.invoiceDate}T00:00:00`) : "");
  sheet.F8.t = "d";
  set("B9", data.customerName);
  set("F10", `CE/PO: ${data.clientPoNumber || "—"}`);
  set("A11", data.customerTin);
  set("B13", data.customerAddress);
  set("A18", `INVOICE NO. ${data.invoiceNumber}`);

  for (let row = LINE_START_ROW; row <= LINE_END_ROW; row += 1) {
    const line = data.lines[row - LINE_START_ROW];
    set(`A${row}`, line?.description ?? "");
    set(`E${row}`, line?.quantity ?? "");
    set(`F${row}`, line?.unit_price ?? "");
    set(`G${row}`, line?.line_total ?? "");
  }

  set("G30", data.vatableSales || data.grossTotal);
  set("G32", data.vatAmount);
  set("G33", data.ewtAmount ? -Math.abs(data.ewtAmount) : "");
  set("G34", data.amountDue || data.grossTotal);

  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
  const blob = new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${data.invoiceNumber || "invoice"}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
