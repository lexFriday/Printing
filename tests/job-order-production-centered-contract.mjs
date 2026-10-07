import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(new URL("../src/components/AppSidebar.tsx", import.meta.url), "utf8");
const jobPage = readFileSync(new URL("../src/routes/_app.jobs.$id.tsx", import.meta.url), "utf8");

assert.doesNotMatch(sidebar, /const productionItem =/);
assert.match(sidebar, /canOperateInventory\(role\)/);
assert.match(sidebar, /canOperatePurchasing\(role\)/);
assert.doesNotMatch(jobPage, /<ProductionWorkspace/);
assert.match(jobPage, /production workspace|Open production/i);

console.log("Job Order production-centered contract: passed");
