import * as XLSX from "xlsx";

export const PENDING_EXPENSE_HEADERS = [
  "Expense date",
  "Description",
  "Amount",
  "Expense type",
  "Job Order number",
  "Supplier/payee",
  "Due date",
  "Category",
  "Subcategory",
  "Payment source",
  "Quantity",
  "Unit",
  "Unit cost",
  "Supplier document number",
  "Supplier TIN",
  "Supplier address",
  "No receipt reason",
  "Remarks",
] as const;

export type PendingExpenseImportRow = {
  rowNumber: number;
  expense_date: string;
  description: string;
  amount: number;
  expense_type: string;
  job_number: string;
  supplier_name: string;
  due_date: string;
  disbursement_category: string;
  disbursement_subcategory: string;
  payment_source: string;
  quantity: number | null;
  unit_of_measure: string;
  unit_cost: number | null;
  supplier_document_no: string;
  supplier_tin: string;
  supplier_address: string;
  receipt_missing_reason: string;
  remarks: string;
  errors: string[];
  duplicate: boolean;
  job_order_id: string | null;
  source_image_data?: string;
  source_image_name?: string;
};

const VALID_TYPES = new Set(["materials", "labor", "delivery", "installation", "outsourcing", "miscellaneous"]);
const VALID_CATEGORIES = new Set(["direct_materials", "petty_cash", "communication", "representation", "commission", "utilities", "salary_and_wages", "security_expenses", "efps", "egov", "other"]);

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizedHeader(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function number(value: unknown) {
  const parsed = Number(text(value).replace(/[,₱]/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeDate(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString().slice(0, 10);
}

function parseRows(rows: unknown[][]): PendingExpenseImportRow[] {
  const [headerRow, ...dataRows] = rows;
  const headers = (headerRow ?? []).map(normalizedHeader);
  const index = (...names: string[]) => {
    for (const name of names) {
      const found = headers.indexOf(normalizedHeader(name));
      if (found >= 0) return found;
    }
    return -1;
  };
  const value = (row: unknown[], ...names: string[]) => {
    const position = index(...names);
    return position >= 0 ? row[position] : "";
  };
  const isLegacyCashDisbursement =
    index("DATE") >= 0 && index("FULL COMPANY NAME") >= 0 && index("TOTAL WITH VAT") >= 0;
  let previousDate = "";

  return dataRows
    .map((row, offset) => {
      const rawDate = value(row, "Expense date", "DATE");
      const normalizedRawDate = normalizeDate(rawDate);
      const hasUsableDate = /^\d{4}-\d{2}-\d{2}$/.test(normalizedRawDate);
      const expenseDate = hasUsableDate
        ? normalizedRawDate
        : !text(rawDate) && isLegacyCashDisbursement
          ? previousDate
          : normalizedRawDate;
      if (hasUsableDate) previousDate = normalizedRawDate;
      const description = text(value(row, "Description", "PETTY CASH", "FULL COMPANY NAME"));
      const amount = isLegacyCashDisbursement
        ? number(value(row, "TOTAL WITH VAT"))
        : number(value(row, "Amount", "TOTAL WITH VAT"));
      const quantityValue = text(value(row, "Quantity"));
      const unitCostValue = text(value(row, "Unit cost"));
      const inferredType = /lalamove|grab|joyride|transportify|transfortify|transpo|truck|delivery/i.test(description)
        ? "delivery"
        : "miscellaneous";
      const item: PendingExpenseImportRow = {
        rowNumber: offset + 2,
        expense_date: expenseDate,
        description,
        amount,
        expense_type: text(value(row, "Expense type")).toLowerCase() || inferredType,
        job_number: text(value(row, "Job Order number")),
        supplier_name: text(value(row, "Supplier/payee", "FULL COMPANY NAME")),
        due_date: normalizeDate(value(row, "Due date")),
        disbursement_category: text(value(row, "Category")),
        disbursement_subcategory: text(value(row, "Subcategory")),
        payment_source: text(value(row, "Payment source")),
        quantity: quantityValue ? number(quantityValue) : null,
        unit_of_measure: text(value(row, "Unit")),
        unit_cost: unitCostValue ? number(unitCostValue) : null,
        supplier_document_no: text(value(row, "Supplier document number", "CV")),
        supplier_tin: text(value(row, "Supplier TIN", "TIN NUMBER")),
        supplier_address: text(value(row, "Supplier address", "ADDRESS")),
        receipt_missing_reason: text(value(row, "No receipt reason")),
        remarks: text(value(row, "Remarks")),
        errors: [],
        duplicate: false,
        job_order_id: null,
      };
      const today = new Date().toISOString().slice(0, 10);
      if (!item.expense_date) item.errors.push("Expense date is required");
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(item.expense_date)) item.errors.push("Invalid expense date");
      else if (item.expense_date > today) item.errors.push("Expense date cannot be in the future");
      if (!item.description) item.errors.push("Description is required");
      if (!Number.isFinite(item.amount) || item.amount <= 0) item.errors.push("Amount must be greater than zero");
      if (!VALID_TYPES.has(item.expense_type)) item.errors.push("Invalid expense type");
      if (item.disbursement_category && !VALID_CATEGORIES.has(item.disbursement_category)) item.errors.push("Invalid category");
      if (item.disbursement_category === "direct_materials" && (!item.supplier_name || !item.supplier_tin || !item.supplier_address)) item.errors.push("Direct materials need supplier, TIN, and address");
      if (item.due_date && (!/^\d{4}-\d{2}-\d{2}$/.test(item.due_date) || item.due_date < item.expense_date)) {
        item.errors.push("Due date cannot be before the expense date");
      }
      if (item.expense_type === "materials") {
        if (item.quantity === null || !Number.isFinite(item.quantity) || item.quantity <= 0) item.errors.push("Quantity must be greater than zero for materials");
        if (!item.unit_of_measure) item.errors.push("Unit is required for materials");
        if (item.unit_cost === null || !Number.isFinite(item.unit_cost) || item.unit_cost <= 0) item.errors.push("Unit cost must be greater than zero for materials");
      }
      return item;
    })
    .filter((row) => {
      const summaryRow = /^(petty cash\s*\(|total$|cash balance$)/i.test(row.description);
      return !summaryRow && Boolean(row.expense_date) && row.description && Number.isFinite(row.amount);
    });
}

export async function parsePendingExpenseFile(file: File) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, bookFiles: true });
  if (workbook.SheetNames.length === 0) throw new Error("The file has no worksheet.");
  return workbook.SheetNames.flatMap((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    let rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
    const headerRowIndex = rows.findIndex((row) => {
      const headers = row.map(normalizedHeader);
      return headers.includes("date") && (headers.includes("amount") || headers.includes("pettycash"));
    });
    if (headerRowIndex > 0) rows = rows.slice(headerRowIndex);
    const headers = (rows[0] ?? []).map(normalizedHeader);
    const dateColumn = headers.indexOf(normalizedHeader("DATE"));
    const isLegacy = headers.includes(normalizedHeader("FULL COMPANY NAME")) && dateColumn >= 0;
    if (isLegacy) {
      const hasUsableDate = rows.slice(1).some((row) => /^\d{4}-\d{2}-\d{2}$/.test(normalizeDate(row[dateColumn])));
      if (!hasUsableDate) return [];
    }
    const parsed = parseRows(rows);
    const mediaKey = Object.keys((workbook as any).files ?? {}).find((key) => /^xl\/media\//i.test(key));
    const media = mediaKey ? (workbook as any).files[mediaKey] : null;
    if (parsed.length && media?.content) {
      const bytes = media.content instanceof Uint8Array ? media.content : new Uint8Array(media.content);
      let binary = "";
      bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
      parsed[0].source_image_data = `data:${media.type || "image/jpeg"};base64,${btoa(binary)}`;
      parsed[0].source_image_name = mediaKey.split("/").pop();
    }
    return isLegacy ? parsed.filter((row) => row.description && Number.isFinite(row.amount) && row.amount > 0) : parsed;
  });
}

export function pendingExpenseTemplateCsv() {
  return `${PENDING_EXPENSE_HEADERS.join(",")}\r\n`;
}

export function rejectedExpenseCsv(rows: PendingExpenseImportRow[]) {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    ["Row", "Description", "Amount", "Reason"].join(","),
    ...rows.map((row) => [row.rowNumber, row.description, row.amount, row.errors.join("; ")].map(escape).join(",")),
  ].join("\r\n");
}
