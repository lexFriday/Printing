import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile("src/routes/_app.quotes.$id.tsx", "utf8");
const migration = await readFile(
  "supabase/migrations/20260909185000_production_lead_handoff.sql",
  "utf8",
);
const board = await readFile("src/routes/_app.production.index.tsx", "utf8");
const assignmentDialog = await readFile("src/components/ProductionAssignmentDialog.tsx", "utf8");

assert.match(route, /create_job_order_from_approved_quote/);
assert.doesNotMatch(route, /Person in charge of this job/);
assert.doesNotMatch(route, /Production lead/);
assert.doesNotMatch(route, /p_production_lead_user_id/);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_job_order_from_approved_quote/);
assert.match(migration, /responsible_user_id/);
assert.match(migration, /INSERT INTO public\.production_jobs/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.production_job_document/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.production_job_line_items/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.production_task_board/);
assert.match(migration, /public\.has_role\(auth\.uid\(\), 'production'\)/);
assert.doesNotMatch(migration, /CREATE POLICY job_orders_production_read/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.assign_production_task/);
assert.match(migration, /Production assignee must be an active Production user/);
assert.match(board, /ProductionAssignmentDialog/);
assert.match(assignmentDialog, /queryKey:\s*\["production-assignment-options"\]/);
assert.match(assignmentDialog, /production_assignment_options/);
assert.match(assignmentDialog, /set_production_item_assignments/);

console.log("production lead handoff contract passed");
