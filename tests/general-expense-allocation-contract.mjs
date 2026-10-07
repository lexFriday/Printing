import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260915150000_general_expense_allocation_review.sql",
    import.meta.url,
  ),
  "utf8",
);

assert.match(migration, /Allocation total cannot exceed the expense amount/);
assert.doesNotMatch(migration, /Allocation total must equal the receipt amount/);
assert.match(migration, /Job Order allocations cannot be added to a directly linked expense/);
assert.match(migration, /CREATE TRIGGER capture_audit_log[\s\S]*ON public\.job_expense_allocations/);

console.log("general expense allocation contract passed");
