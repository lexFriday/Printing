import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const reports = readFileSync(new URL("../src/routes/_app.reports.tsx", import.meta.url), "utf8");

assert.match(reports, /Project profitability details/);
assert.match(reports, /Allocated cost trail/);
assert.match(reports, /expenseTrail/);
assert.match(reports, /setProfitabilityDetail/);
assert.match(reports, /Add receipt/);
assert.match(reports, /initialPettyCashBatch/);
assert.match(reports, /isPettyCashReceipt/);
assert.match(reports, /Receipt upload/);
assert.match(reports, /receipt_missing_reason/);
assert.match(reports, /Project cost \(optional\)/);
assert.match(reports, /Arlechino company expense/);
assert.match(reports, /I don.t have a receipt/);
assert.match(reports, /Imported petty-cash receipts need a no-receipt reason/);
assert.match(reports, /expense\.payment_status !== "paid"/);
assert.match(reports, /Allocate General Expense to projects/);
assert.match(reports, /Arlechino company expenses/);
assert.match(reports, /Included in project profit/);
assert.match(reports, /Waiting for Operations/);
assert.match(reports, /Assign project/);
assert.match(reports, /automatically appears here/);
assert.match(reports, /Still unallocated/);
assert.match(reports, /Save allocation/);
assert.match(reports, /Suggested projects/);
assert.match(reports, /No project suggested/);
assert.match(reports, /Choose another project/);
assert.match(reports, /already in the confirmed project use list/);
assert.match(reports, /Total already includes 12% VAT/);
assert.match(reports, /Add 12% VAT to subtotal/);
assert.match(reports, /Amount before VAT/);
assert.match(reports, /create_job_expense_with_allocations/);
assert.match(reports, /Check Disbursements/);
assert.match(reports, /Check details/);
assert.match(reports, /Arlechino company expense/);
assert.match(reports, /CheckDisbursementCard/);
assert.match(
  reports,
  /payment_method: "check"[\s\S]*?check_number: check_number\?\.trim\(\) \|\| null/,
  "recording a check payment must mark the original expense as paid by check so the derived report includes it",
);
assert.match(reports, /Settle petty-cash batch/);
assert.match(reports, /settle_and_close_petty_cash_batch/);
assert.match(reports, /Cash returned/);
assert.match(reports, /Not paid yet/);
assert.match(reports, /Record payment details/);
assert.match(reports, /More details/);
assert.match(reports, /Search Job Order/);
assert.match(reports, /customer:customers\(customer_name\)/);
assert.match(reports, /Search Job Order, project, or client/);
assert.match(reports, /Search results/);
assert.match(reports, /No Job Orders match/);
assert.match(reports, /Transport \/ Delivery/);
assert.match(reports, /Confirm for Project Profitability/);
assert.match(reports, /confirm_expense_project_cost/);
assert.doesNotMatch(reports, /<SelectItem value="petty_cash">Petty cash<\/SelectItem>/);
assert.doesNotMatch(reports, /Petty cash batch \(optional\)/);
assert.match(reports, /Import petty-cash receipts from their open batch/);
assert.match(reports, /petty-cash-receipt-layout/);
assert.match(reports, /What did you buy\?/);
assert.match(reports, /No receipt available/);
assert.match(reports, /Save receipt/);
assert.match(reports, /Project cost/);
assert.match(reports, /General expense steps/);
assert.match(reports, /Expense details/);
assert.match(reports, /Supporting details/);
assert.match(reports, /Continue to supporting details/);
assert.match(reports, /Material \/ purchase summary/);
assert.match(reports, /What bill or service is this for/);
assert.match(reports, /What was delivered/);
assert.match(reports, /Booking \/ Waybill No\./);
assert.match(reports, /Receipt details/);
assert.match(reports, /Receipt proof/);
assert.match(reports, /pettyCashStep/);
assert.match(reports, /Delivery provider/);
assert.match(reports, /Transportify/);
assert.match(reports, /Truck contractor/);
assert.match(reports, /Custom delivery provider/);
assert.match(reports, /Service provider/);
assert.match(reports, /Delivery reference/);
assert.match(reports, /Billing period/);
assert.match(reports, /min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5/);
assert.match(reports, /shrink-0 gap-2 border-t bg-background/);
assert.match(
  reports,
  /f\.disbursement_category === "direct_materials" && !f\.petty_cash_batch_id/,
  "petty-cash material receipts must not require General Expense supplier tax details",
);

console.log("reports workflow contract passed");
