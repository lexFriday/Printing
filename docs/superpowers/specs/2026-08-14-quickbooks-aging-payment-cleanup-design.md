# QuickBooks Aging and Disbursement Payment Cleanup

## Goal

Make the Receivables report useful for daily collection follow-up and keep disbursement payment dates accurate without implying that a check cleared automatically.

## Approved behavior

- Receivables remains derived from customer invoices and invoice payments.
- The report groups invoices by customer, shows invoice date, due date, aging bucket, original amount, paid amount, open balance, and customer subtotals.
- Aging is calculated from the due date relative to today: Current, 1-30, 31-60, 61-90, and 90+ days. Missing due dates are shown as Current until a due date exists.
- Search and date filters affect the visible invoice rows, customer subtotals, bucket totals, and grand totals together.
- Export uses the same filtered, grouped ordering and totals as the visible report.
- Disbursement payment history keeps existing `paid_at` timestamps for audit/history, but the active payment form does not ask users to enter a separate Payment Date.
- Check Date remains required for check payments. Reaching the check date never changes payment state automatically; the user must manually confirm release or clearing after checking the bank.
- GCash, bank transfer, and petty cash continue to use their existing reference/proof/source controls. Petty cash may be cleared immediately when recorded.

## Source of truth

- Invoice amount and due date: `invoices`.
- Customer payment totals: `invoice_payments`.
- Supplier payment state and check date: `job_expenses`.
- `paid_at` remains historical audit data, not a user-entered active scheduling field.

## Non-goals

- No new tables, duplicate aging columns, or automatic payment scheduler.
- No changes to customer invoice routing, supplier expense routing, permissions, or audit history.

## Validation

- Verify grouped rows, bucket assignment, subtotals, and grand totals with filtered and unfiltered data.
- Verify export matches the visible report order and totals.
- Verify check payments can be recorded without Payment Date and remain pending/scheduled/held until manually changed.
- Verify non-check payment proof/reference validation remains intact.
