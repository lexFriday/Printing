# Print Calibration Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing page-offset calibration into a per-user, live-updating calibration editor with removable numeric input and individual-field offsets for Sales Invoice, Delivery Receipt, Check Voucher, and Check.

**Architecture:** Preserve the existing document-specific PDF builders. Centralize calibration types, validation, legacy migration, coordinate resolution, and persistence; store one override row per authenticated user and document type; make `PrintShell` and the four preprinted renderers consume the same resolved calibration object for preview and output.

**Tech Stack:** React 19, TypeScript, TanStack Query, Supabase Postgres/RLS, jsPDF, existing shadcn-style UI, direct TypeScript selftests, Playwright UAT.

---

## File Map

- Create `supabase/migrations/20260817120000_print_calibrations.sql` — per-user calibration table, validation constraints, RLS, timestamps, and audit trigger.
- Modify `src/integrations/supabase/types.ts` — generated-style table types for `print_calibrations`.
- Rewrite `src/lib/printCalibration.ts` — canonical types, document registry, text parsing, bounds validation, legacy import, and pure offset resolution.
- Create `src/lib/printCalibration.selftest.ts` — unit-level executable contract for parsing, isolation, resolution, and legacy behavior.
- Create `src/lib/printCalibrationData.ts` — authenticated load/upsert/delete operations.
- Modify `src/components/print/PrintCalibrationPanel.tsx` — live draft editor with clearable inputs, field selection, sticky actions, and async states.
- Modify `src/components/print/PrintShell.tsx` — shared responsive workspace, server-backed calibration lifecycle, print/test-print guards, and one resolved value for preview/PDF.
- Modify `src/lib/preprintedPdf.ts` — small coordinate-offset helper used by all preprinted PDF builders.
- Modify `src/routes/invoices.$id.print.tsx` — Invoice field registry and resolved field coordinates.
- Modify `src/routes/jobs.$id.delivery-receipt.print.tsx` — DR field registry and resolved field coordinates.
- Modify `src/lib/checkVoucherLayout.ts` and `src/routes/expenses.$id.check-voucher.print.tsx` — Check Voucher registry and removal of its bespoke local-storage editor.
- Modify `src/routes/expenses.$id.check.print.tsx` — Check registry and resolved field coordinates.
- Create `tests/print-calibration-contract.test.mjs` — source-level integration contract for all four print routes.
- Modify `package.json` — add the calibration selftest and contract to a focused `test:print-calibration` command.

## Task 1: Database Foundation and Ownership

**Files:**
- Create: `supabase/migrations/20260817120000_print_calibrations.sql`
- Modify: `src/integrations/supabase/types.ts`
- Test: `tests/rls-role-boundaries.mjs`

- [ ] **Step 1: Extend the RLS contract test first**

Add assertions that query the migration text and require:

```js
assert.match(sql, /create table public\.print_calibrations/i);
assert.match(sql, /unique\s*\(user_id,\s*document_type\)/i);
assert.match(sql, /user_id\s*=\s*auth\.uid\(\)/i);
assert.match(sql, /with check\s*\(user_id\s*=\s*auth\.uid\(\)/i);
assert.match(sql, /capture_audit_log/i);
```

- [ ] **Step 2: Run the contract and confirm RED**

Run:

```powershell
node tests/rls-role-boundaries.mjs
```

Expected: FAIL because `20260817120000_print_calibrations.sql` does not exist.

- [ ] **Step 3: Add the minimal migration**

Create:

```sql
CREATE TABLE public.print_calibrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('invoice', 'delivery-receipt', 'check-voucher', 'check')),
  page_offset_x_mm numeric NOT NULL DEFAULT 0 CHECK (page_offset_x_mm BETWEEN -30 AND 30),
  page_offset_y_mm numeric NOT NULL DEFAULT 0 CHECK (page_offset_y_mm BETWEEN -30 AND 30),
  field_offsets jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(field_offsets) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, document_type)
);

ALTER TABLE public.print_calibrations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.print_calibrations TO authenticated;
GRANT ALL ON public.print_calibrations TO service_role;

CREATE POLICY "print calibration read own" ON public.print_calibrations
  FOR SELECT TO authenticated USING (user_id = auth.uid() AND app_private.is_active_user(auth.uid()));
CREATE POLICY "print calibration insert own" ON public.print_calibrations
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND app_private.is_active_user(auth.uid()));
CREATE POLICY "print calibration update own" ON public.print_calibrations
  FOR UPDATE TO authenticated USING (user_id = auth.uid() AND app_private.is_active_user(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND app_private.is_active_user(auth.uid()));
CREATE POLICY "print calibration delete own" ON public.print_calibrations
  FOR DELETE TO authenticated USING (user_id = auth.uid() AND app_private.is_active_user(auth.uid()));

CREATE TRIGGER trg_print_calibrations_touch
  BEFORE UPDATE ON public.print_calibrations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER capture_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public.print_calibrations
  FOR EACH ROW EXECUTE FUNCTION app_private.capture_audit_log();
```

- [ ] **Step 4: Add the exact Supabase types**

Add `print_calibrations` to `Database["public"]["Tables"]` with `Row`, `Insert`, `Update`, and `Relationships`. Use `Json` for `field_offsets`, optional `id/created_at/updated_at` in `Insert`, and no relationships beyond `user_id` because auth-schema relationships are not emitted in the current file.

- [ ] **Step 5: Run database/type verification**

Run:

```powershell
node tests/rls-role-boundaries.mjs
npm.cmd exec tsc -- --noEmit
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/20260817120000_print_calibrations.sql src/integrations/supabase/types.ts tests/rls-role-boundaries.mjs
git commit -m "feat: add personal print calibration storage"
```

## Task 2: Pure Calibration Model

**Files:**
- Rewrite: `src/lib/printCalibration.ts`
- Create: `src/lib/printCalibration.selftest.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing selftest**

The selftest must assert this public contract:

```ts
import {
  DEFAULT_PRINT_CALIBRATION,
  applyCalibrationOffset,
  parseCalibrationInput,
  resolveFieldOffset,
  validateCalibration,
} from "./printCalibration.ts";

check(parseCalibrationInput("").kind === "incomplete", "empty input remains incomplete");
check(parseCalibrationInput("-").kind === "incomplete", "minus remains editable");
check(parseCalibrationInput("1.").kind === "incomplete", "decimal remains editable");
check(parseCalibrationInput("1.5").value === 1.5, "valid decimal parses");
check(parseCalibrationInput("31").kind === "invalid", "out-of-bounds input rejected");

const calibration = {
  page: { xMm: 2, yMm: -1 },
  fields: { payee: { xMm: 0.5, yMm: 1 } },
};
checkDeep(resolveFieldOffset(calibration, "payee"), { xMm: 2.5, yMm: 0 });
checkDeep(resolveFieldOffset(calibration, "amount"), { xMm: 2, yMm: -1 });
checkDeep(applyCalibrationOffset({ top: 10, left: 20 }, { xMm: 25.4, yMm: 25.4 }, "in"), { top: 11, left: 21 });
check(validateCalibration("check", calibration).ok, "known check field accepted");
check(!validateCalibration("check", { ...calibration, fields: { mystery: { xMm: 1, yMm: 1 } } }).ok, "unknown field rejected");
checkDeep(DEFAULT_PRINT_CALIBRATION, { page: { xMm: 0, yMm: 0 }, fields: {} });
```

- [ ] **Step 2: Run and confirm RED**

```powershell
node src/lib/printCalibration.selftest.ts
```

Expected: FAIL because the new API does not exist.

- [ ] **Step 3: Implement the minimal canonical model**

Define:

```ts
export type CalibrationOffset = { xMm: number; yMm: number };
export type PrintCalibration = { page: CalibrationOffset; fields: Record<string, CalibrationOffset> };
export type CalibrationDocumentType = "invoice" | "delivery-receipt" | "check-voucher" | "check";
export const CALIBRATION_LIMIT_MM = 30;
export const DEFAULT_PRINT_CALIBRATION: PrintCalibration = { page: { xMm: 0, yMm: 0 }, fields: {} };
```

Add immutable registries with these field IDs and labels:

- `invoice`: `invoiceNumber`, `date`, `customerName`, `tin`, `businessStyle`, `address`, `lineDescription`, `lineQuantity`, `lineUnitPrice`, `lineAmount`, `totalSales`, `vat`, `amountNetOfVat`, `addVat`, `withholdingTax`, `amountDue`.
- `delivery-receipt`: `terms`, `date`, `customerName`, `tin`, `address`, `poNumber`, `lineQuantity`, `lineUnit`, `lineDescription`, `lineAmount`, `lineUnitPrice`, `subtotal`, `vat`, `total`.
- `check-voucher`: `date`, `payee`, `particulars`, `amount`, `documentNo`, `checkNo`, `preparedBy`, `certifiedCorrectBy`, `receivedBy`.
- `check`: `checkNo`, `payee`, `amount`, `amountWords`, `dateMonth`, `dateDay`, `dateYear`.

Implement `parseCalibrationInput`, `validateCalibration`, `resolveFieldOffset`, `applyCalibrationOffset`, `serializeCalibrationRow`, `deserializeCalibrationRow`, `legacyCalibrationKey`, and `readLegacyCalibration`. Input parsing must distinguish `valid`, `incomplete`, and `invalid`; it must never coerce `""` to zero.

- [ ] **Step 4: Run and confirm GREEN**

```powershell
node src/lib/printCalibration.selftest.ts
npm.cmd exec tsc -- --noEmit
```

Expected: PASS.

- [ ] **Step 5: Add focused package command and commit**

Add:

```json
"test:print-calibration": "node src/lib/printCalibration.selftest.ts && node tests/print-calibration-contract.test.mjs"
```

Commit:

```powershell
git add src/lib/printCalibration.ts src/lib/printCalibration.selftest.ts package.json
git commit -m "feat: define print calibration model"
```

## Task 3: Server Persistence

**Files:**
- Create: `src/lib/printCalibrationData.ts`
- Extend: `src/lib/printCalibration.selftest.ts`

- [ ] **Step 1: Add failing serialization cases**

Assert that a Supabase row maps to the canonical model, malformed JSON becomes `{}`, and an upsert payload contains only `user_id`, `document_type`, page offsets, and field offsets.

- [ ] **Step 2: Run and confirm RED**

```powershell
node src/lib/printCalibration.selftest.ts
```

- [ ] **Step 3: Add focused data functions**

Export:

```ts
export async function loadPrintCalibration(documentType: CalibrationDocumentType): Promise<PrintCalibration | null>;
export async function savePrintCalibration(documentType: CalibrationDocumentType, calibration: PrintCalibration): Promise<PrintCalibration>;
export async function resetPrintCalibration(documentType: CalibrationDocumentType): Promise<void>;
```

`load` selects the current user's RLS-filtered row by `document_type` using `maybeSingle`. `save` gets the authenticated user once, validates the canonical model, and upserts with `onConflict: "user_id,document_type"`. `reset` deletes only the current document type; RLS owns user scoping. Do not accept a caller-provided user ID.

- [ ] **Step 4: Run and confirm GREEN**

```powershell
node src/lib/printCalibration.selftest.ts
npm.cmd exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```powershell
git add src/lib/printCalibration.ts src/lib/printCalibration.selftest.ts src/lib/printCalibrationData.ts
git commit -m "feat: persist personal print calibration"
```

## Task 4: Live Editor and Clearable Inputs

**Files:**
- Modify: `src/components/print/PrintCalibrationPanel.tsx`
- Modify: `src/components/print/PrintShell.tsx`
- Create: `tests/print-calibration-contract.test.mjs`

- [ ] **Step 1: Write the failing source contract**

Assert the component no longer contains `Number(event.target.value) || 0`, no longer accepts `profile`, uses `parseCalibrationInput`, exposes `Individual fields`, and calls `onDraftChange` on valid keystrokes. Assert `PrintShell` imports the data functions and has loading, saving, saved, and error copy.

- [ ] **Step 2: Run and confirm RED**

```powershell
node tests/print-calibration-contract.test.mjs
```

- [ ] **Step 3: Implement text draft state**

Use a focused draft shape:

```ts
type OffsetTextDraft = { x: string; y: string };
type CalibrationTextDraft = {
  page: OffsetTextDraft;
  fields: Record<string, OffsetTextDraft>;
};
```

Every input stores `event.target.value` unchanged. Parse after the text update; if both axes are valid, call `onDraftChange` immediately. If incomplete/invalid, keep the last valid preview, show the specific error, and set `canSave=false`. Blur normalizes only valid values.

- [ ] **Step 4: Implement the responsive editor workspace**

Make `PrintShell` render a `lg:grid lg:grid-cols-[minmax(340px,380px)_minmax(0,1fr)] lg:gap-5` calibration workspace only while the editor is open. Keep the setup panel sticky with `lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]`; use an internally scrolling field list and sticky footer. Normal print mode keeps the current compact actions and preview.

The panel must include Page alignment, collapsed Individual fields, field selection by business label, unsaved state, Save setup, Reset, and Print test. Remove all user-facing profile text.

- [ ] **Step 5: Implement async lifecycle**

On load: server row first, then legacy page offset only when the server returns null. On save: preserve draft on failure; on success replace the saved snapshot and remove the legacy key. On reset: require confirmation, delete the server row, remove the legacy key, and publish defaults immediately. Use a monotonically increasing edit version/ref so a late load cannot overwrite a newer local draft.

- [ ] **Step 6: Run and confirm GREEN**

```powershell
node tests/print-calibration-contract.test.mjs
node src/lib/printCalibration.selftest.ts
npm.cmd exec tsc -- --noEmit
```

- [ ] **Step 7: Commit**

```powershell
git add src/components/print/PrintCalibrationPanel.tsx src/components/print/PrintShell.tsx tests/print-calibration-contract.test.mjs
git commit -m "feat: add live print calibration editor"
```

## Task 5: Preprinted Document Field Integration

**Files:**
- Modify: `src/lib/preprintedPdf.ts`
- Modify: `src/routes/invoices.$id.print.tsx`
- Modify: `src/routes/jobs.$id.delivery-receipt.print.tsx`
- Modify: `src/lib/checkVoucherLayout.ts`
- Modify: `src/routes/expenses.$id.check-voucher.print.tsx`
- Modify: `src/routes/expenses.$id.check.print.tsx`
- Extend: `tests/print-calibration-contract.test.mjs`

- [ ] **Step 1: Extend the failing route contract**

Require every included route to declare its correct `calibrationDocument`, pass canonical calibration into its PDF builder, and resolve every registered field through `resolveFieldOffset`. Require Check Voucher to remove `CALIBRATION_STORAGE_KEY`, `draftCalibration`, and its route-local setup controls.

- [ ] **Step 2: Run and confirm RED**

```powershell
node tests/print-calibration-contract.test.mjs
```

- [ ] **Step 3: Add one coordinate application boundary**

Extend `drawPreprintedText` with optional `offset?: CalibrationOffset`. Apply X to `left/right` and Y to `top` after converting millimeters to the renderer's `cm` or `in` unit. Keep all existing coded constants unchanged when offset is absent.

- [ ] **Step 4: Integrate Invoice and DR**

Update builders to accept `PrintCalibration`. Resolve header, line-column, and total fields using the exact registry IDs from Task 2. Repeated lines share their column field offset so users calibrate a column once rather than edit every row. Preserve existing hardcoded defaults and current EWT/price-visibility behavior.

- [ ] **Step 5: Integrate Check Voucher**

Use `CHECK_VOUCHER_FIELDS` as coded defaults and the shared resolver for date, payee, particulars, both numeric amount placements, document number, check number, and three signature values. Map both amount placements to field ID `amount`. Remove route-local page calibration state/localStorage; keep the alignment-test PDF and existing 4-inch lead-in behavior.

- [ ] **Step 6: Integrate Check**

Move `CHECK_FIELDS` metadata to an exported, immutable definition or a focused layout file. Apply shared field offsets to check number, payee, numeric amount, amount in words, and each date segment. Preserve existing BDO page size and fit-to-width behavior.

- [ ] **Step 7: Prove unchanged defaults and GREEN**

Add selftest assertions showing zero calibration returns every coded coordinate unchanged and nonzero calibration changes only the selected document/field. Run:

```powershell
npm.cmd run test:print-calibration
npm.cmd exec tsc -- --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/lib/preprintedPdf.ts src/lib/checkVoucherLayout.ts src/routes/invoices.`$id.print.tsx src/routes/jobs.`$id.delivery-receipt.print.tsx src/routes/expenses.`$id.check-voucher.print.tsx src/routes/expenses.`$id.check.print.tsx tests/print-calibration-contract.test.mjs src/lib/printCalibration.selftest.ts
git commit -m "feat: calibrate individual printable fields"
```

## Task 6: Final Safety and UX Verification

**Files:**
- Modify only files proven necessary by failures from the following checks.

- [ ] **Step 1: Run focused automated verification**

```powershell
npm.cmd run test:print-calibration
node tests/rls-role-boundaries.mjs
npm.cmd exec tsc -- --noEmit
npm.cmd run lint
npm.cmd run build
git diff --check
```

Expected: all PASS with no new warnings attributable to calibration code.

- [ ] **Step 2: Verify database behavior locally**

Apply the migration in the repository's local Supabase environment. Confirm user A cannot select/update/delete user B's calibration, unknown document types fail, offsets beyond ±30mm fail, and insert/update/delete create `audit_logs` rows.

- [ ] **Step 3: Verify browser workflow**

For Invoice, DR, Check Voucher, and Check:

1. Open calibration and delete the entire X value; confirm it stays empty.
2. Type `-`, then `-1.5`; confirm the preview moves only after the number becomes valid.
3. Adjust one field; confirm other fields remain fixed.
4. Save, reload, and confirm the setup returns for the same user.
5. Sign in as another user and confirm defaults remain unchanged.
6. Force a save failure and confirm the draft remains.
7. Reset and confirm coded defaults return immediately.
8. Compare preview, Download PDF, Print test, and final Print at 100%, 125%, and 150% browser zoom.

- [ ] **Step 4: Confirm legacy transition**

Seed `print-calibration-v2:default:<document>` in localStorage with an X/Y offset and no server row. Confirm it loads as the initial draft, persists only after Save, and is removed only after the successful upsert.

- [ ] **Step 5: Final commit if verification required fixes**

```powershell
git add -A
git commit -m "fix: harden print calibration workflow"
```

## Completion Criteria

- The four preprinted documents share one calibration model and persistence path.
- Values auto-update the preview as soon as the draft is valid.
- Empty/backspaced numeric fields never get forced to zero.
- No printer profile appears in UI or new storage.
- Calibration is personal and RLS-protected.
- Page and individual-field offsets affect preview and final PDF through the same resolver.
- Existing zero-calibration output remains byte/coordinate-equivalent at the renderer boundary.
- Check Voucher no longer maintains a second calibration implementation.
