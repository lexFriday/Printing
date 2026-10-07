import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20260909193000_enforce_production_assignment_boundary.sql", import.meta.url),
  "utf8",
);

for (const functionName of [
  "get_production_job",
  "production_material_readiness",
  "production_item_readiness",
  "reserve_inventory",
  "record_inventory_movement",
  "record_production_material_activity",
  "start_production",
  "create_shortage_request",
  "reconcile_production",
  "complete_production",
]) {
  const definition = migration.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?(?=CREATE OR REPLACE FUNCTION|-- Direct table|NOTIFY)`));
  assert.ok(definition, `${functionName} must be replaced by the boundary migration`);
  assert.match(definition[0], /can_access_production_job/, `${functionName} must enforce project assignment`);
}

for (const table of ["production_jobs", "job_boms", "job_bom_items", "production_material_exceptions", "purchase_requests"]) {
  assert.match(migration, new RegExp(`CREATE POLICY [\\s\\S]*? ON public\\.${table}[\\s\\S]*?can_access_production_job`));
}

assert.match(migration, /over-consumption requires Owner or Admin approval/);
assert.match(migration, /Production workers cannot approve protected exceptions/);

console.log("production assignment authorization contract passed");
