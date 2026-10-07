# What’s Included in the Printing System Today

**AutoMate PH · Current local build · 3 September 2026**

## In one sentence

The printing system keeps the workday in one flow: capture a customer request, prepare a quote, turn approved work into a Job Order, track money in and money out, invoice the customer, and review profitability.

## Main screens

### Dashboard

The Dashboard is the starting point for work that needs attention. It gives a quick view of operational and financial queues, such as quotes requiring action, unpaid invoices, pending expenses, and other high-level totals. What a user can see depends on their role.

### Quotes

Quotes supports the complete quotation workflow:

- View, search, and filter quotes by status.
- Create a quote for a customer and contact.
- Add dates, VAT/tax mode, payment terms, remarks, and reference images.
- Add multiple line items with fixed-price or square-foot pricing.
- Enter quantity, dimensions, optional depth, and unit price.
- Mark individual items as **No charge** and provide a reason when required.
- Save drafts, recover recent work, and continue editing.
- Submit for approval, approve/send through the existing workflow, and record corrections.
- Print a quotation with long customer, project, address, and item text fitted to the document.

### Job Orders

Job Orders carry approved work into production:

- Convert an approved quote into a Job Order.
- View the source quote, customer, project, and Job Order number.
- Track production status from pending through production, ready for delivery, delivered, and completed.
- Edit or correct Job Order details when the user has the required permission.
- Print the Job Order and delivery receipt.

The Job Order workspace is primarily for production progress and status tracking. Money-out entry is handled in Reports → Pending Expenses.

### Invoices

Invoices supports customer billing and collection:

- View and search invoices by status.
- Create an invoice from a completed Job Order or create one directly.
- Select the customer, billable items, invoice date, due date, and tax information.
- Record payment details and payment evidence where applicable.
- Correct invoice and payment information with the required reason and permission.
- Print an invoice.

### Reports

Reports brings operational and financial views together. Available areas include:

- **Profit / P&L** — revenue, expense, and profitability views derived from operational records.
- **Operations** — production and Job Order-oriented reporting.
- **Money In** — cash sales and revenue-related views.
- **Money Out** — pending expenses, disbursements, and petty cash.
- **Pending Expenses** — create, import, edit, categorize, tag, and review unpaid expenses.
- **Disbursements** — review paid expenses, payment documents, totals, and exports.
- **Petty cash** — manage cash advances, receipts, running balances, Job Order/project links, and one-CV settlement.
- Date, category, project, and search filters where supported.

#### Pending Expenses

Pending Expenses is the main money-out entry point. A receipt can include a supplier/payee, description, category, payment source, petty-cash batch, Job Order, tax details, document number, amount, and payment status. Expenses may be general, linked to one Job Order, or shared across multiple Job Orders through amount-based allocations. The screen also supports spreadsheet import and expense editing.

#### Petty cash

Petty cash works like a simple transaction register:

- Create a batch for a cash advance, custodian, funding date, source, and reference.
- Add multiple receipts over time.
- Link receipts to one or more Job Orders through the expense workflow.
- See starting cash, receipts recorded, available/running balance, receipt count, and project totals.
- Import petty-cash receipts from a spreadsheet.
- Close a batch after review.
- Create one CV for the original cash received amount.
- Show **Cash to return** when receipts are lower and **Overage for review** when receipts are higher.

### Customers

Customers stores reusable customer information:

- Customer name, complete address, TIN, notes, and contact details.
- Multiple contacts per customer.
- Search, list, detail, and edit views.
- Customer history with related quotes and invoices.

### Suppliers

Suppliers is under Administration. It provides a reusable supplier master list with supplier name, TIN, address, contact person, contact number, email, notes, and active/inactive status. Suppliers can be selected during expense entry; historical expense snapshots remain tied to the original transaction details.

### Item Templates

Item Templates stores reusable quotation items and pricing defaults so common work can be added consistently to new quotes.

### Users

Users lets authorized administrators manage workspace access:

- Review accounts and pending access.
- Assign roles such as owner, admin, accounting, sales, staff, or viewer where configured.
- Activate or deactivate access.
- Maintain user signatures used by printed documents where configured.

### Audit Logs / Change History

Audit Logs records who changed what and when. It covers important customer, quote, Job Order, invoice, expense, petty-cash, allocation, supplier, user, and workflow actions. Corrections can include the reason supplied by the user.

## Printing and exports

The system currently provides print views for:

- Quotations
- Job Orders
- Delivery receipts
- Customer invoices
- Checks
- Check vouchers

Long item descriptions, payees, addresses, project names, and references are fitted to the available print field. Print calibration settings and offsets can be adjusted for the physical printer and paper sample.

Spreadsheet exports are available for financial and expense views, including project-aware disbursement detail, supplier/payee, category, Job Order/project, tax values, document references, amounts, and totals where supported.

## Built-in safeguards

- Role-based access controls and tenant-aware data access.
- Required-field and amount validation.
- No-charge quotation lines with an explicit reason.
- Job Order selection from existing records only.
- Shared-expense allocation checks so allocated shares match the original receipt.
- Petty-cash batch protections after closure and one-CV-per-batch behavior.
- Audit history for corrections and workflow actions.
- Reports derived from operational records rather than manually entered summary totals.
- Draft recovery and preservation of form values when a save fails.

## Typical day-to-day flow

1. Add or select the customer and contact.
2. Prepare and send a quote for approval.
3. Convert approved work into a Job Order and track production.
4. Enter all money-out transactions in Reports → Pending Expenses.
5. Tag each expense to a Job Order, or allocate a shared receipt across Job Orders.
6. Track petty-cash running balances when a cash advance is used.
7. Complete the Job Order and create the customer invoice.
8. Record payment and review disbursements, P&L, and exports.
9. Use Change History when a correction needs to be understood later.

## What this system does not replace

The application is an operations and printing system. It organizes quotations, production, expenses, petty cash, billing, reporting, and printouts. It does not replace a full external accounting platform such as QuickBooks. Tax, payment, approval, printer, and permission behavior still depends on the configured workspace rules and the user’s role.

## Scope note

This guide describes the screens and capabilities visible in the current local application build. Some actions are intentionally hidden from roles that do not have permission, and the Live environment may require a separate deployment or schema configuration before it shows the same capabilities.
