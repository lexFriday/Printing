import assert from "node:assert/strict";
import fs from "node:fs";

const migrationDir = "supabase/migrations";
const migrations = fs.readdirSync(migrationDir).filter((name) => name.endsWith(".sql"));
const source = migrations.map((name) => fs.readFileSync(`${migrationDir}/${name}`, "utf8")).join("\n");
const page = fs.readFileSync("src/routes/_app.production.$jobOrderId.tsx", "utf8");

assert.match(source, /production_item_readiness/);
assert.match(source, /quote_material_estimates/);
assert.match(source, /reserved_total|allocated_reserved/);
assert.match(source, /blocked item|item readiness|shortage/i);
assert.match(source, /update_production_task[\s\S]*readiness/i);
assert.match(source, /for_reconciliation/);
assert.match(source, /complete the previous production step first/);
assert.match(page, /production_item_readiness/);
assert.match(page, /Next item to produce/);
assert.match(page, /Missing:/);
assert.match(page, /All production steps are complete/);
assert.match(page, /Waiting/);

console.log("per-item production readiness contract: passed");
