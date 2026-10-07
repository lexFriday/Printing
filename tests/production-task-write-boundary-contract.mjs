import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, workspace] = await Promise.all([
  readFile("supabase/migrations/20260909199000_lock_production_task_writes_to_rpcs.sql", "utf8"),
  readFile("src/routes/_app.production.$jobOrderId.tsx", "utf8"),
]);

assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER/);
assert.match(migration, /production_tasks FROM anon, authenticated/);
assert.match(migration, /DROP POLICY IF EXISTS production_tasks_update/);
assert.match(workspace, /supabase\.rpc\("update_production_task"/);
assert.doesNotMatch(workspace, /\.from\("production_tasks"\)[\s\S]{0,200}\.update\(/);

console.log("production task write boundary contract passed");
