import {
  buildCashSalesWorkbookBlob,
  buildDisbursementWorkbookBlob,
  buildWorkbookParts,
} from "./excelExport.ts";

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const parts = buildWorkbookParts([
  {
    name: "JAN 2026",
    widths: [12, 16],
    rows: [
      ["OR", "DATE"],
      ["OR-001", "2026-01-05"],
    ],
  },
]);
const workbookXml = parts.find((part) => part.path === "xl/workbook.xml")?.xml ?? "";
const sheetXml = parts.find((part) => part.path === "xl/worksheets/sheet1.xml")?.xml ?? "";

check(workbookXml.includes('name="JAN 2026"'), "uses monthly sheet names");
check(sheetXml.includes("<t>OR</t>"), "writes headers");
check(sheetXml.includes('width="12"'), "writes column widths");

const cashSalesBlob = buildCashSalesWorkbookBlob([
  {
    or_number: "OR-001",
    date: "2026-01-05",
    company: "Sample Customer, Inc.",
    amount_paid: 1000,
    invoice: "INV-001",
    input_vat: 892.86,
    ewt: 17.86,
    tin: "000-000-000-000",
    address: "Sample Address",
  },
]);

const disbursementBlob = buildDisbursementWorkbookBlob([
  {
    expense_date: "2026-01-05",
    reference_no: "CV-001",
    supplier_name: "Sample Supplier, Inc.",
    description: "Sample details",
    disbursement_category: "direct_materials",
    disbursement_subcategory: "direct_materials",
    supplier_tin: "000-000-000-000",
    supplier_address: "Sample Address",
    amount: 892.86,
    tax_amount: 107.14,
  },
]);

check(cashSalesBlob.type.includes("spreadsheetml.sheet"), "cash sales is xlsx mime");
check(disbursementBlob.type.includes("spreadsheetml.sheet"), "disbursement is xlsx mime");
check(cashSalesBlob.size > 1000, "cash sales workbook has content");
check(disbursementBlob.size > 1000, "disbursement workbook has content");

const cashSalesParts = buildWorkbookParts([
  {
    name: "JAN. 2026",
    widths: [12],
    rows: [["OR"]],
  },
]);
check(
  (cashSalesParts.find((part) => part.path === "xl/workbook.xml")?.xml ?? "").includes(
    'name="JAN. 2026"',
  ),
  "supports cash sales month naming",
);
