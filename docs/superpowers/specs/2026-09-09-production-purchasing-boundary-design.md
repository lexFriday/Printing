# Production Material Request and Purchasing Boundary

## Objective

Production workers may reserve available inventory for their assigned Job Order items and request missing materials. Only Owner and Admin users may make purchasing decisions: select suppliers, create or issue purchase orders, change purchasing status, and record receipts.

This change must reuse `purchase_requests` as the single source of truth. It must not introduce a separate batch header, approval table, or duplicate readiness state.

## Workflow

1. An assigned Production worker reviews the released Job Order BOM and current availability.
2. The worker may reserve available stock for an assigned item.
3. For shortages, the worker submits all currently missing materials with one **Request missing materials** action.
4. The server atomically creates or updates `purchase_requests` rows in `requested` status, scoped to the Job Order and material.
5. Production remains in the Production workspace and sees the request state beside each shortage. Production does not enter Purchasing.
6. Purchasing groups requested rows by Job Order for Admin review. This grouping is a derived view, not stored batch state.
7. Owner or Admin reviews quantities, selects suppliers, and advances requests to `ordered` through the existing guarded purchasing commands.
8. Owner or Admin records receipts. Inventory balances and Production readiness continue to derive from operational records.

## Source of Truth

- `job_bom_items` owns required material and planned quantity for each immutable Job Order item.
- Inventory movements own reservations, consumption, return, waste, and receipt history.
- `purchase_requests` owns procurement demand and its lifecycle (`requested`, `ordered`, `partially_received`, `received`, or `cancelled`).
- `production_item_assignments` owns which Production users may act on each Job Order item.
- Production readiness remains derived from BOM requirements, inventory balances/movements, and open purchase quantities.

No `batch_status`, duplicated shortage flag, or Production-specific purchasing record will be added.

## Authorization Boundary

### Production

- May view Inventory availability needed for operational decisions.
- May reserve inventory only for a Job Order item currently assigned to the user.
- May submit missing-material requests only for assigned items with a released BOM and an active Production workflow.
- May view request status and quantities for assigned items from Production.
- Cannot open the Purchasing module.
- Cannot create standalone replenishment requests.
- Cannot choose or create suppliers.
- Cannot set a request to `ordered`, `partially_received`, `received`, or `cancelled`.
- Cannot record material receipts.

### Owner and Admin

- May view the complete Purchasing queue.
- May create standalone replenishment requests.
- May review Production requests, select suppliers, order, cancel remaining quantities, and record receipts through guarded commands.

These rules must be enforced in database functions and grants/RLS. Route visibility and disabled buttons are supporting UX, not the security boundary.

## Request Submission

Replace repeated client-side calls with one guarded RPC accepting the Job Order ID and the missing material IDs derived from the released BOM. The RPC must:

- verify the caller is active;
- verify every requested material belongs to a Job Order item assigned to a Production caller, while retaining Owner/Admin access;
- lock or upsert by the existing active `(job_order_id, material_id)` uniqueness rule;
- calculate required shortage quantity on the server from BOM requirements and current reservation/availability state;
- create only `requested` rows and never accept supplier or lifecycle status from Production;
- use one idempotency key for safe retry;
- write normal audit history with the requesting user;
- return the affected request identifiers and current quantities.

The client must not calculate or persist authoritative shortage quantities.

## Batching UX

“Batch” means one submission action and one grouped Admin queue section per Job Order. It does not mean a new stored batch entity.

Production:

- Primary action: **Request missing materials**.
- Confirmation explains how many materials will be sent to Purchasing.
- Success stays on the Production document and changes each affected row to **Requested from Purchasing**.
- Existing active requests are updated idempotently rather than duplicated.

Purchasing:

- Group Job Order shortage requests under Job Order number, project, requester, and request time.
- Keep standalone inventory replenishment requests in a separate clearly labeled group.
- The primary Admin action opens the existing purchasing detail workflow.
- Supplier, ordering, cancellation, and receiving remain line-level unless the client later confirms a real whole-batch approval requirement.

## Error and Concurrency Handling

- A repeated Production submission must return the existing active request instead of creating duplicates.
- If stock changes between display and submission, the server recalculates the shortage.
- Materials with no remaining shortage are skipped and reported to the client.
- A partial RPC failure rolls back the full submission.
- Permission, assignment, unreleased-BOM, and invalid-status failures return plain workflow messages.
- Client optimistic state may show the submission pending, but the server response replaces it immediately; failed submissions restore prior state.

## Touchpoints

- Production document route: request action, request-state display, removal of Purchasing navigation after submission.
- Production role helpers and sidebar: preserve Inventory and Production access; exclude Purchasing operations.
- Purchasing queue: derived grouping by Job Order and clear distinction from standalone replenishment.
- Supabase migration: atomic request RPC, least-privilege grants, and any required read policy updates.
- Generated Supabase types: include the new RPC contract.
- Audit logs: verify requester identity and request lifecycle history.
- Existing Purchasing detail flow: preserve Admin supplier/order/receipt commands.
- Production readiness and dashboards: continue deriving from existing records.

## What Must Not Change

- Production may continue reserving available stock for assigned work.
- Owner/Admin Production controls and Purchasing operations remain available.
- Existing purchase-request records and historical audit logs remain valid.
- Supplier SSOT, receipt history, inventory movement history, and Job Order BOM ownership remain unchanged.
- SLA behavior remains out of scope pending client confirmation.

## Validation

### Automated

- Contract test proves Production cannot call purchasing lifecycle commands.
- Database authorization test proves assigned Production can submit only assigned BOM shortages.
- Test proves unassigned Production, Sales, Accounting, and Viewer cannot submit.
- Test proves Owner/Admin retain purchasing lifecycle access.
- Test proves one submission creates multiple requested rows atomically and retry does not duplicate them.
- Test proves shortage quantities are server-derived and existing active requests are updated safely.
- Production and Purchasing UI contract tests cover labels, grouping, navigation, and role visibility.
- Full production build and relevant operations suite pass.

### Local E2E Before Push

- Owner assigns a Production user to a test item.
- Production lands on Production, reserves available stock, and submits missing materials.
- Production cannot access Purchasing or supplier/order/receipt controls.
- Admin sees the grouped Job Order request, selects a supplier, orders, and records a controlled receipt.
- Production request/readiness state updates from the same records.
- Test data is restored or explicitly retained as an approved fixture.

### Live E2E After Push and Migration

- Repeat Owner, Admin, and Production role/navigation checks.
- Exercise one explicitly approved live Job Order through assignment, reservation, request, Admin processing, and Production status refresh.
- Check browser errors and relevant backend responses at every boundary.
- Do not delete or cancel live records without action-time confirmation.

## Release Order

1. Verify the live schema objects required by the migration.
2. Implement and verify locally against local Supabase.
3. Commit and push verified code to `main` only after local E2E passes.
4. Apply the forward migration once in Lovable Cloud and verify its functions/grants.
5. Run the approved live E2E.

