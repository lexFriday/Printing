import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile("src/routes/jobs.$id.job-order.print.tsx", "utf8");

assert.match(route, /\.from\("job_boms"\)/);
assert.match(route, /job_bom_items\(id, planned_quantity, unit, materials\(name\)\)/);
assert.match(route, /materialPlan/);
assert.doesNotMatch(route, /expense\.expense_type === "materials"/);
assert.match(route, /table-fixed/);
assert.match(route, /<colgroup>/);

console.log("job order print material contract passed");
