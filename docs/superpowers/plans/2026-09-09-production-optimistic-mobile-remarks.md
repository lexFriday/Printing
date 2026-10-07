# Production Optimistic UX, Mobile Layout, and Remarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Production-role users land in Production, make non-inventory Production actions genuinely optimistic with rollback, make the Production queue/detail usable on mobile, and add assignment-scoped Production remarks.

**Architecture:** Keep the existing TanStack Router, React Query, Supabase RPC, and assignment-boundary architecture. Reuse `production_jobs` as the Production record, add only a dedicated `remarks` field because existing `notes` owns reconciliation reasons, and keep all inventory/material quantities server-confirmed.

**Tech Stack:** React 19, TypeScript, TanStack Router, TanStack Query, Tailwind CSS, Supabase/Postgres, Node assertion-based contract tests, Playwright for responsive verification.

**Spec:** Bounded design approved in the current Codex task; assignment and permission baseline: `docs/superpowers/specs/2026-09-09-production-item-assignments-design.md`.

## Global Constraints

- SLA is out of scope until the client confirms its definition.
- Production users may only read or change Job Orders/items assigned to them.
- Do not weaken RLS or restore direct table writes; mutations remain guarded RPCs.
- Optimistic updates apply only to Production task and workflow statuses, never inventory, reservations, consumption, returns, waste, shortages, BOM release, or material confirmation.
- Roll back optimistic cache changes on RPC failure and invalidate authoritative queries after settlement.
- `production_jobs.notes` remains reconciliation data; Production remarks use a separate `remarks` column.
- No new state library, workflow engine, cache abstraction, or component framework.
- Preserve audit logging, validation, tenant/user boundaries, desktop behavior, and accessible controls.

---

### Task 1: Role-aware Production landing

**Files:**

- Modify: `src/lib/roles.ts`
- Modify: `src/routes/auth.tsx`
- Modify: `src/routes/index.tsx`
- Create: `tests/production-default-landing-contract.mjs`

**Interfaces:**

- Produce: `defaultLandingForRole(role: AppRole | null): "/production" | "/quotes" | "/dashboard"`
- Consume: the authenticated user's own `user_roles.role` row when resolving `/`

- [ ] **Step 1: Write the failing landing contract**

  Assert that the shared landing helper maps `production` to `/production`, `sales` to `/quotes`, and other known roles to `/dashboard`. Assert both `/auth` and `/` use the shared helper and that `/auth` no longer contains `return "/jobs"` for Production.

- [ ] **Step 2: Run the contract and confirm it fails for the current `/jobs` mapping**

  Run: `node tests/production-default-landing-contract.mjs`

- [ ] **Step 3: Add the smallest shared landing helper**

  Put `defaultLandingForRole` in `src/lib/roles.ts`; do not introduce a new routing service or configuration map.

- [ ] **Step 4: Use it after sign-in and when opening `/` with an existing session**

  In `auth.tsx`, remove the local helper and import the shared helper. In `index.tsx`, after `getSession()`, query only the signed-in user's role, then redirect using the same helper. If the role query fails or no role exists, use `/dashboard` so the existing access guard remains authoritative.

- [ ] **Step 5: Verify and commit**

  Run the contract and `npm run build`. Commit: `fix: route production users to production workspace`.

---

### Task 2: True optimistic Production task/status actions

**Files:**

- Modify: `src/routes/_app.production.$jobOrderId.tsx`
- Modify: `src/routes/_app.production.index.tsx` only if queue cache reconciliation requires it
- Create: `tests/production-optimistic-status-contract.mjs`

**Interfaces:**

- Consume query keys already owned by the Production routes, including `production-document`, Production tasks, item readiness, and `production-workspace-queue`.
- Produce React Query mutation lifecycle behavior: `onMutate` snapshot/update, `onError` rollback, and `onSettled` invalidation.

- [ ] **Step 1: Inventory current status mutation/cache shapes**

  Read every Production `useMutation` completely. Record which exact query owns each displayed task status, item status, and overall `production_jobs.status`. Do not optimistically modify derived readiness or inventory query data.

- [ ] **Step 2: Write a failing structural regression contract**

  Require optimistic lifecycle hooks for `update_production_task`, `start_production`, `reconcile_production`, and `complete_production`. Require cancellation/snapshot before update, rollback on error, and authoritative invalidation on settlement. Explicitly assert material and inventory mutations do not receive optimistic quantity updates.

- [ ] **Step 3: Run the contract and confirm the missing lifecycle behavior**

  Run: `node tests/production-optimistic-status-contract.mjs`.

- [ ] **Step 4: Implement task-status optimism first**

  In the existing `updateTask` mutation, cancel the task query, snapshot its data, update only the selected task's `status`/`hold_reason`, and update only safely derivable item/queue labels. Return the snapshot context and restore it in `onError` before showing the error toast.

- [ ] **Step 5: Implement workflow-status optimism**

  Apply the same lifecycle to start, reconcile, and complete mutations. Update only the displayed `production_jobs.status` and timestamps whose transition is deterministic. Do not predict material readiness, exception approval, inventory quantities, or Job Order financial/status side effects.

- [ ] **Step 6: Reconcile every optimistic action with server truth**

  Use `onSettled` to invalidate the mutation's existing Production queries and `production-workspace-queue`. Avoid duplicate refetch calls where invalidation already owns reconciliation.

- [ ] **Step 7: Verify success and rollback paths**

  Run the new contract, existing Production contracts, and targeted local/manual tests with one forced RPC rejection to demonstrate rollback. Commit: `feat: add optimistic production status updates`.

---

### Task 3: Assignment-scoped Production remarks

**Files:**

- Create: `supabase/migrations/20260910173000_production_remarks.sql`
- Modify: `src/integrations/supabase/types.ts`
- Modify: `src/routes/_app.production.$jobOrderId.tsx`
- Create: `tests/production-remarks-contract.mjs`
- Extend when local Postgres is available: `tests/production-assignment-authorization.sql`

**Interfaces:**

- Database field: `public.production_jobs.remarks TEXT NULL`
- RPC: `public.update_production_remarks(p_job_order_id UUID, p_remarks TEXT) RETURNS public.production_jobs`
- Authorization: `public.can_access_production_job(auth.uid(), p_job_order_id)`

- [ ] **Step 1: Write the failing remarks contract**

  Require a dedicated nullable `remarks` column, assignment-scoped RPC authorization, a 2,000-character limit, blank-to-NULL normalization, audit logging, revoked PUBLIC access, authenticated execute permission, and a Production UI that calls the RPC rather than updating the table.

- [ ] **Step 2: Run the contract and confirm it fails**

  Run: `node tests/production-remarks-contract.mjs`.

- [ ] **Step 3: Add the migration**

  Add `remarks` idempotently. Implement `update_production_remarks` as `SECURITY DEFINER` with `search_path = public, pg_temp`; reject unauthorized/unassigned users with SQLSTATE `42501`, reject text over 2,000 characters, lock/update the target Production row, and write old/new values to `audit_logs`.

- [ ] **Step 4: Update generated database types narrowly**

  Add `remarks` to `production_jobs.Row`, `.Insert`, and `.Update`, plus the RPC signature if this repository's generated type section includes function definitions. Do not hand-edit unrelated generated entries.

- [ ] **Step 5: Add the remarks UI to Production detail**

  Add one clearly labeled “Production remarks” card/section near production details—not inside material or reconciliation forms. Use a controlled textarea, explicit Save button, character limit/help text, loading, success, and error states. Server-confirm the save; do not optimistically persist remarks.

- [ ] **Step 6: Verify database and UI boundaries**

  Run the contract. If local Supabase/Docker is available, prove assigned Production and Owner/Admin/Staff can update, unassigned Production cannot, and an audit row is written. If unavailable, report that limitation explicitly and do not claim database execution coverage.

- [ ] **Step 7: Commit**

  Commit: `feat: add audited production remarks`.

---

### Task 4: Mobile-responsive Production queue and detail

**Files:**

- Modify: `src/routes/_app.production.index.tsx`
- Modify: `src/routes/_app.production.$jobOrderId.tsx`
- Modify only if shared primitives are the confirmed source: relevant files under `src/components/ui/`
- Create: `tests/production-mobile-layout-contract.mjs`
- Extend: `tests/uat/production-item-deep-link.spec.ts`

**Interfaces:**

- Supported verification widths: 375px phone, 768px tablet, existing desktop viewport.
- Preserve the existing queue views, deep links, assignment dialog, status workflow, and item anchors.

- [ ] **Step 1: Capture current overflow and action-priority failures**

  Run the local app and inspect both Production routes at 375px and 768px. Record only reproducible failures: horizontal page overflow, clipped dialogs/tables, unreachable actions, compressed labels, or desktop-only action placement.

- [ ] **Step 2: Write the failing mobile layout contract/UAT assertions**

  Assert no document-level horizontal overflow at 375px, primary “Open item” actions remain visible, dialogs fit within the viewport, and status/task controls remain operable. Keep this focused on Production; do not start a global responsive redesign.

- [ ] **Step 3: Fix the queue with existing Tailwind primitives**

  Keep its card/list structure. Use mobile-first padding/type sizing, full-width primary buttons on narrow screens, wrapping status metadata, and `min-w-0` where content currently forces overflow. Retain the desktop two-column layout at `md` and above.

- [ ] **Step 4: Fix the detail page by workflow priority**

  Stack header/action groups on phones, make the single next action prominent, wrap or horizontally contain genuinely tabular content, prevent select/input/dialog widths from exceeding the viewport, and avoid fixed/sticky elements covering form actions. Do not hide status, blockers, assignment, materials, task controls, or remarks.

- [ ] **Step 5: Verify responsive behavior visually and functionally**

  Test 375px, 768px, and desktop. Exercise deep-link scrolling, task status changes, dialogs, material sections, and remarks. Capture screenshots only as verification artifacts; do not add them to application source unless requested.

- [ ] **Step 6: Run React review and commit**

  Apply `vercel:react-best-practices` to the modified TSX files. Run the responsive contract/UAT and build. Commit: `fix: make production workflow mobile responsive`.

---

### Task 5: Final integration verification and main-branch delivery

**Files:**

- Verify all files changed by Tasks 1–4
- Do not edit unrelated files to satisfy pre-existing failures

- [ ] **Step 1: Run focused tests**

  Run the four new contracts plus existing Production role, assignment, item, task-write, material-boundary, board, and deep-link tests.

- [ ] **Step 2: Run production build and diff checks**

  Run `npm run build` and `git diff --check`. Record any warnings separately from failures.

- [ ] **Step 3: Perform workflow UAT**

  Verify: Production login → `/production`; assigned queue → item detail; optimistic task/status success; forced failure rollback; mobile navigation/actions; remarks save/reload; unassigned-job denial; no optimistic inventory change.

- [ ] **Step 4: Review migration safety**

  Confirm the migration is additive/idempotent, uses assignment-scoped authorization, preserves `notes`, audits remarks, and requires no destructive data rewrite. Provide the SQL file for manual Lovable/Supabase execution if automatic migration deployment is unavailable.

- [ ] **Step 5: Fetch and push safely**

  Fetch `njl/main`, verify it has not diverged from the implementation base, commit any final test-only adjustment separately, and push `HEAD:main`. Never push to `kolourpro`.

## Required Skill Order for the Implementing Codex Task

1. `ponytail` — enforce the smallest solution and no new architecture.
2. `superpowers:executing-plans` or `superpowers:subagent-driven-development` — execute this approved plan task-by-task.
3. `superpowers:test-driven-development` — red/green cycle for each task.
4. `superpowers:systematic-debugging` — only when observed behavior differs from the plan or a test fails unexpectedly.
5. `vercel:react-best-practices` — review the changed Production React files after implementation.
6. `superpowers:verification-before-completion` — fresh tests/build/diff evidence before committing and pushing.

## Explicit Non-Goals

- No SLA fields, timers, breach statuses, pause rules, exception clocks, notifications, or reports.
- No optimistic inventory/material/BOM writes.
- No global mobile redesign.
- No replacement of React Query or TanStack Router.
- No direct client updates to `production_jobs`.
- No reuse or overwrite of reconciliation `notes` for general remarks.
