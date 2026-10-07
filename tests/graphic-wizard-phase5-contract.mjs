import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

const migrationPath = new URL(
  "../supabase/migrations/20260831197000_bom_template_versioning.sql",
  import.meta.url,
);

assert.equal(
  existsSync(migrationPath),
  true,
  "Phase 5 needs a guarded BOM-template versioning migration",
);

const migration = readFileSync(migrationPath, "utf8");
assert.match(migration, /save_bom_template_version/);
assert.match(migration, /owner or admin BOM template management required/);
assert.match(migration, /UPDATE public\.bom_templates SET is_active = false/);
assert.match(migration, /duplicate material is not allowed in a BOM template/);

const templatePagePath = new URL("../src/routes/_app.settings.item-templates.tsx", import.meta.url);
assert.equal(
  existsSync(templatePagePath),
  true,
  "Phase 5 needs owner/admin BOM recipes inside Item Templates",
);

const templatePage = readFileSync(templatePagePath, "utf8");
assert.match(templatePage, /Materials \/ BOM/);
assert.match(templatePage, /Save materials/);
assert.match(templatePage, /Existing Job Order plans remain unchanged/);

console.log("Graphic Wizard Phase 5 contract: passed");
