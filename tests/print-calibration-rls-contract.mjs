import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/20260817120000_print_calibrations.sql", import.meta.url), "utf8");
assert.match(sql, /create table public\.print_calibrations/i);
assert.match(sql, /unique\s*\(user_id,\s*document_type\)/i);
assert.match(sql, /user_id\s*=\s*auth\.uid\(\)/i);
assert.match(sql, /with check\s*\(user_id\s*=\s*auth\.uid\(\)/i);
assert.match(sql, /validate_print_calibration_fields/i);
assert.match(sql, /capture_audit_log/i);
console.log("Print calibration RLS contract passed");
