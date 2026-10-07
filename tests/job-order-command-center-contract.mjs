import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/routes/_app.production.$jobOrderId.tsx", import.meta.url), "utf8");
const readiness = readFileSync(new URL("../supabase/migrations/20260904110000_unified_production_readiness.sql", import.meta.url), "utf8");

assert.match(page, /purchase_requests/);
assert.match(page, /\/inventory\/\$materialId/);
assert.match(page, /\/purchasing\/\$requestId/);
assert.match(page, /Responsible role/);
assert.match(page, /Blocker/);
assert.match(page, /Next action/);
assert.match(readiness, /production_material_readiness/);
console.log("Job Order command-center contract: passed");
