import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile("src/routes/_app.production.$jobOrderId.tsx", "utf8");
const purchasingLayout = await readFile("src/routes/_app.purchasing.tsx", "utf8");

assert.match(workspace, /supabase\.rpc\("request_missing_production_materials"/);
assert.match(workspace, /p_material_ids:\s*materialIds/);
assert.match(workspace, /Request missing materials/);
assert.match(workspace, /Requested from Purchasing/);
assert.match(workspace, /request.*sent to Purchasing/i);
assert.doesNotMatch(workspace, /supabase\.rpc\("create_shortage_request"/);
assert.match(purchasingLayout, /!canOperatePurchasing\(role\) && !canViewStatusOnly\(role\)/);
assert.match(purchasingLayout, /Purchasing is managed by Admin/);
assert.doesNotMatch(workspace, /navigate\(\{ to: "\/purchasing/);
assert.doesNotMatch(workspace, /Resolve shortages/);
assert.doesNotMatch(workspace, />Purchase \{shortageQuantity\}/);

console.log("production material request UI contract passed");
