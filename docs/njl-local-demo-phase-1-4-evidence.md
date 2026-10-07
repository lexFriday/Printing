# NJL local demo — Phases 1–4 evidence

Status: **implemented and locally verified at the operational-contract level**.

This is a local demo result. It is not authorization to load NJL stock,
materials, suppliers, or customer data into a hosted environment.

## Workflow and sources of truth

`Approved quote → Job Order → prepared/released Job Order BOM → reserve stock →
purchase shortage → receipt → consume/return/waste → reconcile → production
complete → Job Order ready`

- A quotation’s material estimate is staff-only planning evidence.
- `job_boms` / `job_bom_items` are the Job Order material-plan truth.
- `inventory_movements` is physical stock truth; balances, shortages, and
  readiness are derived.
- `job_expenses` remains finance-only. It is labelled **Financial expenses**
  in the Job Order UI and does not control stock or material consumption.

## Phase 1 — foundations

Verified and corrected locally:

- Production-plan and release commands now admit only the real `pending` Job
  Order state. The previous `open` predicate could never succeed because it
  is not a Job Order status.
- A Job Order with a Production document cannot be marked ready directly while
  production is incomplete. Legacy jobs without a Production document retain
  their existing completion path.
- Storage policies use `app_private.has_role`, the executable private helper,
  rather than an inaccessible public function. The full local RLS role
  boundary test now passes.

## Phase 2 — material catalog and Job Order requirements

- Materials, BOM templates, quote estimates, Job Order BOM snapshots, and
  immutable released BOM items are present.
- A prepared BOM copied from a quotation is released as-is; it is never merged
  with a selected template. A template is used only when the Job Order has no
  prepared materials. This preserves material-plan provenance.
- Quotation estimates remain staff-facing and are not customer document data.

## Phase 3 — physical ledger and purchasing

- Receipt, reservation, reservation release, consumption, return, waste,
  correction/reversal, purchase request, partial receipt, and audit paths are
  guarded by local RPCs.
- The shortage calculation uses the remaining requirement:
  `planned − this-job reservation − currently available stock`, then rounds to
  the material pack size.
- A local scenario proved that a material with available stock produces no
  request, while an unavailable 8-unit ink requirement with a 1,000-unit pack
  produces a 1,000-unit request.

## Phase 4 — connected operational UX

- Production, Inventory, and Purchasing have queue and document routes.
- Job Orders link into Production; the Production document links to inventory
  and the originating purchase request; inventory movements link back to jobs.
- The Production UI releases an existing prepared Job Order BOM without a
  template and shows reservation/shortage/readiness before it offers start.
- Job Order handoff fields have accessible labels.

## Verification run

Passed locally on 2026-08-31:

```text
npm run test:operations
  fabrication inventory self-test: passed
  operations production contract: passed
  RLS role boundary checks passed

npm run build
  completed; local .output refreshed

npm run uat
  passed (12 tests; 4 existing opt-in client-workflow scenarios skipped)
```

The local migration history contains `20260831192000` through
`20260831196000`; direct database inspection confirms that production release
uses `pending` and shortage logic uses the remaining requirement.

## Remaining release gates

- Generated Supabase TypeScript types do not contain the local operations
  schema. The local CLI cannot currently associate with these already-running
  containers to regenerate them; routes therefore retain existing temporary
  casts. Repair that local CLI association and regenerate types before merge.
- Full lint remains blocked by the repository-wide CRLF/Prettier baseline. Do
  not mass-format this dirty workspace without a separate approved cleanup.
- Real BOMs, opening stock, suppliers, approval rules, and a hosted read-only
  schema/RLS audit remain mandatory before production rollout.
