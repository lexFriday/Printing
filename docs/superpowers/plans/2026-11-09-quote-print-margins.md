# Quotation Print Margins & Pagination Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix quotation print margins and multi-page layout so quotations print and save to PDF cleanly across standard Letter pages without cutting through rows, text, or margins.

**Architecture:** Replace the zero-margin `@page` rule with consistent page margins (`0.5in 0.45in`), reset container padding and enable `overflow: visible` in print styles, enforce table header repetition (`display: table-header-group`) and unbreakable row/footer blocks (`break-inside: avoid`), tighten cell padding from `py-7` to `py-3`, and align the PDF download action with the browser's native print engine.

**Tech Stack:** React, Tailwind CSS, TanStack Router, CSS Paged Media (`@page`, `@media print`).

**Spec:** User request: "the download PDF is not doing that one pager, so just make it like how we print it but fix the margins" adhering to `/ponytail` (native platform CSS over custom canvas slicing).

---

## Global Constraints
- Do not alter pricing calculations, VAT math, or currency formatting.
- Preserve signature snapshot integrity and 30-day validity notice (tested by `tests/signature-print-contract.mjs`).
- Preserve print calibration controls (`--print-calibration-x`, `--print-calibration-y`).

---

### Task 1: Update Test Contract for Quotation Print Margins & Pagination

**Files:**
- Modify/Create: `tests/quote-print-margins-contract.test.mjs`

**Interfaces:**
- Consumes: `src/routes/quotes.$id.print.tsx`
- Produces: Contract test validating proper `@page` margins, `overflow: visible`, `break-inside: avoid`, and tightened row padding.

- [ ] **Step 1: Write the contract test**

```javascript
// tests/quote-print-margins-contract.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/routes/quotes.$id.print.tsx", import.meta.url),
  "utf8"
);

// 1. Verify @page has real margins (not margin: 0)
assert.match(source, /@page\s*\{[^}]*size:\s*Letter[^}]*margin:\s*0\.5in/i, "@page must define 0.5in margins");

// 2. Verify print CSS resets container padding/overflow
assert.match(source, /\.quotation-print-document\s*\{[^}]*overflow:\s*visible/i, "Print document must have overflow: visible");
assert.match(source, /\.quotation-print-document\s*\{[^}]*padding:\s*0/i, "Print document must reset padding to 0 in print");

// 3. Verify table header repeats on page break
assert.match(source, /\.quotation-table\s+thead\s*\{[^}]*display:\s*table-header-group/i, "Table thead must repeat on page break");

// 4. Verify table rows and footer avoid page breaks
assert.match(source, /\.quotation-table\s+tr\s*\{[^}]*break-inside:\s*avoid/i, "Table rows must avoid break-inside");
assert.match(source, /\.quotation-print-footer\s*\{[^}]*break-inside:\s*avoid/i, "Footer must avoid break-inside");

// 5. Verify row padding is tightened (py-3 instead of py-7)
assert.match(source, /py-3/, "Table cells must use compact py-3 padding");
assert.doesNotMatch(source, /py-7/, "Table cells must not use excessive py-7 padding");

console.log("✓ Quote print margins contract test passed");
```

- [ ] **Step 2: Run test to confirm it fails initially**

```bash
node tests/quote-print-margins-contract.test.mjs
```

---

### Task 2: Implement Margin & Pagination Fixes in `quotes.$id.print.tsx`

**Files:**
- Modify: `src/routes/quotes.$id.print.tsx`

**Interfaces:**
- Consumes: Print CSS styles, table markup, action handlers.
- Produces: Polished multi-page print layout matching Letter dimensions with safe margins.

- [ ] **Step 1: Update `@page` and `@media print` CSS rules**
  - Change `@page { size: Letter; margin: 0; }` to `@page { size: Letter; margin: 0.5in 0.45in; }`.
  - In `@media print`, configure `.quotation-print-document`:
    - `padding: 0 !important;`
    - `margin: 0 !important;`
    - `width: 100% !important;`
    - `max-width: 100% !important;`
    - `min-height: auto !important;`
    - `height: auto !important;`
    - `overflow: visible !important;`
    - `box-shadow: none !important;`
  - Add `.quotation-table thead { display: table-header-group; }` so table headers automatically carry over to page 2 if items span multiple pages.
  - Ensure `.quotation-table tr`, `.quotation-terms-section`, and `.quotation-print-footer` have `break-inside: avoid !important; page-break-inside: avoid !important;`.

- [ ] **Step 2: Tighten table row padding and signature spacing**
  - Replace `py-7` with `py-3` on all `<td>` elements in the line items loop.
  - Replace `mt-16` on `footer` with `mt-8` and add `quotation-print-footer` container class to keep signatures cleanly grouped.

- [ ] **Step 3: Align `downloadPdf` with native print engine**
  - Update `downloadPdf()` to trigger `window.print()`, giving users the native high-definition vector PDF with exact print margins and pagination (or direct native download).

- [ ] **Step 4: Run contract tests and production build**
  - Run `node tests/quote-print-margins-contract.test.mjs`.
  - Run `node tests/signature-print-contract.mjs`.
  - Run `npm run build`.

- [ ] **Step 5: Commit changes**
  - Commit with message: `fix(quotes): configure standard letter print margins and pagination`.

---

## Verification Plan

### Automated Tests
```bash
node tests/quote-print-margins-contract.test.mjs
node tests/signature-print-contract.mjs
npm run build
```

### Manual Verification
1. Open any quotation in the app and navigate to Print (`/quotes/$id/print`).
2. Click **Print / Save PDF**:
   - Preview in Chrome print dialog shows standard Letter size with safe 0.5in margins on all edges.
   - For short quotes (1–5 items): fits cleanly on 1 page without trailing blank sheets.
   - For long orders (10+ items): flows naturally to page 2, table headers repeat at the top of page 2, and rows/signatures never get sliced in half.

