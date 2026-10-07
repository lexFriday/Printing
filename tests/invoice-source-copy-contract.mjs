import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../src/routes/_app.invoices.$id.tsx", import.meta.url), "utf8");
assert.match(route, /i\.quotation_id[\s\S]*Copied from the approved quotation/);
assert.doesNotMatch(route, /Â·/);
console.log("invoice source copy contract passed");
