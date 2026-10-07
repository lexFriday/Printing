import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const production = readFileSync(
  new URL("../src/routes/_app.production.$jobOrderId.tsx", import.meta.url),
  "utf8",
);

assert.match(production, /Array\.isArray\(data\) \? \(data\[0\] \?\? null\) : data/);
assert.match(production, /This production item is not assigned to your account/);
assert.match(production, /Ask an Owner or Admin to assign you to the item/);
assert.match(production, /Unable to load this production document/);

console.log("production document access state contract: passed");
