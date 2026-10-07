import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, completionMigration, queue, workspace, assignmentDialog] = await Promise.all([
  read("supabase/migrations/20260909195000_production_item_assignments.sql").catch(() => ""),
  read("supabase/migrations/20260909196000_production_item_queue_completion.sql").catch(() => ""),
  read("src/routes/_app.production.index.tsx"),
  read("src/routes/_app.production.$jobOrderId.tsx"),
  read("src/components/ProductionAssignmentDialog.tsx"),
]);

for (const pattern of [
  /CREATE TABLE public\.production_item_assignments/,
  /job_order_line_item_id UUID NOT NULL/,
  /removed_at TIMESTAMPTZ/,
  /WHERE removed_at IS NULL/,
  /CREATE OR REPLACE FUNCTION public\.set_production_item_assignments/,
  /p_expected_user_ids UUID\[\]/,
  /Assignments changed since you opened this item/,
  /Assign only active Production users/,
  /CREATE OR REPLACE FUNCTION public\.can_access_production_item/,
  /CREATE OR REPLACE FUNCTION public\.ensure_production_tasks/,
  /public\.can_access_production_item\(auth\.uid\(\), task\.job_order_line_item_id\)/,
  /CREATE OR REPLACE FUNCTION public\.production_item_readiness/,
  /CREATE TRIGGER capture_audit_log/,
])
  assert.match(migration, pattern);

assert.match(migration, /UPDATE public\.production_job_assignments[\s\S]*removed_at = now\(\)/);
assert.match(migration, /DROP FUNCTION IF EXISTS public\.set_production_job_assignments/);
assert.doesNotMatch(migration, /assignee_id\s*=\s*auth\.uid\(\)/);
assert.match(completionMigration, /item_completed BOOLEAN/);
assert.match(completionMigration, /NOT EXISTS[\s\S]*task\.status <> 'done'/);

for (const label of ["Needs assignment", "Active", "Completed"])
  assert.match(queue, new RegExp(label));
assert.match(queue, /productionStatusLabel/);
assert.match(queue, /My Production/);
assert.match(queue, /item_completed/);
assert.match(queue, /item_completed/);
assert.match(queue, /!item\.is_unassigned && !isCompleted\(item\)/);
assert.match(assignmentDialog, /Search production users/);
assert.match(assignmentDialog, /No active Production users are available/);
assert.match(assignmentDialog, /Remove the final assignee/);
assert.match(assignmentDialog, /set_production_item_assignments/);
assert.match(assignmentDialog, /setExpectedIds\(latestIds\)/);
assert.match(workspace, /Assign team/);
assert.match(workspace, /production-item-assignments/);
assert.match(
  workspace,
  /<span className="text-base font-semibold text-muted-foreground">Team:<\/span>/,
);
assert.match(workspace, /const openCustomMaterials = \(lineId\?: string\)/);
assert.match(workspace, /onClick=\{\(\) => openCustomMaterials\(itemId\)\}/);
assert.match(workspace, /Assign materials to item/);
assert.match(workspace, /All materials in this save will belong only to this item/);

console.log("production item assignment contract passed");
