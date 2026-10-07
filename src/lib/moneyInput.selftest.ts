import assert from "node:assert/strict";
import { formatMoneyInput, normalizeMoneyInput } from "./moneyInput.ts";

assert.equal(formatMoneyInput("193000"), "193,000");
assert.equal(formatMoneyInput("193000.50"), "193,000.50");
assert.equal(formatMoneyInput("193000."), "193,000.");
assert.equal(normalizeMoneyInput("193,000.50"), "193000.50");
assert.equal(normalizeMoneyInput("193,000x"), null);

console.log("money input self-test passed");
