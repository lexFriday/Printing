import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const queue = readFileSync(new URL("../src/routes/_app.production.index.tsx", import.meta.url), "utf8");
const detail = readFileSync(
  new URL("../src/routes/_app.production.$jobOrderId.tsx", import.meta.url),
  "utf8",
);

assert.match(queue, /max-w-6xl space-y-5 px-3 sm:px-0/);
assert.match(queue, /text-2xl font-semibold sm:text-3xl/);
assert.match(queue, /grid w-full gap-2 sm:flex sm:w-auto/);
assert.match(queue, /className="w-full sm:w-auto"/);
assert.match(detail, /flex flex-col gap-5 p-3 sm:p-5/);
assert.match(detail, /flex flex-col gap-3 sm:flex-row sm:items-center/);
assert.match(detail, /px-4 py-5 sm:px-8 sm:py-7/);
assert.match(detail, /mt-6 grid gap-3 sm:flex sm:flex-wrap/);

console.log("production mobile layout contract: passed");
