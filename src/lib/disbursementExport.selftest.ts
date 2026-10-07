import { buildDisbursementCsv } from "./disbursementExport.ts";

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const csv = buildDisbursementCsv([
  {
    expense_date: "2026-08-13",
    reference_no: "CV-1",
    supplier_name: "ABC SUPPLIER, INC.",
    description: "Sticker rolls",
    disbursement_category: "direct_materials",
    disbursement_subcategory: "direct_materials",
    supplier_document_no: "INV-123",
    check_number: "000123",
    check_date: "2026-08-14",
    supplier_tin: "123-456-789-000",
    supplier_address: "Quezon City",
    amount: 1120,
    tax_amount: 120,
  },
]);

check(csv.startsWith("DATE,CV,FULL COMPANY NAME,DETAILS,TOTAL WITH VAT"), "header order");
check(csv.includes("\"ABC SUPPLIER, INC.\""), "csv escapes comma");
check(csv.includes("1240.00,1120.00,120.00"), "total amount tax order");
