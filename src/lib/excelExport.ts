import {
  categoryLabel,
  subcategoryLabel,
  type DisbursementCategory,
  type DisbursementSubcategory,
} from "./financeCategories";

export type ExcelCell = string | number | null | undefined;

export type CashSalesWorkbookRow = {
  or_number: string | number | null;
  date: string;
  company: string | null;
  amount_paid: number;
  invoice: string | number | null;
  input_vat: number;
  ewt: number;
  tin: string | null;
  address: string | null;
};

export type DisbursementWorkbookRow = {
  expense_date: string;
  reference_no: string | null;
  supplier_name: string | null;
  description: string;
  disbursement_category: DisbursementCategory | null;
  disbursement_subcategory: DisbursementSubcategory | null;
  supplier_tin: string | null;
  supplier_address: string | null;
  amount: number;
  tax_amount: number;
  job_number?: string | null;
  project_name?: string | null;
  supplier_document_no?: string | null;
  check_number?: string | null;
};

export type PettyCashWorkbookRow = {
  date: string;
  type: string;
  description: string;
  category: string;
  job_number: string;
  project_name: string;
  supplier_name: string;
  tax_amount: number;
  money_in: number;
  money_out: number;
  running_balance: number;
};

type SheetSpec = {
  name: string;
  rows: ExcelCell[][];
  widths: number[];
};

const CASH_SALES_HEADERS = [
  "OR",
  "DATE",
  "COMPANY",
  "AMOUNT PAID",
  "INVOICE",
  "INPUT VAT",
  "EWT",
  "TIN",
  "ADDRESS",
];

const DISBURSEMENT_HEADERS = [
  "DATE ",
  "CV",
  "FULL COMPANY NAME",
  "",
  "TOTAL WITH VAT ",
  "AMOUNT ",
  "VAT 12%",
  "TOTAL OUTPUT VAT ",
  "EWT",
  "NON VAT",
  "TIN NUMBER ",
  "ADDRESS",
];

const CASH_SALES_WIDTHS = [12, 16, 38, 16, 18, 16, 12, 18, 56];
const DISBURSEMENT_WIDTHS = [14, 10, 34, 24, 16, 14, 12, 18, 12, 12, 20, 56];

export function buildCashSalesWorkbookBlob(rows: CashSalesWorkbookRow[]) {
  return buildWorkbookBlob(
    buildMonthlySheets(rows, (row) => row.date, (monthRows) => [
      CASH_SALES_HEADERS,
      ...monthRows.map((row) => [
        row.or_number,
        row.date,
        row.company,
        row.amount_paid,
        row.invoice,
        row.input_vat,
        row.ewt,
        row.tin,
        row.address,
      ]),
    ], CASH_SALES_WIDTHS, cashSalesMonthSheetName),
  );
}

export function buildDisbursementWorkbookBlob(rows: DisbursementWorkbookRow[]) {
  const details = buildMonthlySheets(rows, (row) => row.expense_date, (monthRows) => [
      DISBURSEMENT_HEADERS,
      ...monthRows.map((row) => [
        row.expense_date,
        row.reference_no,
        row.supplier_name || categoryLabel(row.disbursement_category),
        row.description || subcategoryLabel(row.disbursement_subcategory),
        row.amount + row.tax_amount,
        row.amount,
        row.tax_amount,
        "",
        "",
        row.tax_amount > 0 ? "" : row.amount,
        row.supplier_tin,
        row.supplier_address,
      ]),
    ], DISBURSEMENT_WIDTHS, disbursementMonthSheetName);
  const projects = new Map<string, { job: string; project: string; count: number; total: number }>();
  rows.forEach((row) => {
    const key = row.job_number || "general";
    const current = projects.get(key) ?? { job: row.job_number || "General expenses", project: row.project_name || "Not linked to a Job Order", count: 0, total: 0 };
    current.count += 1;
    current.total += Number(row.amount || 0);
    projects.set(key, current);
  });
  const summaryRows: ExcelCell[][] = [
    ["DISBURSEMENT SUMMARY", "", "", ""],
    ["Job Order", "Project", "Expense count", "Total expenses"],
    ...Array.from(projects.values()).map((project) => [project.job, project.project, project.count, project.total]),
    [],
    ["Overall total", "", rows.length, rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)],
  ];
  return buildWorkbookBlob([{ name: "SUMMARY", rows: summaryRows, widths: [24, 48, 16, 18] }, ...details]);
}

export function buildPettyCashWorkbookBlob(rows: PettyCashWorkbookRow[], cashReceived: number) {
  const receiptRows = rows.filter((row) => row.type === "Receipt");
  const projectTotals = new Map<string, { project: string; count: number; total: number }>();
  receiptRows.forEach((row) => {
    const current = projectTotals.get(row.job_number) ?? { project: row.project_name, count: 0, total: 0 };
    current.count += 1;
    current.total += row.money_out;
    projectTotals.set(row.job_number, current);
  });
  const receiptTotal = receiptRows.reduce((sum, row) => sum + row.money_out, 0);
  const summaryRows: ExcelCell[][] = [
    ["PETTY CASH", "", ""],
    ["Cash received", cashReceived, ""],
    ["Receipts recorded", receiptTotal, ""],
    ["Cash balance", cashReceived - receiptTotal, ""],
    [],
    ["DATE", "PETTY CASH", "AMOUNT"],
    ...receiptRows.map((row) => [row.date, row.description, row.money_out]),
    [],
    ["Total", "", receiptTotal],
    ["Petty Cash", "", cashReceived],
    ["Cash Balance", "", cashReceived - receiptTotal],
  ];
  const projectRows: ExcelCell[][] = [["Job Order", "Project", "Receipt count", "Total expenses"], ...Array.from(projectTotals, ([job, value]) => [job, value.project, value.count, value.total])];
  const detailRows: ExcelCell[][] = [["Date", "Type", "Description / supplier", "Category", "Job Order", "Project", "Tax", "Money in", "Money out", "Running balance"], ...rows.map((row) => [row.date, row.type, row.description, row.category, row.job_number, row.project_name, row.tax_amount, row.money_in, row.money_out, row.running_balance])];
  return buildWorkbookBlob([
    { name: "PETTY CASH", rows: summaryRows, widths: [18, 64, 18] },
    { name: "BY PROJECT", rows: projectRows, widths: [24, 48, 16, 18] },
    { name: "TRANSACTIONS", rows: detailRows, widths: [16, 16, 54, 20, 24, 42, 14, 16, 16, 18] },
  ]);
}

export function buildWorkbookParts(sheets: SheetSpec[]) {
  const normalizedSheets = sheets.length > 0 ? sheets : [{ name: "Sheet1", rows: [[]], widths: [] }];
  const sheetParts = normalizedSheets.map((sheet, index) => ({
    path: `xl/worksheets/sheet${index + 1}.xml`,
    xml: worksheetXml(sheet),
  }));

  return [
    { path: "[Content_Types].xml", xml: contentTypesXml(normalizedSheets.length) },
    { path: "_rels/.rels", xml: rootRelsXml() },
    { path: "xl/workbook.xml", xml: workbookXml(normalizedSheets) },
    { path: "xl/_rels/workbook.xml.rels", xml: workbookRelsXml(normalizedSheets.length) },
    { path: "xl/styles.xml", xml: stylesXml() },
    ...sheetParts,
  ];
}

function buildWorkbookBlob(sheets: SheetSpec[]) {
  const parts = buildWorkbookParts(sheets);
  return new Blob([zip(parts)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function buildMonthlySheets<T>(
  rows: T[],
  dateOf: (row: T) => string,
  rowsForSheet: (rows: T[]) => ExcelCell[][],
  widths: number[],
  sheetNameFor: (date: Date) => string,
) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const date = parseDate(dateOf(row));
    const key = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : "undated";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  if (groups.size === 0) {
    return [{ name: sheetNameFor(new Date()), rows: rowsForSheet([]), widths }];
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, monthRows]) => ({
      name: key === "undated" ? "UNDATED" : sheetNameFor(new Date(`${key}-01T12:00:00+08:00`)),
      rows: rowsForSheet(monthRows),
      widths,
    }));
}

function disbursementMonthSheetName(date: Date) {
  const months = [
    "JAN",
    "FEB",
    "MARCH",
    "APRIL",
    "MAY",
    "JUNE",
    "JULY",
    "AUG",
    "SEPT",
    "OCT",
    "NOV",
    "DEC",
  ];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

function cashSalesMonthSheetName(date: Date) {
  const months = [
    "JAN.",
    "FEB.",
    "MARCH",
    "APRIL",
    "MAY",
    "JUNE",
    "JULY",
    "AUG",
    "SEPT",
    "OCT",
    "NOV",
    "DEC",
  ];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

function worksheetXml(sheet: SheetSpec) {
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const cells = row.map((cell, colIndex) => cellXml(cell, rowIndex + 1, colIndex));
      return `<row r="${rowIndex + 1}">${cells.join("")}</row>`;
    })
    .join("");
  const cols = sheet.widths.length
    ? `<cols>${sheet.widths
        .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  return xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${cols}
  <sheetData>${rows}</sheetData>
</worksheet>`);
}

function cellXml(cell: ExcelCell, rowNumber: number, colIndex: number) {
  const ref = `${columnName(colIndex + 1)}${rowNumber}`;
  const style = rowNumber === 1 ? ' s="1"' : typeof cell === "number" ? ' s="2"' : "";
  if (typeof cell === "number") return `<c r="${ref}"${style}><v>${cell}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${style}><is><t>${escapeXml(cell ?? "")}</t></is></c>`;
}

function workbookXml(sheets: SheetSpec[]) {
  return xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheets
      .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
      .join("")}
  </sheets>
</workbook>`);
}

function workbookRelsXml(sheetCount: number) {
  const sheetRels = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");
  return xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetRels}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
}

function contentTypesXml(sheetCount: number) {
  const sheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets}
</Types>`);
}

function rootRelsXml() {
  return xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
}

function stylesXml() {
  return xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`);
}

function zip(parts: Array<{ path: string; xml: string }>) {
  const encoder = new TextEncoder();
  const files = parts.map((part) => ({ path: part.path, data: encoder.encode(part.xml) }));
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.path);
    const crc = crc32(file.data);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc),
      u32(file.data.length), u32(file.data.length), u16(name.length), u16(0), name, file.data,
    ]);
    chunks.push(local);
    central.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc),
      u32(file.data.length), u32(file.data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length;
  }

  const centralDirectory = concat(central);
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralDirectory.length), u32(offset), u16(0),
  ]);
  return concat([...chunks, centralDirectory, end]);
}

function crc32(bytes: Uint8Array) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function u16(value: number) {
  return new Uint8Array([value & 255, (value >>> 8) & 255]);
}

function u32(value: number) {
  return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
}

function concat(chunks: Uint8Array[]) {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function columnName(columnNumber: number) {
  let name = "";
  for (let n = columnNumber; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(((n - 1) % 26) + 65) + name;
  }
  return name;
}

function parseDate(value: string) {
  const date = new Date(`${value}T12:00:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function escapeXml(value: ExcelCell) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function xml(value: string) {
  return value.replace(/>\s+</g, "><").trim();
}
