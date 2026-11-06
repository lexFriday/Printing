# Check Printing Date Toggle (Auto vs Manual) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a toggle on the Check Print page to choose between automatically using the current date (today) or manually inputting a specific date to be printed on the check.

**Architecture:** Introduce `useAutoDate` boolean state (defaulting to `true` for today's date) and `manualDate` state (initialized to the expense record date or today) in `CheckPrintPage` (`src/routes/expenses.$id.check.print.tsx`). Compute `printProps` date components (`dateMonth`, `dateDay`, `dateYear`) reactively so that PDF generation (`buildCheckPdf`), direct print jobs (`directPrintJob.jobData`), and on-screen cards immediately reflect the selected date.

**Tech Stack:** React, TanStack Router, shadcn/ui (`Switch`, `Input`, `Label`), `@/lib/physicalPrintPdf`.

**Spec:** User request: "In check printing, the date to be printed must have a toggle to have auto put the current date or manual input one" with `/ponytail` minimalism (shortest working diff, native platform controls).

---

## Global Constraints
- Preserve existing physical check print alignment and Epson L120 / L121 calibrations.
- Avoid timezone skew when parsing date strings (`YYYY-MM-DD` component extraction instead of UTC Date offset).
- Keep code minimal and clean with no unnecessary abstractions or external dependencies.

---

### Task 1: Add Automated Test Contract for Check Print Date Toggle

**Files:**
- Create: `tests/check-print-date-contract.test.mjs`

**Interfaces:**
- Consumes: `src/routes/expenses.$id.check.print.tsx` source file and date formatting logic.
- Produces: Executable contract test via `node tests/check-print-date-contract.test.mjs`.

- [ ] **Step 1: Write the failing contract test**

```javascript
// tests/check-print-date-contract.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/routes/expenses.$id.check.print.tsx", import.meta.url),
  "utf8"
);

// Verify Switch and Input are imported and used
assert.match(source, /import\s*\{[^}]*Switch[^}]*\}\s*from\s*["']@\/components\/ui\/switch["']/, "Must import Switch");
assert.match(source, /import\s*\{[^}]*Input[^}]*\}\s*from\s*["']@\/components\/ui\/input["']/, "Must import Input");

// Verify auto/manual date state exists
assert.match(source, /useAutoDate/, "Must manage auto date toggle state");
assert.match(source, /manualDate/, "Must manage manual date input state");

// Verify UI renders Switch and date input
assert.match(source, /type=["']date["']/, "Must render type='date' input when in manual mode");

console.log("✓ Check print date contract test passed");
```

- [ ] **Step 2: Run test to verify it fails initially**

```bash
node tests/check-print-date-contract.test.mjs
```
Expected: Fails because `Switch`, `Input`, and `useAutoDate` are not yet in `expenses.$id.check.print.tsx`.

---

### Task 2: Implement Auto/Manual Date Toggle in Check Print Route

**Files:**
- Modify: `src/routes/expenses.$id.check.print.tsx`

**Interfaces:**
- Consumes: `Switch`, `Input`, `Label` from `@/components/ui/`
- Produces: Reactive `printProps` (`dateMonth`, `dateDay`, `dateYear`) and interactive controls in `CheckDetailsCard`.

- [ ] **Step 1: Add imports and helper function**
  - Import `Switch` from `@/components/ui/switch`.
  - Import `Input` from `@/components/ui/input`.
  - Import `Label` from `@/components/ui/label`.
  - Add lightweight helper `toDateInputValue(val?: string | Date | null): string` returning `YYYY-MM-DD`.

- [ ] **Step 2: Add state and update `printProps` calculation in `CheckPrintPage`**
  - Add `const [useAutoDate, setUseAutoDate] = useState<boolean>(true);`
  - Add `const [manualDate, setManualDate] = useState<string>("");`
  - Initialize `manualDate` with the expense's recorded check/paid date when `expense.data` loads.
  - In `useMemo` for `printProps`:
    - If `useAutoDate`: use current local date (`new Date()`).
    - If manual: extract `[y, m, d]` from `manualDate` (with fallback to expense date or current date).
    - Format `dateMonth` (2 digits), `dateDay` (2 digits), and `dateYear` (4 digits).
  - Pass `useAutoDate`, `setUseAutoDate`, `manualDate`, and `setManualDate` to `<CheckDetailsCard />`.

- [ ] **Step 3: Update `CheckDetailsCard` to render toggle and date picker**
  - Add toggle switch: "Auto (Today)" vs "Manual".
  - If manual is active, render `<Input type="date" value={manualDate} onChange={...} />`.
  - Keep the prominent `[ MM ] - [ DD ] - [ YYYY ]` preview chips below, so the user sees exactly what will be printed.

- [ ] **Step 4: Run contract tests and build verification**
  - Run `node tests/check-print-date-contract.test.mjs`.
  - Run existing print tests:
    - `node tests/epson-l121-print-contract.test.mjs`
    - `node tests/print-calibration-routes-contract.mjs`
  - Run production build: `npm run build`.

- [ ] **Step 5: Commit changes**
  - Commit with message: `feat(check-print): add toggle for auto current date vs manual input date`.

---

## Verification Checklist
- [ ] Contract test `tests/check-print-date-contract.test.mjs` passes.
- [ ] Print calibration tests (`tests/print-calibration-routes-contract.mjs`, `tests/epson-l121-print-contract.test.mjs`) pass.
- [ ] Default state automatically prints today's date.
- [ ] Toggling to manual exposes the date picker pre-filled with the payable date/today.
- [ ] Changing manual date updates:
  - Check details card preview
  - Printer insertion guide preview
  - PDF generated check preview
  - Direct print payload (`dateMonth`, `dateDay`, `dateYear`, `date`)
- [ ] Full `npm run build` succeeds without type errors.

