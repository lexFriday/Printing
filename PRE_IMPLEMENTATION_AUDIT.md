# Pre-Implementation Audit

Date: 2026-07-02

Scope: audit only for the PRD-aligned Quote, Invoice, and Print Workflow Plan. No feature, schema, RLS, or UI changes were made in this audit pass.

## Executive Verdict

The current codebase is not ready for the final plan migrations yet. The app builds successfully, and the existing quote -> job -> invoice snapshot foundations are useful, but there is important product and schema drift that must be resolved before implementation.

The largest mismatch is quotation workflow status. The final plan says to use only PRD statuses:

```txt
Draft -> Sent -> Approved / Rejected
```

The current migrations and UI still use:

```txt
pending_manager_approval
pending_customer_approval
```

That drift affects validation triggers, quote create/edit/detail UI, dashboard queues, quote line item RLS, and tests. Do not add new quote features until this status model is intentionally reconciled.

## Verification Run

Command run:

```bash
npm run build
```

Result: passed.

Notes:

- Vite emitted a normal chunk-size warning for large bundles.
- No TypeScript/build failure was observed.
- No live database status-count query was run from this audit. Run the SQL in the Live DB Checks section before applying migrations to Lovable.

## Current Schema Findings

### `customers`

Current generated Supabase types show:

```txt
id
customer_code
customer_name
contact_person
contact_number
email
address
notes
created_at
updated_at
```

Migration `20260625090000_quote_core_workflow_fields.sql` adds:

```txt
tin_number text
```

Migration `20260625103000_unique_customer_tin.sql` adds a normalized unique TIN index.

Audit finding:

- `src/integrations/supabase/types.ts` is stale and does not include `customers.tin_number`.
- Lovable/live DB must confirm this column exists before the UI can rely on it.

### `quotations`

Current generated Supabase types show:

```txt
id
quote_number
customer_id
project_name
quote_date
remarks
subtotal
total_amount
status
sent_at
approved_at
rejected_at
created_by
created_at
updated_at
tax_type
```

Migrations add:

```txt
submitted_for_manager_at
manager_approved_at
customer_decided_at
sales_agent
terms
```

Audit findings:

- Generated types are stale and do not include `sales_agent`, `terms`, or manager/customer decision timestamps.
- No fields exist yet for:
  ```txt
  sales_agent_user_id
  sales_agent_signature_url_snapshot
  adjustment_label
  adjustment_amount
  version
  updated_by
  ```
- Current `recompute_quote_totals()` sets:
  ```txt
  subtotal = sum(line_total)
  total_amount = subtotal
  ```
  so quote adjustment requires changing this function.
- Current quote statuses in generated types are PRD-only, but migrations/code use the manager approval statuses. This type drift is a high-risk warning.

### `quote_line_items`

Current generated types show expected pricing source fields:

```txt
quotation_id
description
pricing_mode
unit_of_measure
width
height
quantity
rate_per_sqft
computed_sqft
unit_price
line_total
sort_order
created_at
updated_at
```

Audit findings:

- This table is currently the correct source of truth for quote pricing.
- Current edit flow deletes all line items and reinserts them on save. That is simple, but risky for future autosave because a partial/invalid autosave could wipe valid lines.
- Quote adjustment should not be modeled as another normal line item unless the client wants it visible like a product/service line. The current plan's `adjustment_amount` column is safer.

### `job_orders`

Current generated types show:

```txt
quotation_id
customer_id
project_name
quoted_amount
tax_type
status
target_completion_date
internal_notes
production_started_at
ready_at
delivered_at
completed_at
```

Current snapshot behavior:

- `validate_job_order_from_quote()` enforces approved quote source.
- `snapshot_job_order_lines()` copies quote line items into `job_order_line_items` after job creation.

Audit findings:

- Existing line-item snapshot foundation is good.
- `job_orders.quoted_amount` snapshots quote total, but there is no explicit subtotal/adjustment snapshot yet.
- If adjustment is added, job creation must copy adjusted total and preferably adjustment metadata.

### `job_order_line_items`

Migration `20260611153000_job_order_snapshots.sql` creates immutable snapshots copied from quote line items.

Audit findings:

- This is aligned with the PRD snapshot rule.
- There are intentionally no update/delete policies by design.
- No adjustment metadata exists here.

### `invoices`

Current generated types show:

```txt
job_order_id
customer_id
invoice_number
invoice_date
due_date
invoice_amount
tax_type
status
payment_date
payment_remarks
paid_at
created_at
updated_at
```

Current invoice generation:

- UI inserts invoice with:
  ```txt
  invoice_amount = job_order.quoted_amount
  tax_type = job_order.tax_type
  ```
- `validate_invoice_from_job()` enforces completed job, copies customer and amount, and requires job order line items.
- `snapshot_invoice_lines()` copies job order line items into invoice line items.

Audit findings:

- Invoice line snapshot foundation is good.
- No EWT fields exist yet.
- No VAT/EWT snapshot fields exist yet.
- Current balance/payment calculations use `invoice_amount`, not `amount_due_snapshot`.
- Adding EWT must update invoice detail, print, reports/receivables, payment validation, and possibly invoice payment trigger logic.

### `invoice_line_items`

Migration `20260611161000_invoice_payment_snapshots.sql` creates immutable line snapshots copied from `job_order_line_items`.

Audit findings:

- This is aligned with PRD snapshot rules.
- No tax/EWT data lives on line items, which is okay if EWT remains invoice-level.

### `profiles`

Current generated types show:

```txt
id
display_name
email
status
created_at
updated_at
```

Audit findings:

- No `signature_url` exists.
- No current-user profile RPC exists.
- Current auth hook loads only role from `user_roles`; it does not fetch display name/signature as an app-level profile object.

### `audit_logs`

Current generated types show:

```txt
id
user_id
action
entity_type
entity_id
old_values
new_values
created_at
```

Current audit implementation:

- `src/lib/audit.ts` is a no-op compatibility shim.
- Database trigger `app_private.capture_audit_log()` writes generic `insert`, `update`, `delete` audit entries for key tables.

Audit findings:

- Explicit workflow audit names like `quotation.reopened` are not currently produced by `logAudit()` calls because the client helper is a no-op.
- A reopen RPC must write an explicit audit row itself, or the audit history will only show a generic `update`.

## Current RLS and Permission Findings

Current role helpers include:

```txt
app_private.can_sales_work
app_private.can_accounting_work
app_private.can_control_jobs
app_private.can_create_job_orders
app_private.can_manage_users
app_private.can_view_sensitive_operations
```

UI role helpers include matching concepts in `src/lib/roles.ts`.

Important current behavior:

- `can_manage_users`: owner only after owner/admin reframe.
- `can_control_jobs`: later migration allows owner/admin/staff.
- `can_create_job_orders`: owner/admin/staff.
- Quote read/write: sales-work roles.
- Quote line item edit policy currently allows `draft` and `pending_manager_approval`.

Audit findings:

- Final plan removes manager approval statuses, so quote RLS must be simplified back to PRD statuses.
- Untracked migration `20260701162000_quote_line_item_edit_policy_repair.sql` depends on `app_private.can_sales_work` and manager statuses.
- Lovable drift already showed missing function errors earlier, so deployment SQL must include dependency functions before policies.
- Attachment RLS/storage policies do not exist yet.
- Reopen must be enforced by backend RPC, not UI-only checks.

## Current Storage Findings

Search results show:

```txt
docs/deployment/manual-deployment-steps.md: No storage buckets are required for the current Build Package.
docs/final-implementation-report.md: Storage buckets: none required.
```

Audit findings:

- No `quote-attachments` bucket is defined.
- No storage policies exist for quote attachments.
- Any implementation of attachments must add bucket setup and private signed URL access.

## Current Quote Workflow Code

### New quote

File:

```txt
src/routes/_app.quotes.new.tsx
```

Current behavior:

- Creates quotation as `draft`.
- Inserts line items.
- If submitted, updates quote to `pending_manager_approval`.
- Uses `sales_agent` and `terms` fields.
- No autosave exists.

Finding:

- This conflicts with final PRD workflow because submit should move `draft -> sent`, not `draft -> pending_manager_approval`.

### Edit quote

File:

```txt
src/routes/_app.quotes.$id.edit.tsx
```

Current behavior:

- Editable statuses:
  ```txt
  draft
  pending_manager_approval
  ```
- Saves by updating quotation, deleting all line items, and reinserting all line items.
- No draft autosave.
- No optimistic locking.

Findings:

- This conflicts with final PRD workflow.
- Delete/reinsert save path is a major autosave risk if reused without guardrails.

### Quote detail

File:

```txt
src/routes/_app.quotes.$id.tsx
```

Current behavior:

- Status actions use:
  ```txt
  draft -> pending_manager_approval
  pending_manager_approval -> pending_customer_approval
  pending_customer_approval/sent -> approved/rejected
  ```
- Convert to job only if quote is `approved`.
- Converts by inserting `job_orders` with `quoted_amount = quote.total_amount`.

Findings:

- Manager approval UI and backend expectation must be removed or migrated if the final plan is accepted.
- Reopen for correction is not implemented.

### Quote print

File:

```txt
src/routes/quotes.$id.print.tsx
```

Current behavior:

- Print header currently includes:
  ```txt
  VAT Mode
  Project
  Company Name
  TIN
  Address
  Attention
  Sales Agent
  Terms
  ```
- Footer hardcodes:
  ```txt
  MS. DHODIE SOSA
  Account Manager
  Mobile: 09088622199
  ```
- Uses `computeInclusiveVat(total_amount)`.
- Has a browser-side PDF download helper using jsPDF.

Findings:

- Final plan requires removing Sales Agent, TIN, VAT mode, and Terms from print header.
- Footer must use quote-snapshotted sales agent/signature if approved by client.
- Current print uses live quote/customer data and hardcoded prepared-by values, not quote signature snapshots.

## Current Job and Invoice Code

### Job conversion and line snapshots

Files:

```txt
src/routes/_app.quotes.$id.tsx
supabase/migrations/20260611153000_job_order_snapshots.sql
```

Current behavior:

- Quote detail inserts job order from approved quote.
- DB trigger snapshots quote line items into `job_order_line_items`.

Finding:

- Good foundation. Future adjustment fields must be included in the quote -> job snapshot path.

### Invoice generation and line snapshots

Files:

```txt
src/routes/_app.jobs.$id.tsx
supabase/migrations/20260611161000_invoice_payment_snapshots.sql
```

Current behavior:

- Invoice generation requires completed job.
- Inserts `invoice_amount = job.quoted_amount`.
- DB trigger snapshots job line items into `invoice_line_items`.

Finding:

- Good foundation. Future EWT fields must be snapshotted at invoice generation.

### Invoice VAT calculation

Files:

```txt
src/lib/calc.ts
src/routes/_app.invoices.$id.tsx
src/routes/invoices.$id.print.tsx
```

Current behavior:

- VAT is inclusive:
  ```txt
  vatableSales = gross / 1.12
  vat = gross - vatableSales
  ```
- Invoice detail and print compute VAT from `invoice_amount`.
- Non-VAT hides VAT rows.

Findings:

- No EWT support exists.
- No VAT snapshot exists.
- Final plan's formula says `vatable_sales = subtotal`, which is an exclusive VAT interpretation, while current code uses inclusive VAT. This must be clarified before implementation.
- Client sample looked like exclusive VAT:
  ```txt
  33,176.79 + 3,981.21 = 37,158.00
  ```
  Current helper would treat 37,158.00 as gross inclusive and produce lower VATable sales.

## Live DB Checks Needed Before Migration

Run these in Lovable/Supabase SQL editor before applying final migrations:

```sql
select status, count(*)
from public.quotations
group by status
order by status;
```

Check whether non-PRD statuses exist:

```sql
select quote_number, status, updated_at
from public.quotations
where status::text in ('pending_manager_approval', 'pending_customer_approval')
order by updated_at desc;
```

Check schema drift:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'customers',
    'quotations',
    'quote_line_items',
    'job_orders',
    'job_order_line_items',
    'invoices',
    'invoice_line_items',
    'audit_logs',
    'profiles'
  )
order by table_name, ordinal_position;
```

Check relevant helper functions:

```sql
select n.nspname as schema_name, p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app_private')
  and p.proname in (
    'can_sales_work',
    'can_accounting_work',
    'can_create_job_orders',
    'can_control_jobs',
    'can_manage_users',
    'can_view_sensitive_operations',
    'validate_quote_update',
    'validate_job_order_from_quote',
    'validate_invoice_from_job',
    'snapshot_job_order_lines',
    'snapshot_invoice_lines',
    'capture_audit_log'
  )
order by schema_name, function_name;
```

Check storage buckets:

```sql
select id, name, public
from storage.buckets
order by name;
```

Check current quote totals against line sums:

```sql
select q.id,
       q.quote_number,
       q.subtotal,
       q.total_amount,
       coalesce(sum(qli.line_total), 0) as line_sum
from public.quotations q
left join public.quote_line_items qli on qli.quotation_id = q.id
group by q.id, q.quote_number, q.subtotal, q.total_amount
having q.subtotal <> coalesce(sum(qli.line_total), 0)
    or q.total_amount <> coalesce(sum(qli.line_total), 0);
```

## High-Risk Items Before Implementation

1. Status model conflict: current app uses manager approval states; final plan removes them.
2. Generated Supabase types are stale against migrations.
3. Quote print header currently shows fields the final plan wants removed.
4. Prepared/approved-by print block is hardcoded, not tied to logged-in user or snapshots.
5. Autosave does not exist, and current delete/reinsert line item save path is unsafe for naive autosave.
6. EWT does not exist, and VAT formula needs explicit inclusive vs exclusive confirmation.
7. Audit helper is a no-op; explicit workflow audit events need DB-side writes or RPC writes.
8. Quote attachments have no table, bucket, or policies.
9. Live Lovable DB drift has already caused missing-column/missing-function/RLS errors, so migrations must be applied in dependency order.

## Recommended Implementation Order

Do not implement all features in one pass. Use this order:

1. Status model correction:
   - Decide how to migrate existing `pending_manager_approval` and `pending_customer_approval` records.
   - Update enum/trigger/UI/tests to PRD statuses only.
2. Regenerate/update Supabase types after schema drift is resolved.
3. Add sales agent/signature support:
   - `profiles.signature_url`
   - `quotations.sales_agent_user_id`
   - `quotations.sales_agent_signature_url_snapshot`
   - narrow current-user profile RPC
4. Add quote print cleanup:
   - remove header fields
   - replace hardcoded approved/prepared-by with quote snapshot values
5. Add adjustment fields and update quote total recompute:
   - keep `total_amount` derived
   - snapshot adjusted total into job/invoice flow
6. Add controlled reopen RPC:
   - owner/admin only
   - no job order exists
   - reason required
   - explicit audit entry
7. Add guarded draft autosave:
   - local recovery first
   - DB autosave only for structurally valid draft records
   - optimistic lock via `updated_at` or `version`
8. Add quote attachments:
   - private bucket
   - `quote_attachments` table
   - signed URL access
   - no print output
9. Add invoice EWT:
   - confirm inclusive/exclusive VAT first
   - snapshot EWT/VAT fields
   - update balance/receivable/payment logic to use `amount_due_snapshot`

## Readiness Decision

Not ready for migrations yet.

Ready after:

- live DB status counts are captured,
- manager approval records are migrated or explicitly preserved,
- VAT calculation mode is confirmed,
- generated Supabase types are refreshed,
- migration dependency order is prepared for Lovable cloud.

