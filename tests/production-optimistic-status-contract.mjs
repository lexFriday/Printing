import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const production = readFileSync(
  new URL("../src/routes/_app.production.$jobOrderId.tsx", import.meta.url),
  "utf8",
);

assert.match(production, /cancelQueries\(\{ queryKey: \["production-job", jobOrderId\] \}\)/);
assert.match(production, /cancelQueries\(\{ queryKey: \["production-tasks", jobOrderId\] \}\)/);
assert.match(production, /previousProduction/);
assert.match(production, /previousTasks/);
assert.match(production, /setQueryData\(\["production-job", jobOrderId\]/);
assert.match(production, /setQueryData\(\["production-tasks", jobOrderId\]/);
assert.match(production, /queryKey: \["production-workspace-queue"\]/);
assert.match(production, /onSettled:/);

console.log("production optimistic status contract: passed");
