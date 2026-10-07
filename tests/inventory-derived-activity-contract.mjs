import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260903100000_inventory_activity_summary.sql", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/routes/_app.inventory.$materialId.tsx", import.meta.url), "utf8");

assert.match(migration, /inventory_material_activity_summary/);
assert.match(migration, /SUM\(/);
assert.match(page, /inventory_material_activity_summary/);
assert.doesNotMatch(page, /movements \?\? \[\]\)\.reduce/);

console.log("Inventory derived activity contract: passed");
