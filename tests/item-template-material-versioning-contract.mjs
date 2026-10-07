import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260903110000_item_template_material_versioning.sql", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/routes/_app.settings.item-templates.tsx", import.meta.url), "utf8");
assert.match(migration, /save_item_template_material_version/);
assert.match(migration, /version INTEGER/);
assert.match(migration, /active BOOLEAN/);
assert.match(page, /save_item_template_material_version/);
assert.doesNotMatch(page, /from\("item_template_materials"\).*delete/);
console.log("Item Template material versioning contract: passed");
