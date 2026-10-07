# Finance Workflow Revision Plan

> Planning only. The workflow decisions below are approved for implementation planning; do not modify product code in this planning step.

## Goal

Align the finance module with the client's real process:

- customer invoices belong to Money In and Receivables;
- supplier invoices and expenses belong to Money Out and Disbursements;
- one Job Order may produce multiple customer invoices;
- payments must preserve the difference between scheduled, released, held, and cleared money;
- petty cash must identify its cash source and retain proof;
- reports and exports must derive from operational records without duplicate entry.

## Product Decisions

### Customer invoices

- Keep `public.invoices` as the single source of truth.
- Allow multiple invoices to reference the same Job Order.
- Each invoice owns only the line items, quantities, prices, taxes, due date, and balance being billed at that time.
- A Job Order is a shared reference, not an amount copied into every invoice.
- Example: one JO for 100 units may produce Invoice 1 for 40 units and Invoice 2 for 60 units.
- Quotation-only records remain outside Money In until an invoice is issued.
- Customer invoices are printable immediately after creation.
- EWT is available only for VATable customer invoices; Non-VAT invoices cannot enable EWT.
- Capture Official Receipt No. when the customer invoice is collected or tagged for OR processing.
- Delivery Receipt records are classified as Provisional Receipt where applicable.

### Supplier invoices and disbursements

- Keep supplier purchases in `job_expenses` and the existing Money Out workflow.
- Do not combine supplier invoices with customer invoice creation.
- Reuse supplier records by searchable name with an `Add new supplier` path.
- Reuse TIN and address details when a saved supplier is selected.
- Normalize supplier/payee names and exported text to uppercase.

### Payment methods and status

Payment method options:

- Check
- Bank transfer
- GCash
- Petty cash

Payment status must remain explicit and manually reviewable:

- Pending
- Scheduled
- Released
- Paid/Cleared
- On hold
- Cancelled

Use these user-facing labels:

- `Payment source` instead of `Bank details`;
- `Upload proof of payment` instead of `Proof upload`;
- `Cleared` instead of `Paid/Cleared`;
- `Payment held` instead of `On hold`.

Check date is a scheduling/reference date. It must not automatically mark a payment as cleared because bank funds may be unavailable or the payment may be held.

### Petty cash

Petty cash is a payment method, not a separate expense table.

When petty cash is selected, show and require:

- source bank or cash account;
- source account name or reference;
- payment/release date;
- amount;
- proof file or image upload;
- optional notes or voucher reference.

Petty cash should default to `Paid/Cleared` only when the user explicitly records that cash was released. The source-account details and proof remain part of the payment audit trail.

For petty cash, GCash, and bank transfer, require proof of payment before the payment can be marked `Cleared`. For checks, retain check date and check number; proof is optional unless the business later requires it. Do not reuse payment-date assumptions across methods.

## Data and Source-of-Truth Changes

1. Remove the effective one-invoice-per-JO restriction.
2. Replace full-JO automatic invoice-line copying for new invoices with explicit invoice-owned lines and quantities.
3. Preserve historical invoice snapshots and existing job-linked records.
4. Add or reuse a payment-method/source-details model rather than duplicating payment columns across screens. Present the concept as `Payment source` in the UI.
5. Store proof metadata in the existing protected storage/payment-proof pattern.
6. Keep payment status authoritative; derive aging, open balance, and report totals from invoices and payments.
7. Keep supplier disbursement data authoritative in `job_expenses`.

## UX Plan

### Customer invoice flow

- Invoices -> New customer invoice.
- Select or create a customer.
- Optionally select a Job Order, with multiple invoices allowed for the same JO.
- Add only the lines being billed now.
- Choose VAT treatment; reveal EWT only when VATable.
- Save as Draft or Issue, then offer Print.
- Record customer payment and OR number from the invoice detail screen.

### Supplier disbursement flow

- Money Out -> Add disbursement.
- Select or create supplier/payee.
- Enter expense category, details, DR/Invoice No., TIN, address, amount, and tax.
- Select payment method.
- Show only the fields relevant to that method.
- For petty cash, require payment source and proof of payment.
- For GCash and bank transfer, require proof of payment before clearing.
- For check, show check date and check number without automatic clearance.
- Save, print or edit the voucher, and retain audit history.

The primary action must be obvious, forms should use progressive disclosure, and the user should never need to enter the same supplier/customer details twice.

## Reporting and Export Plan

### Money In / Aging

Provide a QuickBooks-style customer aging report grouped by customer, with:

- Customer
- Invoice No.
- Invoice date
- Due date
- Aging days
- Invoice amount
- Open balance
- Customer subtotal

Only issued customer invoices belong in receivables. Paid balances must reduce open balance without deleting invoice history.

### Money Out / Disbursement

Keep the Lotus/Approach-style voucher and export fields:

- Voucher date
- Voucher number
- Payee/company
- Particulars/details
- Category/subcategory
- DR/Invoice No.
- Check date
- Check No.
- Payment method/status
- Source account where applicable
- TIN
- Address
- Amount
- Tax
- Total
- Proof reference where applicable

Exports should use the client's workbook column order and uppercase formatting where required.

## Implementation Order

1. Implement the approved invoice allocation behavior: each invoice owns only the items billed in that invoice.
2. Update invoice schema, constraints, RPCs, and line-item snapshot behavior for multiple invoices per JO.
3. Enforce VAT/EWT rules at both UI and database layers.
4. Add reusable customer and supplier selection/create behavior.
5. Add payment-method-specific fields, statuses, source-account details, and proof uploads.
6. Keep petty cash separate in behavior but stored in the existing disbursement/payment source of truth.
7. Update customer invoice print, payment, OR, receivables, and aging screens.
8. Update disbursement, check voucher, edit-after-print, and payment review screens.
9. Align Excel exports with the provided Cash Sales, Receivables, and Cash Disbursement workbooks.
10. Run focused database, logic, type, build, and screen-to-screen QA.

## Acceptance Tests

- Create two invoices for one JO with different lines and confirm neither duplicates the full JO amount.
- Confirm quotation-only records do not appear in Money In.
- Confirm a VATable invoice can use EWT and a Non-VAT invoice cannot.
- Print a customer invoice immediately after issuing it.
- Record an OR number and verify it appears in Cash Sales/export output.
- Create a supplier disbursement with a saved supplier and confirm TIN/address suggestions.
- Create check, bank-transfer, GCash, and petty-cash payments.
- Confirm a check reaching its check date remains reviewable and does not auto-clear.
- Confirm petty cash requires source-account details and supports proof upload.
- Confirm petty cash cannot be cleared without source-account details and proof of payment.
- Confirm bank transfer and GCash cannot be cleared without proof of payment, and files are visible only to permitted users.
- Confirm Payment held prevents the record from being counted as cleared cash out.
- Confirm Aging, Cash Sales, Disbursement, voucher print, and Excel exports agree with source records.

## Safety and Verification

- Preserve permissions, tenant isolation, audit logging, immutable invoice/payment history, and proof-file access rules.
- Use additive migrations and backfill only where the existing source of truth is clear.
- Do not delete or rewrite historical invoice or disbursement records.
- Run TypeScript checks, focused self-tests, local migrations, build, diff checks, and screen-to-screen QA before claiming completion.

## Final Review: Release Gates

This review is plan-only. Do not enable or announce the complete workflow until every gate below passes.

### P0: Must be resolved first

1. **Invoice allocation is the financial source of truth.** A Job Order may have multiple invoices, but each invoice must own only the lines or quantities billed on that invoice. For example, a 100-unit JO split into 40 and 60 must produce two invoices totaling 100, not two copies of 100. Prevent over-allocation unless an explicit, approved business rule permits it.
2. **Payment state must have one owner.** Reconcile the new `payment_state` and payment-method fields with all existing pending/paid readers, forms, reports, exports, and voucher screens. Do not leave two independently editable status systems that can disagree.

### P1: Required before client validation

3. **Payment controls must be consistent in every entry and edit path.** Check dates must never auto-clear a payment. Check payments remain manually reviewable. GCash and bank transfer require a reference and proof before clearing. Petty cash is immediately released from cash on hand, but still requires source-account details and proof before it can be cleared.
4. **Reusable parties must be workflow-complete.** Customer and supplier selectors need search-as-you-type, an explicit Add New path, autofill for name/TIN/address/contact, duplicate-safe matching, and ALL CAPS normalization at save/export boundaries.
5. **Receipt handling must be connected end to end.** Issued customer invoices need Official Receipt No. when applicable; the value must flow to Cash Sales, Receivables/Aging where relevant, print output, and Excel export. Delivery Receipt must be represented as Provisional Receipt without changing the underlying customer invoice truth.
6. **Reports and exports need exact mapping.** Aging must provide customer grouping, invoice number, invoice date, due date, amount, aging, open balance, and customer totals. Disbursement and voucher output must follow the agreed Lotus/Approach columns. Exported values must come from source records, not a second manually maintained report model.

### P2: Usability and regression checks

7. Search must be scoped to the active report, match all typed words across visible fields, work in Monthly Profit as well as every report tab, clear when switching report areas, and never silently change KPI totals unless explicitly designed to do so.
8. Forms must show the next required action, payment blockers, proof requirements, empty/loading/error/success states, and responsive horizontal scrolling for wide tables without clipping descriptions or identifiers.

## Revised Implementation Sequence

1. Finish invoice line allocation and add database/logic tests for split invoices, partial quantities, duplicate submission, and over-allocation.
2. Reconcile payment-state storage and all existing status consumers; add a compatibility/backfill path for historical records.
3. Complete reusable customer/supplier records and uppercase normalization.
4. Connect Official Receipt and Provisional Receipt behavior to invoice, Cash Sales, Aging, print, and export flows.
5. Complete method-specific payment UI, source-account fields, proof upload, manual release/hold/clear actions, and edit-after-print behavior.
6. Align report columns, grouping, totals, search behavior, and Excel exports against the provided reference workbooks.
7. Run the full acceptance matrix and screen-to-screen QA, then review the resulting screenshots and exported files with the client.

## Final Acceptance Matrix

- A JO with 100 units can produce invoices for 40 and 60 units; a third invoice cannot bill already allocated units.
- A quotation without a JO is absent from Money In, Receivables, Cash Sales, and Aging.
- Multiple invoices for one JO remain separately printable and separately collectible.
- VAT/EWT rules hold in both UI and database paths; Non-VAT cannot receive EWT.
- Check date arrival does not change a payment to cleared; manual review can keep it pending or held.
- GCash and bank transfer require reference plus proof before clearing.
- Petty cash records source account and proof, and follows immediate-release behavior without a second payment ledger.
- Existing parties autofill correctly; Add New creates one reusable uppercase record without accidental duplicates.
- OR number and Provisional Receipt classification appear consistently wherever the client expects them.
- Aging, Cash Sales, Disbursement, voucher print, and Excel exports reconcile to their source records.
- Search works across all report sections, including Monthly Profit, without changing totals unexpectedly.
