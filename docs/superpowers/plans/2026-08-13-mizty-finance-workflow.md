# Mizty Finance Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the client-requested QuickBooks-like finance workflow for cash disbursements, check vouchers, manual OR cash sales, and Excel exports without duplicating accounting truth.

**Architecture:** Extend the existing TanStack Start + Supabase app. Use `job_expenses` as the operational Money Out source, add only the fields and history needed for client workflow, and keep reports/export derived from operational rows. Keep Job Order allocation optional so general supplier purchases do not distort project profitability.

**Tech Stack:** React 19, TanStack Router/Query, TypeScript, Supabase Postgres/RLS, existing shadcn-style UI, existing print/PDF helpers.

---

## Workflow

Finance/Dhang records supplier expenses, direct materials, petty cash, government payments, utilities, payroll, and similar Money Out items. When paid by cheque, the check voucher is the payment document and must show payee, amount, details, check date, supplier invoice/DR number, and check number. If a printed voucher needs correction, Finance edits the current voucher details but the system records revision/reprint history for accountability. At month end, Finance exports the same Cash Disbursement Excel format they already use.

Cash sales are Money In entries typed manually from OR-based invoice collections. They should feed reports but remain separate from invoices generated inside the app.

## Source Of Truth

- `job_expenses`: source of truth for operational disbursements/payables.
- New `cash_sales`: source of truth for manual OR collections.
- New `check_voucher_revisions`: append-only audit/reprint history for voucher changes after print.
- Reports and Excel exports read from operational tables; they do not write data.
- Legacy imported `legacy_accounting_entries` remains historical read-only support.

## Files

- Create: `supabase/migrations/<timestamp>_finance_disbursement_workflow.sql`
- Modify: `src/integrations/supabase/types.ts`
- Create: `src/lib/financeCategories.ts`
- Create: `src/lib/disbursementExport.ts`
- Create: `src/lib/disbursementExport.selftest.ts`
- Create: `src/lib/checkVoucherRevision.ts`
- Create: `src/lib/checkVoucherRevision.selftest.ts`
- Modify: `src/routes/_app.reports.tsx`
- Modify: `src/routes/expenses.$id.check-voucher.print.tsx`
- Optional after core works: create `src/routes/_app.cash-sales.tsx` only if `_app.reports.tsx` becomes too large.

## Task 1: Database Foundation

**Files:**
- Create: `supabase/migrations/<timestamp>_finance_disbursement_workflow.sql`
- Modify: `src/integrations/supabase/types.ts`

- [ ] Add a migration that keeps `job_expenses` as Money Out SSOT.

```sql
CREATE TYPE public.disbursement_category AS ENUM (
  'direct_materials',
  'petty_cash',
  'communication',
  'representation',
  'commission',
  'utilities',
  'salary_and_wages',
  'security_expenses',
  'efps',
  'egov',
  'other'
);

CREATE TYPE public.disbursement_subcategory AS ENUM (
  'direct_materials',
  'transportation',
  'gas',
  'meals',
  'load',
  'garbage_collection',
  'extra_salary',
  'parking',
  'globe',
  'smart',
  'meralco',
  'manila_water',
  'apeiros',
  '1601c',
  '2550q',
  'sss',
  'phic',
  'hdmf',
  'other'
);

ALTER TABLE public.job_expenses
  ADD COLUMN IF NOT EXISTS disbursement_category public.disbursement_category,
  ADD COLUMN IF NOT EXISTS disbursement_subcategory public.disbursement_subcategory,
  ADD COLUMN IF NOT EXISTS supplier_tin TEXT,
  ADD COLUMN IF NOT EXISTS supplier_address TEXT,
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  ADD COLUMN IF NOT EXISTS check_date DATE,
  ADD COLUMN IF NOT EXISTS voucher_printed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voucher_print_count INTEGER NOT NULL DEFAULT 0 CHECK (voucher_print_count >= 0);

CREATE TABLE IF NOT EXISTS public.check_voucher_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_expense_id UUID NOT NULL REFERENCES public.job_expenses(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES auth.users,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL,
  previous_values JSONB NOT NULL,
  new_values JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cash_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  or_number TEXT NOT NULL,
  collection_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_name TEXT,
  invoice_reference TEXT,
  description TEXT NOT NULL,
  gross_amount NUMERIC(14,2) NOT NULL CHECK (gross_amount > 0),
  vat_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  created_by UUID REFERENCES auth.users,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] Add RLS policies matching current accounting boundaries: read for report viewers, insert/update for `app_private.can_accounting_work()`, delete only if the project already permits admin deletes.
- [ ] Run `supabase migration up`, then regenerate/update `src/integrations/supabase/types.ts`.
- [ ] Verify with `npm.cmd exec tsc -- --noEmit`.

## Task 2: Finance Category Model

**Files:**
- Create: `src/lib/financeCategories.ts`
- Create/update selftest if local convention prefers direct `jiti` tests.

- [ ] Create the canonical category list used by forms, exports, and labels. Do not hardcode these labels independently in UI and export code.

```ts
export const DISBURSEMENT_CATEGORIES = [
  { value: "direct_materials", label: "Direct Materials" },
  { value: "petty_cash", label: "Petty Cash" },
  { value: "communication", label: "Communication" },
  { value: "representation", label: "Representation" },
  { value: "commission", label: "Commission" },
  { value: "utilities", label: "Utilities" },
  { value: "salary_and_wages", label: "Salary and Wages" },
  { value: "security_expenses", label: "Security Expenses" },
  { value: "efps", label: "EFPS" },
  { value: "egov", label: "EGOV" },
  { value: "other", label: "Other" },
] as const;
```

- [ ] Add subcategory mapping for petty cash, communication, utilities, security, EFPS, and EGOV.
- [ ] Add helper functions `categoryLabel(value)` and `subcategoryLabel(value)`.
- [ ] Verify with a selftest that every subcategory belongs to one category and every value has a label.

## Task 3: Money Out Form

**Files:**
- Modify: `src/routes/_app.reports.tsx`

- [ ] Rename the user-facing action from “Add general expense” to “Add disbursement”.
- [ ] Add form fields: category, subcategory, payee/company name, amount, tax, TIN, address, details, check date, supplier invoice/DR number, check number, payment status, due/payment date.
- [ ] Keep Job Order allocation optional. Label it “Allocate to Job Order” and default it empty.
- [ ] Validate Direct Materials: company/payee, amount, tax, TIN, and address must be complete when category is `direct_materials`.
- [ ] Validate paid cheque records: check number and check date are required when payment status is `paid`.
- [ ] Save to `job_expenses`; do not create a second disbursement table.
- [ ] Verify: add a pending petty cash row, a paid direct materials row, and a general utility row locally.

## Task 4: Check Voucher Edit And Audit

**Files:**
- Create: `src/lib/checkVoucherRevision.ts`
- Create: `src/lib/checkVoucherRevision.selftest.ts`
- Modify: `src/routes/_app.reports.tsx`

- [ ] Add a helper that compares voucher fields: payee, amount, details, check date, supplier invoice/DR number, check number.
- [ ] When voucher-related fields are edited after `voucher_printed_at` is set, require a correction reason.
- [ ] Insert one row into `check_voucher_revisions` with previous and new values before updating the expense.
- [ ] Show voucher status in Money Out: Not printed, Printed, Reprinted, Revised after print.
- [ ] Add a small revision history section in the row action or edit dialog.
- [ ] Verify: print/mark a voucher as printed, edit check number with reason, confirm history row exists.

## Task 5: Check Voucher Print Integration

**Files:**
- Modify: `src/routes/expenses.$id.check-voucher.print.tsx`

- [ ] Use `check_date` for voucher date when present, then fall back to `paid_at`, then `expense_date`.
- [ ] Include the client-required fields already present in print props: payee, amount, particulars/details, document number, and check number.
- [ ] Add a print confirmation action that updates `voucher_printed_at` and increments `voucher_print_count`.
- [ ] Keep amount-in-words only if the current physical template requires it; if the preprinted CV has no field, leave `formatPrintMoney` as-is and do not invent a new printed field.
- [ ] Verify browser preview and generated PDF still align with existing `checkVoucherLayout.ts`.

## Task 6: Manual OR Cash Sales

**Files:**
- Modify: `src/routes/_app.reports.tsx`
- Optional create: `src/routes/_app.cash-sales.tsx`

- [ ] Add “Add cash sale” on the Money In / Cash Sales tab.
- [ ] Save OR number, collection date, customer name, invoice reference, description, gross amount, and VAT amount to `cash_sales`.
- [ ] Show current `cash_sales` rows first, then legacy imported cash-sales rows as historical rows.
- [ ] Keep this manual entry separate from generated invoices so users do not enter invoice collections twice.
- [ ] Verify: create one OR collection and confirm it appears in Cash Sales and monthly P&L revenue.

## Task 7: Excel Export

**Files:**
- Create: `src/lib/disbursementExport.ts`
- Create: `src/lib/disbursementExport.selftest.ts`
- Modify: `src/routes/_app.reports.tsx`

- [ ] Add a CSV export first unless the existing app already has a workbook writer. Browser Excel opens CSV reliably and keeps the implementation simple.
- [ ] Export disbursement columns in the client’s workbook order: date, reference/CV number, payee/company, details, category, subcategory, invoice/DR number, check number, check date, TIN, address, amount, tax, total.
- [ ] Format rows from `job_expenses` only; include legacy imported rows only if Finance explicitly asks for old history in the same file.
- [ ] Use the shared category labels from `financeCategories.ts`.
- [ ] Verify export with at least one direct material, petty cash transportation, utility, EFPS, and EGOV row.

## Task 8: Reports Alignment

**Files:**
- Modify: `src/routes/_app.reports.tsx`

- [ ] Money Out Payables: show pending `job_expenses`.
- [ ] Money Out Disbursements: show paid `job_expenses`.
- [ ] P&L expenses: derive from paid disbursements and legacy history for the selected period.
- [ ] Project Profitability: include only rows where `job_order_id` is set.
- [ ] Cash Sales: include manual `cash_sales` plus historical imports in read-only form.
- [ ] Verify no report writes to `legacy_accounting_entries`.

## Task 9: Final Verification

- [ ] Run `npm.cmd exec tsc -- --noEmit`.
- [ ] Run targeted selftests with `pnpm exec jiti src/lib/disbursementExport.selftest.ts` and `pnpm exec jiti src/lib/checkVoucherRevision.selftest.ts`.
- [ ] Run `pnpm run build`.
- [ ] Run `git diff --check`.
- [ ] Manually test: add disbursement, mark paid, print voucher, edit after print with reason, export CSV, add OR cash sale, confirm reports.

## Open Business Confirmations

- When a printed voucher is corrected, should the existing voucher/check number remain and be marked revised, or should Finance void and issue a new voucher number?
- Should the Excel export include legacy imported disbursement history, or only new operational disbursements?
- Does the physical check voucher template need amount-in-words printed, or only numeric amount?

## Implementation Order

1. Database foundation.
2. Shared category/label helpers.
3. Money Out entry/edit workflow.
4. Voucher printed/revised history.
5. Voucher print integration.
6. Manual OR cash sales.
7. Excel export.
8. Report derivations.
9. End-to-end verification.
