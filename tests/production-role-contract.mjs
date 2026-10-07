import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [roles, sidebar, jobs, production, users, types, enumMigration, permissionMigration] = await Promise.all([
  read("src/lib/roles.ts"), read("src/components/AppSidebar.tsx"), read("src/routes/_app.jobs.tsx"),
  read("src/routes/_app.production.$jobOrderId.tsx"), read("src/routes/_app.settings.users.tsx"),
  read("src/integrations/supabase/types.ts"), read("supabase/migrations/20260909182000_add_production_role.sql"),
  read("supabase/migrations/20260909183000_production_role_permissions.sql"),
]);

assert.match(types, /\| "production"/, "generated role type includes production");
assert.match(enumMigration, /ADD VALUE IF NOT EXISTS 'production'/, "database enum includes production");
assert.match(roles, /canExecuteProduction[\s\S]*role === "production"/, "production execution is centralized");
assert.match(roles, /canOperateInventory[\s\S]*role === "production"/, "production can operate inventory");
assert.doesNotMatch(roles.match(/canOperatePurchasing[\s\S]*?\n}/)?.[0] ?? "", /production/, "production cannot operate purchasing");
assert.doesNotMatch(roles.match(/canViewMoneyWork[\s\S]*?\n}/)?.[0] ?? "", /production/, "production cannot see finance");
assert.match(sidebar, /canViewJobOrders\(role\)/, "production gets Job Orders without invoices");
assert.match(jobs, /canViewJobOrders\(role\)/, "Job Orders route uses the same boundary");
assert.match(production, /canExecuteProduction\(role\)/, "production workspace uses the centralized boundary");
assert.match(production, /role === "production"[\s\S]*Back to production queue/, "production completion returns to its queue");
assert.match(production, /role === "production"[\s\S]*Your production work is complete/, "production sees a role-appropriate completion message");
assert.match(users, /value="production">Production/, "owners can assign the Production role");
for (const operation of ["reserve_inventory", "record_inventory_movement", "start_production", "update_production_task", "create_shortage_request"]) {
  assert.match(permissionMigration, new RegExp(operation), `${operation} is covered by database permissions`);
}
console.log("production role contract passed");
