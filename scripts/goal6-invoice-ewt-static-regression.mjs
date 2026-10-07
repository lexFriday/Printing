import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`${label}: missing ${needle}`);
  }
}

function assertMatches(haystack, pattern, label) {
  if (!pattern.test(haystack)) {
    throw new Error(`${label}: missing ${pattern}`);
  }
}

const migrations = readdirSync(join(root, "supabase", "migrations"));
const ewtMigrationName = migrations.find((name) => name.includes("goal6_invoice_ewt"));
if (!ewtMigrationName) {
  throw new Error("Goal 6 migration is missing.");
}

const migration = read(join("supabase", "migrations", ewtMigrationName));
[
  "ewt_enabled",
  "ewt_rate",
  "vatable_sales_snapshot",
  "vat_rate_snapshot",
  "vat_amount_snapshot",
  "ewt_amount_snapshot",
  "gross_total_snapshot",
  "ewt_treatment_snapshot",
  "amount_due_snapshot",
  "reference_only",
  "deducted_from_amount_due",
  "validate_invoice_from_job",
  "validate_invoice_payment",
  "sync_invoice_paid_status",
].forEach((needle) => assertIncludes(migration, needle, "migration"));

const jobDetail = read("src/routes/_app.jobs.$id.tsx");
assertIncludes(jobDetail, "ewt_enabled", "job invoice generation");
assertIncludes(jobDetail, "ewt_rate", "job invoice generation");
assertIncludes(jobDetail, "EWT", "job invoice form");

const invoiceDetail = read("src/routes/_app.invoices.$id.tsx");
assertIncludes(invoiceDetail, "amount_due_snapshot", "invoice detail");
assertIncludes(invoiceDetail, "ewt_amount_snapshot", "invoice detail");
assertMatches(invoiceDetail, /receivableStatus\(\s*amountDue/s, "invoice detail balance");

const invoicePrint = read("src/routes/invoices.$id.print.tsx");
assertIncludes(invoicePrint, "ewtTreatment", "invoice print");
assertIncludes(invoicePrint, "Less: EWT", "invoice print");
assertIncludes(invoicePrint, "Grand Total", "invoice print");
assertIncludes(invoicePrint, "Amount Due", "invoice print");

const dashboard = read("src/routes/_app.dashboard.tsx");
assertIncludes(dashboard, "amount_due_snapshot", "dashboard receivables");

const reports = read("src/routes/_app.reports.tsx");
assertIncludes(reports, "amount_due_snapshot", "reports receivables");

const customerDetail = read("src/routes/_app.customers.$id.tsx");
assertIncludes(customerDetail, "amount_due_snapshot", "customer receivables");

console.log("Goal 6 invoice EWT static regression passed.");
