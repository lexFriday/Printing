import assert from "node:assert/strict";
import { productionStatusLabel } from "./productionQueue.ts";

assert.equal(productionStatusLabel(null), "Not prepared");
assert.equal(productionStatusLabel(undefined), "Not prepared");
assert.equal(productionStatusLabel("in_progress"), "In Progress");

console.log("production queue self-test passed");

