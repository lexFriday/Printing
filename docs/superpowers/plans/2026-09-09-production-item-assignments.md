# Production Item Assignments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-safe, item-level multi-assignee workflow with clear worker queues, contextual assignment, and database-enforced access.

**Architecture:** Immutable Job Order line items own item identity; a normalized soft-removal join table owns assignments. Queue/readiness views are derived through RPCs, while item-targeted database functions enforce worker access and optimistic concurrency.

**Tech Stack:** React 19, TanStack Router/Query, TypeScript, Supabase Postgres/RLS/RPC, Node contract tests, Playwright/browser verification.

**Spec:** `docs/superpowers/specs/2026-09-09-production-item-assignments-design.md`

## Global Constraints

- Preserve unrelated dirty-worktree changes.
- Only Owner/Admin may change assignments.
- Production users may read and update only assigned item work.
- Do not run remote migrations until migration history is reconciled.
- Keep readiness, blockers, and completion derived.
- Preserve audit, immutable document, inventory, purchasing, and idempotency controls.

---

### Task 1: Lock behavior with failing contracts

**Files:**
- Create: `tests/production-item-assignment-contract.mjs`
- Create: `src/lib/productionQueue.selftest.ts`
- Create: `src/lib/productionQueue.ts`

**Interfaces:**
- Produces: `productionStatusLabel(value: string | null): string` and contracts for table/RPC/RLS/UX behavior.

- [ ] Write assertions for null status, normalized item assignments, soft removal, active uniqueness, expected-user concurrency, role validation, item-scoped access, contextual UI, three primary queue views, search, final-assignee confirmation, and staff copy.
- [ ] Run the tests and confirm failures identify missing behavior.
- [ ] Implement only the null-safe status helper and integrate it into the queue.
- [ ] Run the helper test and confirm the live queue no longer crashes.

### Task 2: Add the item-assignment database source of truth

**Files:**
- Create: `supabase/migrations/20260909194000_production_item_assignments.sql`
- Modify: `tests/production-assignment-authorization.sql`

**Interfaces:**
- Produces: `production_item_assignments`, `set_production_item_assignments(UUID,UUID[],UUID[])`, `production_assignment_options()`, `production_workspace_queue()`, `can_access_production_item(UUID,UUID)`, and item-scoped document/task functions.

- [ ] Add the normalized table, partial unique index, RLS, audit trigger, legacy project-assignment backfill, and retirement update.
- [ ] Implement expected-set concurrency under item lock and validate active Production users.
- [ ] Replace project/task-assignee authorization with item-assignment authorization in public RPCs and policies.
- [ ] Update SQL scenarios for duplicate, inactive, removed, unauthorized, concurrent, and multiple-user assignments.
- [ ] Run source contracts; run SQL scenarios only against an isolated migrated database.

### Task 3: Build the role-aware item queue

**Files:**
- Modify: `src/routes/_app.production.index.tsx`
- Modify: `src/integrations/supabase/types.ts`

**Interfaces:**
- Consumes: item rows from `production_workspace_queue()`.
- Produces: Needs assignment, Active/My Production, and Completed views with derived status/blocker/next action.

- [ ] Replace Job Order cards with item rows ordered by urgency and immutable item order.
- [ ] Use null-safe labels, explicit role-aware copy, counts, and recoverable loading/error/empty states.
- [ ] Add a searchable assignment dialog with workload, preserved selection, stale-save recovery, and final-assignee confirmation.
- [ ] Run contract, accessibility, and responsive browser checks.

### Task 4: Add contextual assignment and item-scoped work

**Files:**
- Modify: `src/routes/_app.production.$jobOrderId.tsx`
- Modify: `src/routes/_app.jobs.$id.tsx`

**Interfaces:**
- Consumes: item assignments and item-scoped task/readiness results.
- Produces: assignment controls on each item card and deep links to the current item step.

- [ ] Render assigned people, readiness, blocker, current step, and next action per product card.
- [ ] Reuse the assignment dialog in context without navigating back to the queue.
- [ ] For Production users, hide unrelated items and anchor the assigned item/current step.
- [ ] Preserve Owner/Admin/Staff operational visibility and existing materials/purchasing handoffs.
- [ ] Verify keyboard focus returns to the invoking item after dialog close.

### Task 5: Reconcile tests and verify the full workflow

**Files:**
- Modify: `tests/production-board-contract.mjs`
- Modify: `tests/production-lead-handoff-contract.mjs`
- Modify: `tests/operations-production-contract.mjs`
- Modify: `package.json`
- Create: `docs/deployment/production-item-assignment-rollout.md`

**Interfaces:**
- Produces: one non-contradictory operations suite and deployment/rollback instructions.

- [ ] Remove stale project/task-assignment expectations and assert the item-assignment SSOT.
- [ ] Run focused tests, operations tests, signature tests, inventory tests, RLS scenarios, and production build.
- [ ] Verify Owner/Admin, Staff, Production, and denied-user scenarios in the browser at desktop and mobile sizes.
- [ ] Reconcile local/remote migration histories and record exact safe apply/rollback commands without applying an unsafe remote change.
- [ ] Run a security diff scan focused on SECURITY DEFINER functions, grants, RLS, tenant boundaries, and assignment escalation.
- [ ] Record screenshots, exact test results, known blockers, and confirmation that unrelated changes remain preserved.

