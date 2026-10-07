# Finance Workflow QA Script

Use this script against a test account and test records. Do not use production records for the mutating cases.

## Setup

```powershell
$env:UAT_EMAIL = "your-test-email"
$env:UAT_PASSWORD = "your-test-password"
$env:UAT_BASE_URL = "http://127.0.0.1:8091"
```

Run the existing browser suite with:

```powershell
npm run uat:login
npx playwright test tests/uat/client-workflow.spec.ts
```

The detailed finance-specific cases below are the manual acceptance script; add each case to the automated suite only after the test data and stable selectors are agreed.

For manual validation, open `/reports` after signing in.

## Screen 1: Reports Landing

1. Open Reports.
2. Confirm the page answers three questions immediately: current report area, current subreport, and primary action.
3. Confirm the date range, From, To, Search, and Export controls are visible without horizontal clipping.
4. Resize to desktop, tablet, and a narrow viewport. Confirm no right-side action disappears.
5. Confirm each report has a loading state, empty state, and visible error state when applicable.

Expected result: the report page remains usable at every tested width and the active tab is obvious.

## Screen 2: Search and Date Filters

Repeat for Monthly Profit, Project Profitability, Project Monitoring, Quote History, Invoice Report, Receivables, Cash Sales, Pending Expenses, and Disbursements.

1. Type a distinctive customer, supplier, project, invoice number, reference, or description into Search.
2. Confirm rows filter while typing.
3. Confirm matching text can appear in any searchable column, not only the first column.
4. Type a multi-word search such as `SKHART MERCADO`; confirm every word must be present in the matching row.
5. Type an unmatched value; confirm a clear empty state appears and totals do not falsely show unrelated rows.
6. Clear Search; confirm the full date-filtered list returns.
7. Change From and To; confirm rows and totals update together.
8. Switch report area or subreport; confirm Search does not silently carry over to an unrelated report.

Expected result: Search narrows the visible report data and does not alter the underlying records or summary calculations unexpectedly.

## Screen 3: Customer Invoice and Money In

### Read-only checks

1. Open Operations > Invoice Report.
2. Confirm each row shows project, customer, invoice number, date, status, tax treatment, and amount.
3. Open Money In > Receivables.
4. Confirm customer, invoice number, invoice date, due date, original amount, paid amount, balance, and aging are visible.
5. Confirm a quotation with no Job Order is absent from Money In.
6. Confirm an invoice with a Job Order appears in Money In and Receivables.
7. Confirm Cash Sales includes applicable customer invoices and displays Official Receipt No. when present.

### Mutating checks

1. Open a test Job Order with at least two billable lines.
2. Create an invoice using only one selected line or a partial quantity.
3. Confirm the invoice saves with the selected lines only.
4. Create a second invoice from the same Job Order using the remaining quantity.
5. Confirm both invoices exist and the same quantity cannot be billed a third time.
6. Try to enable EWT on a Non-VAT invoice; confirm the system blocks it.
7. Add an Official Receipt No.; confirm it is visible after saving and appears in Cash Sales/export data.
8. Print the invoice; confirm it is immediately printable and does not include supplier-only fields.

Expected result: one Job Order supports multiple invoices without overbilling, and customer invoices flow only into Money In after the Job Order exists.

## Screen 4: Money Out and Supplier Disbursement

1. Open Money Out > Pending Expenses.
2. Confirm supplier/payee, details, document references, status, amount, and action controls are readable.
3. Confirm the table has horizontal scrolling when columns exceed the viewport.
4. Open Add Disbursement.
5. Enter a new supplier name, TIN, address, category, description, amount, and tax.
6. Confirm supplier/company names are stored in ALL CAPS.
7. Reopen Add Disbursement and type the same supplier name.
8. Select the existing suggestion; confirm TIN and address refill without retyping.
9. Select Add New; confirm a new supplier can still be entered.
10. Confirm supplier expenses do not appear in customer Receivables or Aging.

Expected result: supplier expenses remain in Money Out and reusable supplier information reduces duplicate entry.

## Screen 5: Payment Methods

### Check

1. Record a check payment with check date and check number.
2. Confirm payment date is not required.
3. Confirm reaching the check date does not automatically mark the item Paid.
4. Confirm the user can keep it Pending or place it On Hold when bank funds are unavailable.
5. Manually confirm release/clearing; confirm it then leaves Pending Expenses and appears in Disbursements.

### GCash and bank transfer

1. Select GCash or Bank Transfer.
2. Enter the payment/reference number.
3. Upload a test image or PDF proof of payment.
4. Try to clear the payment without the reference or proof; confirm validation blocks the action.
5. Confirm the proof/reference remains attached to the payment record after saving.

### Petty cash

1. Select Petty Cash.
2. Enter the cash source or bank/cash details and upload supporting proof.
3. Confirm petty cash follows immediate-payment behavior and does not wait for a check date.
4. Confirm the record remains auditable in the disbursement history.

Expected result: payment state reflects actual confirmation, not merely a scheduled date.

## Screen 6: Check Voucher and Print QA

1. Open a paid disbursement and print its Check Voucher.
2. Confirm Payee, amount, particulars, check date, DR/Invoice No., and check number are visible.
3. Confirm long particulars wrap instead of clipping.
4. Confirm a large amount does not overlap the check number.
5. Confirm `JANE SY` appears as Prepared By in the approved position.
6. Confirm the unwanted overlay labels and dotted placeholder lines are absent.
7. Confirm Certified Correct By and Received By remain positioned correctly.
8. Print at the target paper size and inspect the physical margin before approving the layout.

Expected result: the voucher is readable, printable, and safe for attachment to the physical check.

## Screen 7: Excel Exports

For each report, click Export and open the resulting workbook.

1. Confirm the workbook contains only the active report data and active date range.
2. Confirm headers are stable and match the expected report:
   - Receivables/Aging: Customer, Invoice No., Invoice Date, Due Date, Amount, Aging, Open Balance.
   - Cash Sales: Date, Customer/Company, Details/Address, Documents, Amount.
   - Disbursements: Voucher Date, Voucher No., Payee, Check Date, DR/Invoice No., Particulars, Amount, Amount in Words.
3. Confirm currency values remain numeric and totals reconcile with the screen.
4. Confirm customer and supplier names are uppercase.
5. Confirm no duplicate invoice, payment, or disbursement rows are introduced.
6. Compare a small sample against the current QuickBooks-style Aging and Lotus/Approach disbursement files.

Expected result: exports are report-specific, filter-aware, numerically usable, and close enough to the existing accounting files for daily work.

## Pass / Fail Recording

For every failed check, record:

- screen and URL
- exact steps and test data
- expected result
- actual result
- screenshot or exported file
- severity: Blocker, High, Medium, or Low
- whether the issue affects source records, calculations, printing, or only presentation

Do not approve the workflow until all Blocker and High findings are resolved and the printed Check Voucher and exported Aging/Disbursement files have been reviewed.
