import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const queue = await readFile("src/routes/_app.purchasing.index.tsx", "utf8");

assert.match(queue, /groupPurchaseRequestsByJobOrder/);
assert.match(queue, /Production requests by Job Order/);
assert.match(queue, /PurchaseRequestRow/);
assert.match(queue, /Standalone inventory requests/);

console.log("purchasing Job Order grouping contract passed");
