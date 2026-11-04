# Petty Cash Edit Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to edit mistakes in Petty Cash (date, amount, Job Order, description, supplier, etc.) on both the Petty Cash batch and the receipts inside an open batch.

**Architecture:** 
1. **Petty Cash Receipts**: Currently, receipts in an open batch display "Locked" because `receipt.payment_status === "paid"`. We unlock the "Edit" button for receipts when the parent batch is open (`status === 'open'`). We enhance `GeneralExpenseForm` to recognize existing petty-cash receipts during edit mode (preserving petty cash context and paid status while bypassing mandatory file re-upload), and update `updatePendingExpense` to allow updating expenses attached to an open petty cash batch and invalidate `petty-cash-batches` query.
2. **Petty Cash Batch**: We expose an "Edit batch" action directly on the Petty Cash table rows (in addition to inside the details modal), allowing users to quickly correct the batch's funding date, cash received amount, and assigned Job Order.

**Tech Stack:** React, TanStack Query, Supabase, Tailwind CSS, TypeScript.

**Spec:** User request: "Under Petty Cash, lets add an option to edit like the date amount or job order so when there is a mistake it can be corrected"

---

## Global Constraints

- Follow Ponytail principles: shortest working diff, reuse existing forms and mutations, zero unnecessary scaffolding.
- Safety guard: Only allow editing receipts and batch details while the parent petty-cash batch has status `'open'`. If a batch is `'closed'` or `'cv_created'`, it remains locked to protect accounting integrity.
- Do not block receipt edits by forcing users to re-upload proof images on existing receipts.
- Invalidate `["petty-cash-batches"]` on save so batch balance, differences, and receipt rows update reactively.
- Maintain documentation integrity and pass all tests and builds (`npm run build`).

---

### Task 1: Enable Receipt Editing for Open Petty Cash Batches

**Files:**
- Modify: `src/routes/_app.reports.tsx` (around lines 1673-1720, 4047, 5359, 5936, 6080)

**Interfaces:**
- Consumes: `pettyCashDetailsBatch.status === 'open'`, `toPendingExpenseEditTarget(receipt)`
- Produces: Working receipt editing modal for correcting date, amount, Job Order, supplier, and description

- [x] **Step 1: Unlock Edit button on receipt rows in open batches**
- [x] **Step 2: Recognize existing petty cash receipts in `GeneralExpenseForm`**
- [x] **Step 3: Update `updatePendingExpense` mutation to support open petty cash receipts**
- [x] **Step 4: Update edit dialog title/copy when editing a petty cash receipt**

---

### Task 2: Add Direct "Edit batch" Option to Batch Rows & Live Sync

**Files:**
- Modify: `src/routes/_app.reports.tsx` (around line 3943 and lines 4529-4550)

**Interfaces:**
- Consumes: `batch.status === 'open'`
- Produces: Direct action button on the batch table row to edit batch details (date, amount, Job Order)

- [x] **Step 1: Extract `openEditPettyCashBatch` helper**
- [x] **Step 2: Add "Edit batch" button to batch row action column**
- [x] **Step 3: Live modal sync**

---

### Task 3: Verification & Build

**Files:**
- None (verification only)

- [x] **Step 1: Run static typecheck and production build**
- [x] **Step 2: Run contract test suite**
