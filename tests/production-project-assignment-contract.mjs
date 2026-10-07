import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, itemMigration, board, roles, users, types, sidebar] = await Promise.all([
  read("supabase/migrations/20260909192000_production_project_assignments.sql"),
  read("supabase/migrations/20260909195000_production_item_assignments.sql"),
  read("src/routes/_app.production.index.tsx"),
  read("src/lib/roles.ts"),
  read("src/routes/_app.settings.users.tsx"),
  read("src/integrations/supabase/types.ts"),
  read("src/components/AppSidebar.tsx"),
]);

assert.match(migration, /CREATE TABLE public\.production_job_assignments/);
assert.match(migration, /removed_at TIMESTAMPTZ/);
assert.match(migration, /WHERE removed_at IS NULL/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.set_production_job_assignments/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.production_workspace_queue/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.production_assignment_options/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.can_access_production_job/);
assert.match(migration, /Production workers can only update assigned Job Orders/);
assert.match(migration, /Production workers can only update their own assigned step/);
assert.match(migration, /CREATE TRIGGER capture_audit_log/);
assert.match(itemMigration, /INSERT INTO public\.production_item_assignments/);
assert.match(itemMigration, /UPDATE public\.production_job_assignments/);
assert.match(itemMigration, /DROP FUNCTION IF EXISTS public\.set_production_job_assignments/);

assert.match(roles, /canAssignProduction[\s\S]*role === "admin"/);
assert.doesNotMatch(users, /production_supervisor/);
assert.doesNotMatch(types, /production_supervisor/);
assert.doesNotMatch(sidebar, /production_supervisor/);

assert.match(board, /production-workspace-queue/);
assert.match(board, /production_workspace_queue/);
assert.match(board, /ProductionAssignmentDialog/);
assert.match(board, /Unassigned/);
assert.match(board, /You have no assigned production work/);
assert.doesNotMatch(board, /setMyWork/);
assert.doesNotMatch(board, /My work/);

console.log("production project assignment contract passed");
