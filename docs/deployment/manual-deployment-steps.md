# Manual Deployment Steps

## Lovable Cloud Database

1. Open the Supabase SQL editor connected to the Lovable Cloud project.
2. Apply `docs/deployment/lovable-cloud-complete.sql` once against a fresh project database.
3. If the Cloud database already has some of these tables, apply the individual files in `supabase/migrations/` in timestamp order instead and stop on any duplicate-object error before continuing.
4. Confirm these database objects exist:
   - Tables: `profiles`, `user_roles`, `customers`, `quotations`, `quote_line_items`, `job_orders`, `job_order_line_items`, `job_expenses`, `invoices`, `invoice_line_items`, `audit_logs`
   - Functions: `has_role`, `is_active_user`, `can_write_operations`, `validate_quote_update`, `validate_job_order_from_quote`, `snapshot_job_order_lines`, `validate_invoice_from_job`, `snapshot_invoice_lines`, `validate_invoice_payment_update`
   - RLS policies on every operational table.

## Storage

No storage buckets are required for the current Build Package. File upload requirements are listed as future/open decisions in the PRD and are intentionally not implemented.

## Environment Variables

Configure these values in Lovable Cloud:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Post-Deploy Smoke Test

1. Create or invite the first admin user.
2. Confirm the admin has one row in `profiles` with `status = 'active'`.
3. Confirm the admin has one row in `user_roles` with `role = 'admin'`.
4. Sign in and create one customer.
5. Create a quote with line items.
6. Mark the quote sent, then approved.
7. Convert the approved quote to a job order.
8. Add and update one expense.
9. Mark the job completed.
10. Generate an invoice.
11. Mark the invoice paid with a payment date.
12. Confirm reports show profitability, quote history, and invoice history.
13. Confirm `/settings/audit-logs` shows the critical actions.
