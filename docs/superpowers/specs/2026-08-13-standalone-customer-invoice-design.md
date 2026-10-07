# Standalone Customer Invoice Design

## Goal

Allow Accounting to create a customer invoice that is not required to come from a quotation or job order, while keeping the invoice workflow clearly separate from supplier purchases and disbursements.

## Workflow

1. A staff member needs to bill a customer for a sale or service that has no quotation or job order.
2. They open Invoices and choose **New Invoice**.
3. They select a customer, optionally select a contact and job/project, enter invoice details and line items, and review the calculated totals.
4. The system validates the invoice, saves it as an operational invoice record, and opens its detail page.
5. From the detail page, the user can print the invoice or record a payment.

Supplier purchases are not created here. They continue through Money Out, Pending Expenses, and Disbursements because they represent money owed or paid by the company.

## User Interface

The form has one primary action: **Create invoice**.

### Invoice details

- Customer: required, searchable, and the first field.
- Contact: optional and filtered by customer.
- Job/project: optional; standalone remains valid when empty.
- Invoice date: required and defaults to today.
- Due date: optional.
- Tax treatment: VAT or Non-VAT.
- EWT: an independent selectable treatment; defaults off and remains editable according to the transaction.

### Line items

Each line supports the existing item-template and pricing patterns:

- Description: required.
- Quantity: required and greater than zero.
- Unit or dimensions: available for measured items.
- Unit price or square-foot rate: required according to pricing mode.
- Line total: calculated immediately.

Users can add and remove lines. The form shows subtotal, VAT, EWT, and amount due before submission.

## Thinking Brain Behaviors

- Reuse customer contacts and item templates instead of asking users to retype known data.
- Default the invoice date to today.
- Calculate all monetary totals from line items and tax settings.
- Keep job/project linkage optional and visible; never invent a link.
- Block submission when the customer, description, quantity, price, or tax inputs are invalid.
- After creation, show the next useful actions: Print and Record payment.
- Report totals must derive from the saved invoice record; reports do not collect duplicate invoice data.

## Data and Safety

- `invoices.job_order_id` may be null for a standalone customer invoice.
- A standalone invoice still requires a customer and a positive amount.
- Job-linked invoices keep their existing completed-job validation and line snapshot behavior.
- Standalone line items are saved atomically with the invoice.
- Existing permissions and audit logging remain required.
- Invoice financial fields remain immutable after creation except through existing approved payment workflows.
- Existing invoice numbering and customer ownership rules remain the source of truth.

## Error and Recovery States

- Permission failure: explain that Accounting or an admin is required.
- Invalid field: show the cause beside the field and preserve entered values.
- Save failure: keep the form available, show a retry action, and do not claim the invoice was created.
- Duplicate submission: disable the primary action while saving and rely on the server-side transaction.
- Success: navigate to the created invoice and show a success message.

## Out of Scope

- Supplier purchase orders or supplier invoices.
- Inventory receiving or stock deduction.
- A combined “New financial record” wizard.
- New report-only tables or duplicate accounting data.
- Automatic project selection based on guesses.

## Acceptance Criteria

- A user can create a customer invoice without a quotation or job order.
- A user can optionally associate the invoice with an existing job/project.
- The invoice cannot be created without a customer or valid line items.
- VAT, EWT, subtotal, and amount due are calculated consistently with existing invoice rules.
- The invoice and lines are created atomically.
- The invoice appears in the invoice list and opens in the existing detail workflow.
- Existing job-linked invoice creation and payment recording continue to work.
- The form is keyboard accessible, readable on mobile, and has one obvious primary action.
