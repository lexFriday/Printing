# Fabrication template readiness

Status: Draft for review. No live templates, materials, prices, or migrations changed by this assessment.

## Source boundaries

- APHRODITE-Robinson-Galleria-SOUTH-BOM.pdf: Aphrodite Naturals, Galleria South island kiosk, 23 January 2026. Material-cost reference, labor excluded.
- STA-MESA-BOM (1).pdf: Avocadoria Sta. Mesa, 8 sqm, 28 May 2025. Material-cost reference, labor excluded.
- QTN 2743-2026: Premier SMX exhibit booth, 6 x 3 m. Selling-scope reference, not a raw-material recipe.
- QTN 2750-2026: Avocadoria SM Angono, 2.5 x 2.5 m. Selling-scope reference, not the earlier SM Daet 3 x 6.4 m drawing.

Do not combine these into a single approved BOM or treat quotation scope amounts as material unit costs.

## Candidate reference templates

1. Aphrodite island kiosk — Galleria South reference: cabinets, hardware, finishing, flooring, electrical, signage.
2. Avocadoria kiosk — Sta. Mesa 8 sqm reference: cabinets, hardware, finishing, electrical, signage.
3. Premier exhibit booth — 6 x 3 m scope checklist only, pending actual material breakdown.
4. Avocadoria kiosk — Angono 2.5 x 2.5 m scope checklist only, pending actual material breakdown.

## Source discrepancies to resolve

- Aphrodite marine plyboard: Units 15 and unit cost 1,500 imply 22,500; displayed cost is 60,000 and first column contains 40. Confirm intended quantity and first-column meaning.
- Aphrodite displayed line costs total 193,477, matching its total only when the inconsistent 60,000 plyboard amount is used.
- Sta. Mesa neon signage: quantity 1, unit cost 10,000, displayed cost 8,000. Confirm discount or correct price.
- Sta. Mesa displayed line costs total 110,977, matching its total when 8,000 is used for neon signage.
- Sta. Mesa BOM is dated 28 May 2025 and says 8 sqm; the supplied drawing is dated 04.09.2026 and says 2.5 x 2.5 m (6.25 sqm). Confirm the matching revision before treating it as a complete recipe. The drawing specifies a 30-amp breaker while the BOM lists 20 amps; do not choose an electrical specification from software assumptions.
- Both BOMs mix quantity and packaging in Units. Paint says 3 gal with 4 liters per can; wire says 1 box without length. Confirm inventory units and package conversions.
- BOM Level values have no demonstrated parent-child relationship; do not import as hierarchy.
- Signage assemblies need either a confirmed purchased-assembly item or a raw-material breakdown; never count both against the same job.
- Premier scope amounts total 380,000. Transport adds 40,000. VAT/discount presentation needs confirmation before encoding tax or pricing defaults; transport dates say 2024 while the event says 2026.
- Angono scope amounts total 275,000 but fabrication is listed at 260,000. Its final arithmetic is 280,000 less 9,000 = 271,000. Preserve as quoted package pricing, not a summed BOM cost.
- Angono recorded DP 196,000 is not exactly 70% of 271,000; a quotation is not evidence of payment receipt.

## Minimal workflow and ownership

1. Map each confirmed material/specification to the existing material catalog. Resolve duplicates and units before linking.
2. Store a reusable recipe on the item template using the existing material-version workflow. Use per-item quantities for one complete reference build; manually adjust custom builds. Do not scale every component by floor area.
3. Select the template on a quote and retain the approved design, dimensions, scope, exclusions, and agreed selling price.
4. Confirm the job-specific BOM before material issue. Template edits must not rewrite approved job plans.
5. Record issues and returns through inventory movements. Improve future recipe versions from reviewed actual usage.

Materials own identity and stock units. Templates own reusable recipe defaults. The job BOM owns planned requirements. Inventory movements own actual stock changes. Quotes own selling prices; source BOM historical costs must not overwrite current inventory valuation.

## Database verification before activation

Repository code already contains item_template_materials, recipe versioning, quote material snapshots, and job BOM workflows. This does not prove those migrations are applied to the connected database.

Verify deployed columns, constraints, active-version reads, roles, current material records, and the latest definitions of save_item_template_material_version and snapshot_quote_materials. Verify retry behavior, approval locking, and job snapshot isolation. Inspect all later migrations before judging an early function definition.

### Concrete repository findings (not hosted verification)

- Correction after tracing the helper and inspecting the NJL cloud database on 9 September 2026: `src/lib/audit.ts` is a no-op compatibility shim, not a separate audit write. The earlier post-save audit-failure diagnosis was unsupported. `item_templates` already has an enabled atomic `app_private.capture_audit_log()` trigger. However, `item_template_materials` has no audit trigger and its save RPC has no explicit audit insertion. The narrow fix is to attach the existing trusted trigger to recipe rows, not introduce another save service.
- The repository definition of `save_item_template_material_version` in `20260903110000_item_template_material_versioning.sql` requires an idempotency key but never checks or stores it. A repeat call creates another version. The UI also generates a fresh key on each save invocation. Verify the deployed definition, then address both ends of that same save operation before bulk entry.
- `snapshot_quote_materials` reads active recipe rows but labels them with the quote line's `item_template_version`. Verify that the version recorded actually matches the recipe used; do not claim version traceability until this passes.
- `confirm_custom_item_materials` currently accepts at most 20 material rows. These BOMs have 19 and 16 populated rows respectively, but splitting signage into raw components may exceed the limit. Check the real pilot before changing that limit; no generic recipe hierarchy is needed.

## Minimal delivery order

1. Resolve source discrepancies and approve a single reference design/BOM pair. Keep this document as the draft; no active recipes yet.
2. Read-only compare the connected database with the repository migrations and inspect existing material identities/units. Record actual gaps before proposing migrations.
3. Fix only verified save/audit/retry and snapshot-traceability gaps, using forward migrations if required. Test locally or in a safe test database; obtain approval before applying hosted changes.
4. Map the confirmed pilot materials to existing catalog IDs, then save one recipe for one complete build. Keep historical material costs separate from current stock valuation and selling price.
5. Run the acceptance checks below, including a simulated failed response and retry. Expand to other projects only after the pilot passes.

## Acceptance checks

- One confirmed material identity per specification and stock unit.
- One active recipe version; a retry does not create another version.
- A reference build produces the reviewed material quantities.
- A second custom job can adjust its BOM without changing the template or first job.
- Template changes affect future work only.
- Unauthorized users cannot change recipes or release materials.
- Material issue/return appears once and remains traceable to the job.
- Client-supplied and reusable items do not become purchased consumables automatically.

## First pilot

Use Sta. Mesa only after NJL supplies or confirms a matching drawing/BOM revision, the neon signage amount, electrical specification, and material units. Otherwise select another fully reconciled reference; none is activation-ready solely from these documents. Review the material mapping before creating an active recipe. Keep Premier and Angono as scope checklists until their actual material breakdowns are supplied. Add migrations only for gaps proven by the deployed-schema check; no generic BOM engine is planned.

## Audit fix handoff

- Approved live application on 9 September 2026: SQL from `20260910090000_audit_item_template_materials.sql` applied through Lovable Cloud to NJL project `b92cd55c-c369-4841-b384-55b5332bb279`, with a 5-second lock timeout. A separate catalog query confirmed exactly one enabled `capture_audit_log` trigger on `public.item_template_materials`, covering INSERT/UPDATE/DELETE and using `app_private.capture_audit_log()`. No business rows, policies, grants, or valuation changed. Applied as direct SQL; no migration-history row was manually inserted. The forward migration remains safe to replay.
- Coverage: direct recipe insert/update/delete and RPC version deactivation/insertion. Audit entries retain actor, row ID, template ID, version and before/after values. The existing Change history page reads these generic entries under All items; its template-only filter remains for parent templates.
- Run `node tests/template-audit-atomicity.mjs` from the repository. Requires Docker and the Supabase PostgreSQL image already used locally. It creates and removes its own isolated container, with no network port or hosted credentials. It executes the repository save RPC and audit function against a minimal schema; auth is stubbed, so this is not an end-to-end permissions test.
- Live deployment verification: trigger presence and enabled state confirmed. A normal permitted recipe save should still be checked in Change history when next performed; no synthetic live business write or production fault injection was made. Atomic rollback was tested only in isolated local PostgreSQL. No historical audit entries are fabricated.
- Remaining separate risks: network-ambiguous retries/version idempotency, recipe-version snapshot alignment, and existing authorization policies are not changed or claimed fixed by this audit patch.

## Workflow hardening prepared locally (10 September 2026)

Read-only inspection of the connected NJL database confirmed 30 materials, 82 item templates, 19 recipe rows, and no quote-material or Job BOM snapshots yet. It found no duplicate active recipe rows, but confirmed that the deployed recipe RPC does not honor its idempotency key and that quote snapshots can record a version different from the recipe actually used.

The local forward migration `20260910120000_harden_item_template_material_workflow.sql` fixes those root causes without changing historical rows: it makes recipe retries idempotent, serializes version creation, rejects invalid or inactive components, records the exact recipe version used, locks non-draft quote snapshots, and replaces quote lines plus their snapshot in one transaction. The quote create/edit screens now persist the selected item-template identity and use that atomic RPC. Item Templates remains the only user-facing recipe editor; both legacy BOM route files redirect there.

Local evidence is green: the disposable-PostgreSQL workflow test, focused route/wiring contracts, inventory self-test, production build, and a read-only browser inspection of the Item Templates recipe dialog. The repository-wide lint command remains red on thousands of pre-existing formatting violations. Database-backed role/UAT tests could not run because the repository's expected local Supabase endpoint at `127.0.0.1:57421` is not running.

The hardening migration was applied to the hosted NJL database through Lovable Cloud after explicit approval on 10 September 2026. Post-apply verification confirmed the idempotency column, hardened function definitions, atomic quote-line RPC, exactly one enabled recipe audit trigger, and no remaining direct `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` grants on `item_template_materials` for `anon` or `authenticated`. Existing counts remained 19 recipe rows, zero quote-material snapshots, and zero Job BOM rows.

Controlled hosted owner/admin/staff UAT ran inside one explicit transaction and ended with `ROLLBACK`. It proved: repeated owner saves return one version; admin saves succeed; staff recipe saves are denied; staff can create an exact-version quote snapshot; direct recipe writes are denied; audit rows are generated; and submitted quote snapshots are locked. NJL had no persistent staff account, so the existing production identity was temporarily changed to staff only inside the rolled-back transaction. No real role change survived. A temporary customer, quote, line, signature URL, recipe versions, snapshot rows, and audit rows were likewise rolled back. Post-rollback verification found zero UAT records, restored the production role and null signature, and reconfirmed the original business-row counts.

The frontend changes remain local and build-tested. They were not pushed, merged, or deployed under this task's safety boundary; hosted database readiness must not be described as frontend deployment.
