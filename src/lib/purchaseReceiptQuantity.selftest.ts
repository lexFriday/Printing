import assert from "node:assert/strict";
import { displayReceiptQuantity, parseReceiptQuantity } from "./purchaseReceiptQuantity.ts";

assert.equal(displayReceiptQuantity(null, 3), "3", "untouched input defaults to the remaining quantity");
assert.equal(displayReceiptQuantity("", 3), "", "a cleared input stays empty");
assert.equal(parseReceiptQuantity(null, 3), 3, "untouched input posts the remaining quantity");
assert.equal(parseReceiptQuantity("", 3), 0, "a cleared input cannot silently post the default");
assert.equal(parseReceiptQuantity("1.5", 3), 1.5, "entered partial receipts remain supported");

console.log("purchase receipt quantity self-test passed");
