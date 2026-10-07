import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const migrationPath = new URL("../supabase/migrations/20260910182000_production_sla.sql", import.meta.url);
assert.equal(existsSync(migrationPath), true, "production SLA migration must exist");
const sql = readFileSync(migrationPath, "utf8");
assert.match(sql, /ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ/);
assert.match(sql, /add_working_days\([^)]*,\s*3\)/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.set_production_sla/);
assert.match(sql, /Production SLA change reason is required/);
assert.match(sql, /production\.sla_revised/);
assert.match(sql, /production_item_assignments/);
assert.doesNotMatch(sql, /blocked_flag|sla_status/);
console.log("production SLA contract passed");
