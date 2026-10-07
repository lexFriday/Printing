# Print Calibration Editor Design

## Goal

Give each user a dependable way to align the application's preprinted Sales Invoice, Delivery Receipt, Check Voucher, and Check output with their own printer without changing business-document data or editing source-code coordinates.

## Existing State

The application already supports page-level X/Y calibration in millimeters for several printable routes. `PrintShell` applies the saved translation to the browser preview and generated PDF, while `PrintCalibrationPanel` stores settings in browser `localStorage`. Check Voucher has a separate route-specific calibration implementation.

The current implementation has four limitations this design addresses:

- calibration is tied to one browser rather than the signed-in user;
- the unused printer-profile parameter appears in the data model even though users should not manage profiles;
- numeric inputs immediately coerce an empty value back to `0`;
- users can move the whole page but cannot correct one misaligned field.

Existing calibration for Quotation and Job Order is outside this feature's expansion scope. It must continue working, but version one field-level editing applies only to preprinted Sales Invoice, Delivery Receipt, Check Voucher, and Check output.

## User Workflow

1. A user opens an existing printable record.
2. The normal print page shows Back, Download PDF, Print, and **Calibrate print**.
3. Opening calibration reveals a setup panel beside the actual-size preview.
4. The user first adjusts page X/Y alignment.
5. If one value remains misaligned, the user expands **Individual fields**, selects a business-labelled field, and adjusts its X/Y position.
6. Every valid draft change updates the preview immediately without a reload or full preview remount.
7. The user prints a test page, compares it with the physical form, and saves the setup.
8. Future output for that user and document type automatically uses the saved setup.
9. Reset removes the user's override and restores the version-controlled defaults.

The editor changes print placement only. Invoice values, customer data, voucher data, amounts, status, audit history, and all other operational facts remain owned by their existing records.

## Scope

### Included

- Sales Invoice / Invoice
- Delivery Receipt / DR / DRS
- Check Voucher / Voucher
- Check
- Whole-page X/Y calibration
- Individual-field X/Y calibration for fields defined by each included document
- Live preview, test print, save, reset, loading, success, and error states
- Per-user persistence with authenticated-user isolation
- Compatibility with existing page-level `localStorage` calibration

### Excluded

- Editing document content
- Drag-and-drop placement
- Adding arbitrary printable fields
- Font, font-size, page-size, scale, margin, or orientation editing
- Printer-profile selection
- Field-level editing for Quotation or Job Order
- Replacing the existing PDF generators with a generic document designer

## Source of Truth

Every business value continues to come from its existing operational record.

Default print coordinates remain version-controlled, document-specific layout definitions. Saved calibration contains overrides only. The effective position is derived at render time:

```text
effective field position = coded default + saved page offset + saved field offset
```

This application is currently a single-company deployment with no tenant entity. One calibration record is therefore owned by exactly one authenticated user and one document type. There is no synthetic tenant identifier, duplicated active flag, readiness flag, or printer-profile record. If the application later gains a real tenant model, calibration must inherit that source rather than introduce a parallel tenant concept.

## Persistence Model

Create `print_calibrations` with:

- `id uuid primary key`
- `user_id uuid not null`
- `document_type text not null`
- `page_offset_x_mm numeric not null default 0`
- `page_offset_y_mm numeric not null default 0`
- `field_offsets jsonb not null default '{}'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- unique constraint on `(user_id, document_type)`

`field_offsets` maps known field IDs to `{ "xMm": number, "yMm": number }`. The server validates the document type, field IDs, finite values, and movement bounds before persistence.

Row-level security restricts reads and writes to the authenticated user's own row. Reset deletes that row instead of storing a second reset state. The migration installs the repository's established `updated_at` and audit mechanisms so create, update, and reset activity retains the responsible user and immutable change history.

## Legacy Calibration Transition

The server record is the durable source of truth. If no server record exists, the client may read the existing document-level `localStorage` value as the initial effective page offset so current users do not lose a working setup. The legacy value becomes durable only after the user selects **Save setup**. After a successful server save, the corresponding legacy key is removed. A failed save leaves both the current draft and legacy value available for retry.

The obsolete profile segment in legacy keys is treated only as an import detail and is not exposed in the UI or new persistence model.

## Shared Calibration Model

The shared model contains:

```ts
type CalibrationOffset = {
  xMm: number;
  yMm: number;
};

type PrintCalibration = {
  page: CalibrationOffset;
  fields: Record<string, CalibrationOffset>;
};
```

Each included document registers:

- a stable `documentType`;
- its allowed field IDs;
- a business-facing label for each field;
- its coded default coordinates;
- the function that applies resolved coordinates to preview and PDF output.

The shared resolver is pure and is used by both the preview and the final generated output. Document-specific renderers remain responsible for drawing their document.

## Editor UX

Normal print mode remains uncluttered. **Calibrate print** opens a responsive workspace:

- desktop: a sticky setup panel approximately 380px wide beside the preview with a 16–24px gap;
- narrow or zoomed layouts: setup stacks above the preview;
- long field lists scroll inside the panel;
- Save, Reset, test-print action, and unsaved status remain visible in a sticky footer.

The panel uses progressive disclosure:

1. **Page alignment** — Left/Right and Up/Down adjustment.
2. **Individual fields** — collapsed by default; select a business-labelled field and adjust only that field.

The selected field receives a subtle preview-only highlight. Highlights and editor controls never appear in printed or downloaded output.

There is no printer-profile selector. The user sees only their own setup for the current document type.

## Numeric Input Behaviour

Input state is stored as text while the user is typing. Empty strings, a minus sign, and an incomplete decimal are allowed as temporary editing states. The application does not replace an empty field with `0` on every keystroke.

When a text value parses to a finite number within the allowed bounds, the live preview updates immediately. Invalid or incomplete text keeps the last valid preview position, displays a concise field error, and disables Save and test print. Blur normalizes a valid value but does not silently convert an invalid empty value to zero.

Reset is the explicit way to return an offset to zero.

## Save and Failure Behaviour

- Draft edits update the preview immediately.
- Save performs one upsert for the current user and document type.
- Successful save updates the saved snapshot, clears the unsaved indicator, and shows confirmation without reload.
- Failed save preserves the last durable record and the user's current draft for retry.
- Leaving calibration mode or navigating away with unsaved valid or invalid changes requires confirmation.
- Reset requires confirmation, deletes the saved row, clears legacy storage for the document, and immediately restores coded defaults.
- Loading and save operations cannot overwrite a newer local draft.

## Permissions and Safety

- Calibration is personal to the authenticated user.
- User ownership is enforced in RLS, not only in UI filtering.
- Calibration never mutates printable business records.
- Unknown document types and field IDs are rejected.
- Offsets are bounded to prevent content being moved irretrievably off-page.
- Preview and final output use the same resolved calibration object.
- Existing print defaults remain the fallback when loading or persistence fails.

## Architecture

Use a shared runtime calibration layer rather than independent route editors or a generic document designer.

- `printCalibration` owns types, parsing, validation, legacy-key reading, and pure coordinate resolution.
- a focused Supabase data module owns load, upsert, and reset operations;
- `PrintCalibrationPanel` owns draft text state and editor interaction;
- `PrintShell` owns workspace composition and provides one resolved calibration to preview/download/print;
- document definitions own allowed field metadata and coded coordinates;
- existing document renderers consume resolved positions without surrendering responsibility for their own layouts.

Check Voucher's bespoke page-level calibration is migrated to the shared layer. Quotation and Job Order retain their existing page-level behaviour without receiving new field registries in this version.

## Testing

Test-first implementation must cover:

- page and field offsets compose correctly;
- document registries reject unknown fields;
- SI calibration cannot affect DR, Check Voucher, or Check;
- one user's row cannot be read or changed by another user;
- empty input and backspace remain possible;
- incomplete numeric text does not jump the preview to zero;
- valid input updates preview state immediately;
- invalid drafts cannot be saved or test-printed;
- save failure preserves the draft and last saved snapshot;
- reset returns to coded defaults;
- legacy page offsets load only when no server record exists and are removed after successful save;
- preview and generated PDF consume the same resolved coordinates;
- editor chrome and field highlighting are absent from print output;
- existing default output remains unchanged when no calibration exists.

Manual verification covers SI, DR, Check Voucher, and Check at 100%, 125%, and 150% browser zoom, including long field values, many field adjustments, failed saves, test printing, final printing, and PDF download.

## Implementation Boundary

Implementation will occur in an isolated Git worktree created from the latest `main`. Work proceeds in dependency order: database/RLS, shared model, persistence, editor input behaviour, shared workspace, document integrations, legacy migration, and end-to-end verification.
