# Production Purchasing Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let assigned Production users reserve stock and atomically request missing materials while restricting supplier, ordering, cancellation, and receiving decisions to Owner and Admin.

**Architecture:** Keep `purchase_requests` as the procurement SSOT. Add one item-assignment-aware RPC that derives shortages and upserts requested lines transactionally; group those existing rows by Job Order in Purchasing without storing a batch entity.

**Tech Stack:** React 19, TypeScript, TanStack Router/Query, Supabase Postgres/RLS/RPC, Node contract tests, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-09-09-production-purchasing-boundary-design.md`

## Global Constraints

- Production retains reservation access only for assigned Job Order items.
- Production cannot choose suppliers or order, cancel, or receive purchases.
- `purchase_requests` remains the only procurement-demand source of truth.
- No batch table, approval table, duplicated shortage flag, new dependency, or SLA behavior.
- All database changes use one forward migration and preserve historical rows.
- Local database and E2E verification must pass before pushing to `njl/main`.

---

### Task 1: Atomic material-request command and authorization boundary

**Files:**
- Create: `supabase/migrations/20260910174000_production_material_request_boundary.sql`
- Create: `tests/production-material-request-boundary-contract.mjs`
- Create: `tests/production-material-request-authorization.sql`
- Modify: `package.json`
- Regenerate: `src/integrations/supabase/types.ts`

**Interfaces:**
- Consumes: `production_item_assignments`, released `job_boms`/`job_bom_items`, inventory availability, and active `purchase_requests`.
- Produces: `public.request_missing_production_materials(p_job_order_id uuid, p_material_ids uuid[], p_idempotency_key text)` returning affected request IDs/material IDs/requested quantities.

- [ ] **Step 1: Write a failing migration contract**

Assert that the new migration defines one set-based RPC, validates active item assignment, derives quantities server-side, accepts no supplier/status fields, and grants execution only to `authenticated`.

- [ ] **Step 2: Run the contract and verify RED**

Run: `node tests/production-material-request-boundary-contract.mjs`

Expected: failure because migration `20260910174000_production_material_request_boundary.sql` does not exist.

- [ ] **Step 3: Write a failing database authorization scenario**

Cover assigned Production success, unassigned Production denial, unrelated-role denial, Owner/Admin success, released-BOM validation, server-derived quantity, multi-line atomicity, and retry deduplication. Verify Production cannot invoke supplier/order/receipt lifecycle functions.

- [ ] **Step 4: Implement the minimal forward migration**

Create the RPC with `SECURITY DEFINER`, fixed `search_path`, explicit caller checks, item-scoped authorization, row locking, existing active-request upsert behavior, and an audit-safe transaction. Preserve existing Admin purchasing functions and revoke Production access to lifecycle commands at the function/grant boundary.

- [ ] **Step 5: Apply locally and verify GREEN**

Run the contract, apply the migration to `supabase_db_local` with `ON_ERROR_STOP`, register the local version, run the SQL authorization scenario, and regenerate Supabase types from local Postgres.

- [ ] **Step 6: Commit the database boundary**

Commit message: `feat: guard production material requests`

### Task 2: Production request UX

**Files:**
- Modify: `src/routes/_app.production.$jobOrderId.tsx`
- Modify: `src/components/AppSidebar.tsx` only if the current role-derived navigation contract fails.
- Create: `tests/production-material-request-ui-contract.mjs`

**Interfaces:**
- Consumes: `request_missing_production_materials` and existing request rows visible for the assigned Job Order.
- Produces: one **Request missing materials** action, per-material **Requested from Purchasing** state, and no navigation into Purchasing for Production.

- [ ] **Step 1: Write a failing UI contract**

Assert one RPC invocation for the selected shortage material IDs, one idempotency key, no `Promise.all(create_shortage_request)`, role-appropriate success copy, and no Production redirect to `/purchasing`.

- [ ] **Step 2: Run the contract and verify RED**

Run: `node tests/production-material-request-ui-contract.mjs`

Expected: failure because the route still calls `create_shortage_request` repeatedly and navigates to Purchasing.

- [ ] **Step 3: Implement the minimal route change**

Replace repeated shortage RPC calls with the set-based command. Keep Production on the document, invalidate production/readiness/request queries, show affected/skipped counts, and derive row labels from active `purchase_requests`.

- [ ] **Step 4: Verify GREEN and regressions**

Run the new contract plus production role, assignment, material ownership, optimistic status, mobile layout, and remarks contracts.

- [ ] **Step 5: Commit the Production UX**

Commit message: `feat: submit production shortages to purchasing`

### Task 3: Admin Purchasing grouping

**Files:**
- Modify: `src/routes/_app.purchasing.index.tsx`
- Create: `tests/purchasing-job-request-grouping-contract.mjs`

**Interfaces:**
- Consumes: existing `purchase_requests`, Job Order/project metadata, material, requester, supplier, quantities, and lifecycle status.
- Produces: derived Job Order groups and a distinct standalone replenishment section; existing detail route remains the lifecycle editor.

- [ ] **Step 1: Write a failing grouping contract**

Assert the queue groups Job Order requests by `job_order_id`, labels Production requests separately from standalone replenishment, preserves one Open action per request line, and keeps Admin-only purchasing controls.

- [ ] **Step 2: Run the contract and verify RED**

Run: `node tests/purchasing-job-request-grouping-contract.mjs`

Expected: failure because the current queue is a flat request table.

- [ ] **Step 3: Implement derived grouping without schema state**

Group fetched rows in memory by Job Order for rendering. Show Job Order number/project/requester/request time once per group, retain line quantities/status/actions, and render `job_order_id IS NULL` rows under Standalone replenishment.

- [ ] **Step 4: Verify GREEN and Purchasing regressions**

Run the grouping contract, browser-compatibility, supplier-schema, triage, and order-lifecycle contracts.

- [ ] **Step 5: Commit the Admin queue**

Commit message: `feat: group production requests in purchasing`

### Task 4: Local E2E, release, cloud SQL, and live E2E

**Files:**
- Modify tests only if a test exposes a verified product defect; production fixes require a new failing test first.

**Interfaces:**
- Consumes: Tasks 1–3 and the local Owner/Admin/Production fixtures.
- Produces: verified commits on `njl/main`, exact cloud SQL instructions, and an evidence-backed live E2E report.

- [ ] **Step 1: Run full automated verification**

Run `npm run test:operations`, all new contracts, `git diff --check`, targeted ESLint for changed files, and `npm run build`. Report pre-existing warnings separately; do not hide failures.

- [ ] **Step 2: Run local role E2E**

Verify Owner assignment, Production default landing/restricted navigation/reservation/request submission, Admin grouped queue/supplier/order/controlled receipt, request/readiness propagation, desktop/mobile layouts, and browser error logs.

- [ ] **Step 3: Restore local test data**

Restore all fixture statuses, assignments, requests, movements, and audit rows changed solely by E2E; verify the restoration with read-only queries.

- [ ] **Step 4: Push verified commits to main**

Fetch `njl/main`, confirm the branch is based on current remote main, then push `HEAD:main`. Verify local HEAD equals `njl/main` after fetching.

- [ ] **Step 5: Hand off and verify cloud migration**

Provide the complete contents/link for `20260910174000_production_material_request_boundary.sql` and a read-only verification query. Stop if Lovable Cloud reports an error.

- [ ] **Step 6: Run live role E2E**

After migration confirmation, test the authorized live Job Order across Owner, Admin, and Production. Check frontend console errors and visible backend errors at every boundary. Request action-time confirmation before deleting or cancelling any live record.

