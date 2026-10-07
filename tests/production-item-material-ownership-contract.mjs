import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260909200000_enforce_item_owned_job_bom_materials.sql",
    import.meta.url,
  ),
  "utf8",
).catch(() => "");

assert.match(migration, /DROP TRIGGER IF EXISTS trg_snapshot_job_order_materials/);
assert.match(migration, /HAVING COUNT\(line\.id\) = 1/);
assert.match(migration, /\(ARRAY_AGG\(line\.id\)\)\[1\] AS line_id/);
assert.match(migration, /DELETE FROM public\.job_bom_items AS legacy/);
assert.match(migration, /existing\.material_id = legacy\.material_id/);
assert.match(migration, /ROW_NUMBER\(\) OVER/);
assert.match(migration, /SUM\(material\.planned_quantity\) OVER/);
assert.match(migration, /SET job_order_line_item_id = owner\.line_id/);
assert.match(migration, /CHECK \(job_order_line_item_id IS NOT NULL\) NOT VALID/);

console.log("production item material ownership contract passed");
