# Quotation Print Top Margin Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the print layout so Page 2 (and subsequent pages) has a proper top margin when printing/saving via browser print, preventing table headers from being pushed flush against the top edge of the paper, while preserving the continuous one-pager PDF download.

**Architecture:** Update `@page` in `src/routes/quotes.$id.print.tsx` from `margin: 0;` to standard Letter margins (`margin: 0.5in 0.46in;`), reset `.quotation-print-document` padding in `@media print` so margins are consistently managed by `@page` on all pages, and keep the one-pager PDF generator (`downloadPdf`) completely intact.

**Tech Stack:** React, CSS Paged Media (`@page`, `@media print`), Tailwind CSS.

**Spec:** User feedback: "the pdf one pager is all goods but that part where it prints its too muhc at the top" with screenshot showing Page 2 table header flush against the top edge.

---

## Global Constraints
- Preserve the continuous one-pager PDF download (`downloadPdf()`) exactly as it is since the user confirmed it is "all goods".
- Do not alter quotation line items, calculations, VAT, or pricing.
- Preserve signature snapshot integrity and 30-day validity notice (covered by `tests/signature-print-contract.mjs`).

---

### Task 1: Add Automated Test Contract for Quotation Print Margins

**Files:**
- Modify/Create: `tests/quote-print-margins-contract.test.mjs`

**Interfaces:**
- Consumes: `src/routes/quotes.$id.print.tsx`
- Produces: Contract test validating proper `@page` margins and print document padding resets.

- [ ] **Step 1: Write the contract test**

```javascript
// tests/quote-print-margins-contract.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/routes/quotes.$id.print.tsx", import.meta.url),
  "utf8"
);

// 1. Verify @page has real top margin (not margin: 0)
assert.match(
  source,
  /@page\s*\{[^}]*size:\s*Letter[^}]*margin:\s*0\.5in/i,
  "@page must define at least 0.5in margins"
);

// 2. Verify print CSS resets document padding so @page handles all margins consistently
assert.match(
  source,
  /@media\s+print\s*\{[\s\S]*\.quotation-print-document\s*\{[^}]*padding:\s*0/i,
  "Print document must reset padding to 0 in @media print"
);

// 3. Verify continuous one-pager PDF download is preserved
assert.match(
  source,
  /new\s+jsPDF\(["']p["'],\s*["']pt["'],\s*\[pageWidthPt,\s*pageHeightPt\]\)/,
  "Must preserve continuous one-pager PDF download"
);

console.log("✓ Quote print top margin contract test passed");
```

- [ ] **Step 2: Run test to confirm it fails initially**

```bash
node tests/quote-print-margins-contract.test.mjs
```

---

### Task 2: Implement Print Margins in `quotes.$id.print.tsx`

**Files:**
- Modify: `src/routes/quotes.$id.print.tsx`

**Interfaces:**
- Consumes: `@page` and `@media print` CSS block.
- Produces: Clean print margins on all pages (Page 1 and Page 2+).

- [ ] **Step 1: Update `@page` and `@media print` rules**
  - Change `@page { size: Letter; margin: 0; }` to:
    ```css
    @page {
      size: Letter;
      margin: 0.5in 0.46in;
    }
    ```
  - In `@media print`, configure `.quotation-print-document`:
    ```css
    @media print {
      html,
      body {
        background: white !important;
      }

      .quotation-print-shell {
        min-height: auto !important;
        padding: 0 !important;
        background: white !important;
      }

      .quotation-print-actions {
        display: none !important;
      }

      .quotation-print-document {
        max-width: none !important;
        min-height: auto !important;
        padding: 0 !important;
        margin: 0 !important;
        overflow: visible !important;
        box-shadow: none !important;
      }
    }
    ```

- [ ] **Step 2: Run contract tests and build verification**
  - Run `node tests/quote-print-margins-contract.test.mjs`.
  - Run `node tests/quote-continuous-pdf-contract.test.mjs`.
  - Run `node tests/signature-print-contract.mjs`.
  - Run `npm run build`.

- [ ] **Step 3: Commit changes**
  - Commit with message: `fix(quotes): add proper top margin to multi-page quotation print`.

---

## Verification Plan

### Automated Tests
```bash
node tests/quote-print-margins-contract.test.mjs
node tests/quote-continuous-pdf-contract.test.mjs
node tests/signature-print-contract.mjs
npm run build
```

### Manual Verification
1. Navigate to `/quotes/$id/print`.
2. Click **Download PDF**:
   - Verify it continues to download the seamless one-pager PDF ("all goods").
3. Click **Print / Save PDF**:
   - In the print preview, check Page 2:
   - Table header (`ITEM | QTY | ITEM ...`) now sits `0.5in` below the top of Page 2 with clean whitespace above it instead of being jammed against the top edge.

