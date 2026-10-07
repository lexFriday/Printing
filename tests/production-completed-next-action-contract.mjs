import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../src/routes/_app.production.$jobOrderId.tsx", import.meta.url), "utf8");
assert.match(route, /status === "completed"[\s\S]*\? "Production complete"[\s\S]*: customSetupBlockedItems\.length/);
assert.match(route, /status === "completed"[\s\S]*\? "This Job Order is ready for the delivery workflow\."[\s\S]*: customSetupBlockedItems\.length/);
console.log("completed Production next-action precedence passed");
