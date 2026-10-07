import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const purchasingHelper = readFileSync(
  new URL("../src/lib/fabricationInventory.ts", import.meta.url),
  "utf8",
);

assert.doesNotMatch(
  purchasingHelper,
  /\.toSorted\(/,
  "Purchasing must not require Array.prototype.toSorted because deployed client machines may use older browser engines",
);

console.log("purchasing browser compatibility contract: passed");
