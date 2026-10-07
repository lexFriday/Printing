# Phase 5 local demo evidence — Graphic Wizard extensions

## Scope delivered locally

This increment demonstrates two verified extensions on the existing shared
Job Order → BOM → inventory movement → purchase request workflow:

1. **Versioned BOM template library**
   - Owner/Admin can create a reusable material plan or save a revision.
   - A save always creates a new version; it never changes a historical version.
   - Only the latest version of a logical template is active for future
     production plans. Existing Job Order BOM snapshots keep their source
     version and components.
   - The local UI labels the provided banner recipe as sample data only.
2. **Supplier purchasing view**
   - Purchasing groups existing open shortage requests by supplier.
   - It remains a read model: it creates no purchase-order aggregate, no new
     stock balance, and no duplicate requirement quantity.
   - Quantities remain on their original material lines because rolls, sheets,
     pieces, and area units cannot safely be added together.

## Source-of-truth boundaries

- `job_boms` and `job_bom_items`: Job Order material plan and released snapshot.
- `inventory_movements`: physical-stock ledger.
- `purchase_requests`: shortage and receiving truth.
- `bom_templates` / `bom_template_components`: reusable future-job recipes.
- Supplier grouping is derived in the UI only.

## Local schema changes

- `20260831197000_bom_template_versioning.sql`
  - adds retry-safe `save_bom_template_version`.
  - validates active materials, positive quantities, and no duplicates.
  - requires Owner/Admin and uses an advisory lock per template name.
  - removes direct client writes to BOM tables.
- `20260831198000_fix_bom_template_read_policies.sql`
  - corrects the BOM/material read policies to call executable
    `app_private` authorization helpers.

Both migrations are applied only in the local Supabase container.

## Verification completed

- `npm run test:operations` — passed, including RLS, retry/version-history,
  direct-write rejection, and staff-denial checks.
- `npm run build` — completed locally after the Phase 5 route and purchasing
  view changes.
- Browser verification at `http://localhost:8080` as `owner@local.test`:
  - `/settings/bom-templates` renders the library, demo warning, and sample
    template form.
  - `/purchasing` renders supplier groups and the per-unit safety message.

## Not production-ready or client-confirmed

This is a local demonstration, not a Graphic Wizard deployment. The client
still needs to confirm real BOM recipes, opening stock, material conversions,
offcut/reuse rules, supplier rules, machine/staff capacity, and approval
contacts. No hosted database, NJL/Graphic Wizard customer master data, or
remote environment was changed.
