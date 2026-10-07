import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, workspace] = await Promise.all([
  readFile("supabase/migrations/20260909197000_production_material_activity_boundary.sql", "utf8"),
  readFile("src/routes/_app.production.$jobOrderId.tsx", "utf8"),
]);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.production_material_activity/);
assert.match(migration, /can_access_production_job\(auth\.uid\(\), p_job_order_id\)/);
assert.match(migration, /item\.material_id = p_material_id/);
assert.match(
  migration,
  /can_access_production_item\(auth\.uid\(\), item\.job_order_line_item_id\)/,
);
assert.match(migration, /app_private\.record_production_material_activity/);
assert.match(workspace, /supabase\.rpc\("production_material_activity"/);
assert.doesNotMatch(workspace, /from\("inventory_movements"\)/);

console.log("production material activity boundary contract passed");
