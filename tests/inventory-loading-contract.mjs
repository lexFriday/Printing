import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/routes/_app.inventory.tsx", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /const materialRows = materials\.data \?\? \[\];/,
  "inventory normalizes an undefined query result to an empty list",
);
assert.doesNotMatch(
  source,
  /materials\.data\.(length|filter|map)/,
  "inventory rendering never dereferences an undefined query result",
);

console.log("inventory loading contract passed");
