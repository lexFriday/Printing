import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const roles = readFileSync(new URL("../src/lib/roles.ts", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../supabase/migrations/20260915153000_money_out_permissions_and_atomic_save.sql", import.meta.url),
  "utf8",
);

assert.match(roles, /export function canManageMoneyOut/);
assert.match(roles, /role === "accounting"/);
assert.doesNotMatch(
  roles.match(/export function canManageMoneyOut[\s\S]*?\n}\n/)?.[0] ?? "",
  /role === "staff"/,
);
assert.match(migration, /app_private\.can_accounting_work\(auth\.uid\(\)\)/);
assert.match(migration, /create_job_expense_with_allocations/);
assert.match(migration, /Allocation total cannot exceed the expense amount/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_job_expense_with_allocations/);

console.log("money-out permissions and atomic-save contract passed");
