import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260910174000_production_material_request_boundary.sql", "utf8");
const workspace = await readFile("src/routes/_app.production.$jobOrderId.tsx", "utf8");

assert.match(migration, /reserve_production_item_inventory\s*\(/);
assert.match(migration, /can_access_production_item\(auth\.uid\(\), p_job_order_line_item_id\)/);
assert.match(migration, /item\.job_order_line_item_id = p_job_order_line_item_id/);
assert.match(migration, /app_private\.production_item_readiness\(p_job_order_id\)/);
assert.match(migration, /p_quantity > v_remaining/);
assert.match(workspace, /"reserve_production_item_inventory"/);
assert.match(workspace, /p_job_order_line_item_id: lineItemId/);
assert.doesNotMatch(workspace, /type === "reserve" \? "reserve_inventory"/);

console.log("production item reservation boundary contract passed");
