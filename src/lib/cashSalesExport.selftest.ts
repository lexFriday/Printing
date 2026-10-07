import { buildCashSalesCsv } from "./cashSalesExport.ts";

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const csv = buildCashSalesCsv([
  {
    or_number: "OR-001",
    date: "2026-01-05",
    company: "Sample Customer, Inc.",
    amount_paid: 1000,
    invoice: "INV-001",
    input_vat: 892.86,
    ewt: 17.86,
    tin: "000-000-000-000",
    address: "Sample Address, Quezon City",
  },
]);

check(csv.startsWith("OR,DATE,COMPANY,AMOUNT PAID,INVOICE,INPUT VAT,EWT,TIN,ADDRESS"), "header order");
check(csv.includes("OR-001,2026-01-05"), "or and date");
check(csv.includes("1000.00,INV-001,892.86,17.86"), "amount and tax order");
check(csv.includes("\"Sample Customer, Inc.\""), "csv escapes company");
