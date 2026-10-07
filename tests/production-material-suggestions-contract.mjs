import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(
  new URL("../src/routes/_app.production.$jobOrderId.tsx", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260909201000_allow_assigned_production_supplemental_materials.sql",
    import.meta.url,
  ),
  "utf8",
);
const assignedProductionMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260910150000_allow_assigned_production_confirm_custom_materials.sql",
    import.meta.url,
  ),
  "utf8",
);

assert.match(workspace, /production-item-recipe-suggestions/);
assert.match(workspace, /from\("item_templates"\)/);
assert.match(workspace, /item_template_materials!inner/);
assert.match(workspace, /item_template_materials\.active/);
assert.doesNotMatch(workspace, /from\("bom_templates"\)/);
assert.match(workspace, /Start with a BOM suggestion/);
assert.match(workspace, /Use suggested materials/);
assert.match(workspace, /Item Template recipes prefill this form only/);
assert.match(workspace, /toLocaleLowerCase\(\) === normalizedMaterialLineDescription/);
assert.match(workspace, /Materials for this item/);
assert.match(workspace, /material\.job_order_line_item_id === itemId/);
assert.match(workspace, /canExecuteMaterials\s*&&\s*isReleasedBom/);
assert.doesNotMatch(
  workspace,
  /onClick=\{openCustomMaterials\}/,
  "buttons must not forward their click event into the optional line-id argument",
);
assert.match(
  workspace,
  /const submitCustomMaterials = \(\) => \{[\s\S]*addCustomMaterial\.mutate\(\);[\s\S]*\};/,
  "the save action has a zero-argument boundary so a click event cannot become mutation data",
);
assert.match(workspace, /type="button"[\s\S]*onClick=\{submitCustomMaterials\}/);
assert.match(migration, /public\.can_access_production_item\(auth\.uid\(\), p_job_order_line_item_id\)/);
assert.match(migration, /Production can add missing materials only after the BOM is released/);
assert.match(migration, /added_after_release_by, added_after_release_at, supplement_reason/);
assert.match(migration, /production\.missing_material_added/);
assert.match(migration, /This material is already assigned to the selected item/);
assert.match(
  assignedProductionMigration,
  /public\.can_access_production_item\(auth\.uid\(\), p_job_order_line_item_id\)/,
);
assert.match(
  assignedProductionMigration,
  /CREATE OR REPLACE FUNCTION public\.confirm_custom_item_materials/,
);
assert.doesNotMatch(
  assignedProductionMigration,
  /Production can add missing materials only after the BOM is released/,
);

console.log("production material suggestions contract: passed");
