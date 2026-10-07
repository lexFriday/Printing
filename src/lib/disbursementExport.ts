import {
  categoryLabel,
  subcategoryLabel,
  type DisbursementCategory,
  type DisbursementSubcategory,
} from "./financeCategories";

export type DisbursementExportRow = {
  expense_date: string;
  reference_no: string | null;
  supplier_name: string | null;
  description: string;
  disbursement_category: DisbursementCategory | null;
  disbursement_subcategory: DisbursementSubcategory | null;
  supplier_document_no: string | null;
  check_number: string | null;
  check_date: string | null;
  supplier_tin: string | null;
  supplier_address: string | null;
  amount: number;
  tax_amount: number;
};

const HEADERS = [
  "DATE",
  "CV",
  "FULL COMPANY NAME",
  "DETAILS",
  "TOTAL WITH VAT",
  "AMOUNT",
  "VAT 12%",
  "TOTAL OUTPUT VAT",
  "EWT",
  "NON VAT",
  "TIN NUMBER",
  "ADDRESS",
];

export function buildDisbursementCsv(rows: DisbursementExportRow[]) {
  return [
    HEADERS.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.expense_date,
        row.reference_no,
        row.supplier_name || categoryLabel(row.disbursement_category),
        row.description || subcategoryLabel(row.disbursement_subcategory),
        money(totalWithVat(row)),
        money(row.amount),
        money(row.tax_amount),
        "",
        "",
        row.tax_amount > 0 ? "" : money(row.amount),
        row.supplier_tin,
        row.supplier_address,
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\r\n");
}

function money(value: number) {
  return value.toFixed(2);
}

function totalWithVat(row: DisbursementExportRow) {
  return Number(row.amount || 0) + Number(row.tax_amount || 0);
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
