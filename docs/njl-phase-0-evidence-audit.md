# NJL / Graphic Wizard — Phase 0 evidence audit

Status: **complete for the approved local demo prototype — not a production
implementation approval**

This document records what is verified locally and what still requires an
explicit client decision. It follows the approved Phase 0 definition in
`NJLplan_1.txt`: establish evidence, scope, ownership, and acceptance criteria
before treating an inventory or production workflow as deployable.

## Approved local-demo scope

The product owner approved continuing with the existing local sample data for
demonstration and workflow review. This authorizes a local-only prototype of
the operational flow; it does **not** replace the evidence required for an
NJL or Graphic Wizard production rollout.

- Sample BOMs, materials, opening quantities, suppliers, and users remain
  fixtures only and must be visibly treated as non-client data.
- No hosted database, client inventory balance, client pricing, or production
  workflow is changed under this approval.
- The demo’s purpose is to validate the connected workflow and collect client
  decisions, not to certify operational accounting or stock accuracy.

## Verified locally

- The application is a single-workspace modular monolith using TanStack React,
  TypeScript, Postgres, and Supabase.
- The commercial workflow is Quote → Job Order → delivery/invoice/finance.
  `job_expenses` remains financial truth and is not used as stock truth.
- Job Order is the commercial source of truth. The local prototype treats its
  BOM snapshot as the production material plan and inventory movements as the
  physical-stock ledger.
- Local Owner-session UAT has exercised plan/release, partial reservation,
  shortage request, partial receipt, material consumption, reconciliation, and
  the hand-off to Job Order `ready`.
- The local schema contains operational materials, BOM, movement, purchasing,
  supplier, and audit structures. The local prototype adds audit coverage,
  guarded RPC boundaries, immutable ledger corrections, and derived queue
  reads.
- The local database is **not** evidence of the hosted NJL database or of a
  client-approved opening inventory, BOM, role matrix, or release rule.

## Decisions that still require NJL confirmation

| Decision | Why it blocks production rollout |
| --- | --- |
| Production release event | Quote approval, down payment, layout approval, sample approval, and explicit owner release have different business consequences. |
| Job material owner and approver | Determines who may prepare, change, release, issue, and reconcile BOM quantities. |
| Reservation policy | Partial reservation and stock blocking must match how NJL actually allocates materials. |
| Shortage and purchasing handoff | The local prototype creates a purchase request; NJL must confirm whether that is the real action and who may cancel or receive it. |
| Units, packs, conversions, offcuts | Incorrect conversion or unit assumptions corrupt stock and job actuals. |
| Waste, reprint, substitution, and variance approval | Needed to define the completion gate and the required approver. |
| Opening stock cutover | Opening quantities must come from a signed physical count, never inferred from expenses. |
| Visibility and role matrix | Stock, purchasing, cost, profit, and audit information need explicit role-by-role approval. |
| NJL vs Graphic Wizard separation | Separate deployments/databases remain the safe default unless a distinct multi-tenant architecture is approved. |

## Required artifacts

For each client, obtain:

1. Three representative completed jobs, including planned materials, actual
   use, returns/waste, purchase/receipt evidence, and final outcome.
2. Current material master and physical stock count with units, pack sizes, and
   conversion rules.
3. Current forms or samples for receiving, material issue, return, waste,
   correction, and purchasing.
4. Confirmed users, roles, and approval delegation.
5. Written acceptance criteria for the enabled workflow and confirmation of
   non-goals.
6. For Graphic Wizard, the validated Jhay prototype/workflow reference if it
   remains in scope.

## Phase 0 exit checklist

### Local-demo exit

- [x] Local-only scope is explicitly approved.
- [x] Demo data is distinguished from customer opening balances and BOMs.
- [x] The workflow’s SSOT and safety boundaries are documented.
- [x] Local prototype scenarios are re-run against the current local database:
      the inventory workflow self-test passes and the locally served Production
      route responds successfully. The focused scenario covers BOM planning,
      reservation, shortage/receipt, consumption, return/waste compensation,
      reconciliation, and Job Order hand-off.

### Production-rollout gates (still required)

- [ ] NJL workflow decisions are confirmed in writing.
- [ ] Graphic Wizard workflow decisions are confirmed in writing.
- [ ] Both clients provide representative records and acceptance criteria.
- [ ] Hosted schema, migrations, functions, RLS, and roles are read-only
      audited before any hosted rollout.
- [ ] Separate deployments/databases are confirmed, or a separate tenancy
      project is approved.
- [ ] Exact Job Order release, correction, and material immutability rules are
      signed off.
- [ ] Local prototype scenarios are re-run using confirmed sample data.

## Current recommendation

The Phase 0 local-demo gate is met once the listed local prototype scenarios
pass. Keep the work local and labelled as a development prototype. Do not load
customer opening balances or deploy this operational workflow until the
production-rollout gates are complete.
