import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/routes/_app.purchasing.index.tsx", import.meta.url), "utf8");
assert.match(page, /production-queue-for-purchasing/);
assert.match(page, /Blocks production/);
assert.match(page, /sort\(/);
assert.match(page, /job_order_id/);
console.log("Purchasing triage contract: passed");
