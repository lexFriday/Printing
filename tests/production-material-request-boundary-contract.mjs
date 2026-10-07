import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  "supabase/migrations/20260910174000_production_material_request_boundary.sql",
  "utf8",
).catch(() => "");

assert.match(migration, /request_missing_production_materials\s*\(/);
assert.match(migration, /p_material_ids UUID\[\]/i);
assert.match(migration, /p_idempotency_key TEXT/i);
assert.match(migration, /can_access_production_item\(auth\.uid\(\), item\.job_order_line_item_id\)/);
assert.match(migration, /bom\.released_at IS NOT NULL/);
assert.match(migration, /production\.status IN \('preparing', 'partially_reserved', 'ready_to_start', 'in_progress'\)/);
assert.match(migration, /inventory_balance\(requested_material\.material_id\)/);
assert.match(migration, /ON CONFLICT \(job_order_id, material_id\)/);
assert.match(migration, /\n\s*'requested',\n\s*auth\.uid\(\)/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.request_missing_production_materials/);
assert.doesNotMatch(migration, /p_supplier_id|p_status/);

console.log("production material request boundary contract passed");
