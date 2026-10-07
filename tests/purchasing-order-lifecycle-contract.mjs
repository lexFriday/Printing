import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260904100000_purchase_order_lifecycle.sql", import.meta.url),
  "utf8",
);
const detail = readFileSync(
  new URL("../src/routes/_app.purchasing.$requestId.tsx", import.meta.url),
  "utf8",
);
const queue = readFileSync(
  new URL("../src/routes/_app.purchasing.index.tsx", import.meta.url),
  "utf8",
);
const reports = readFileSync(new URL("../src/routes/_app.reports.tsx", import.meta.url), "utf8");

assert.match(migration, /mark_purchase_request_ordered/);
assert.match(migration, /'ordered'/);
assert.match(migration, /expected_at/);
assert.match(detail, /Place order/);
assert.match(detail, /ordered_at/);
assert.match(detail, /expected_at/);
assert.match(detail, /Shortages resolved\. Returning to Production/);
assert.match(detail, /production_material_readiness/);
assert.match(detail, /to="\/production\/\$jobOrderId"/);
assert.match(queue, /ordered/);
assert.match(queue, /created_at/);
assert.match(reports, /value="purchasing"/);
assert.match(reports, /report-purchasing/);
assert.match(reports, /Outstanding quantity/);
console.log("Purchasing order lifecycle contract: passed");
