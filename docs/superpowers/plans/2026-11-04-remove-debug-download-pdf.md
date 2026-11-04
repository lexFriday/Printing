# Remove Debug Download PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cleanly hide the debug "Download PDF" button from the 4 pre-printed document print views (Delivery Receipt, Sales Invoice, Bank Check, and Check Voucher) across all states (ready, loading, and error).

**Architecture:** `<PrintShell>` accepts the boolean prop `hideDownloadPdf` (defaulting to `false`). In the ready states, Sales Invoice and Delivery Receipt already set `hideDownloadPdf={true}`. We update Bank Check and Check Voucher ready shells to `hideDownloadPdf={true}`. To prevent UI flickers or disabled buttons appearing while data is fetching, we also pass `hideDownloadPdf={true}` to the loading and error fallback shells of all 4 pre-printed documents. Quotation PDF download and standard direct printing remain completely untouched.

**Tech Stack:** React, TanStack Router, TypeScript, Vite.

**Spec:** User prompt: "lets remove that download pdf which we use for debugging on Delivery Receipt, Sales Invoice, Check, and Check Voucher"

## Global Constraints

- Keep changes minimal and focused (ponytail approach: shortest working diff).
- Preserve all existing comments and docstrings.
- Ensure no UI flicker: ensure loading/error fallback shells in these 4 routes also hide the debug button.
- Ensure Direct Print (`sendToPrinter`), calibration overlay, and canvas previews remain 100% functional.
- Quotation PDF downloads (`quotes.$id.print.tsx`) and Job Order printing remain untouched.
- Verify through contract test runner (`node tests/print-calibration-routes-contract.mjs`, `node tests/epson-l121-print-contract.test.mjs`) and web build (`npm run build`).

---

### Task 1: Update Bank Check and Check Voucher Print Routes

**Files:**
- Modify: `src/routes/expenses.$id.check.print.tsx:55,130,158`
- Modify: `src/routes/expenses.$id.check-voucher.print.tsx:61,157,215`

**Interfaces:**
- Consumes: `<PrintShell hideDownloadPdf={true}>` in `src/components/print/PrintShell.tsx`
- Produces: Check and Check Voucher print shells without the "Download PDF" button in loading, error, and ready states

- [x] **Step 1: Update Check Print route**
- [x] **Step 2: Update Check Voucher Print route**

---

### Task 2: Ensure Loading/Fallback Shells in Delivery Receipt and Invoice Also Hide Download PDF

**Files:**
- Modify: `src/routes/jobs.$id.delivery-receipt.print.tsx:40,149`
- Modify: `src/routes/invoices.$id.print.tsx:32`

**Interfaces:**
- Consumes: `<PrintShell hideDownloadPdf={true}>` in `src/components/print/PrintShell.tsx`
- Produces: Guaranteed absence of debug Download PDF button in DR and SI loading/error states

- [x] **Step 1: Update Delivery Receipt loading and error shells**
- [x] **Step 2: Update Invoice initial loading shell**

---

### Task 3: Verification and Build

**Files:**
- None (verification only)

- [x] **Step 1: Run print calibration routes contract test**
- [x] **Step 2: Run Epson L121 print contract test**
- [x] **Step 3: Run production build**
