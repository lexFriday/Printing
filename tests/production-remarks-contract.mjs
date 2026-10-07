import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260910173000_production_remarks.sql", import.meta.url),
  "utf8",
);
const production = readFileSync(
  new URL("../src/routes/_app.production.$jobOrderId.tsx", import.meta.url),
  "utf8",
);
const types = readFileSync(new URL("../src/integrations/supabase/types.ts", import.meta.url), "utf8");

assert.match(migration, /ADD COLUMN IF NOT EXISTS remarks TEXT/i);
assert.match(
  migration,
  /update_production_remarks\(\s*p_job_order_id UUID,\s*p_remarks TEXT\s*\)/i,
);
assert.match(migration, /can_access_production_job\(auth\.uid\(\), p_job_order_id\)/i);
assert.match(migration, /ERRCODE = '42501'/i);
assert.match(migration, /char_length\(v_remarks\) > 2000/i);
assert.match(migration, /NULLIF\(trim\(p_remarks\), ''\)/i);
assert.match(migration, /SECURITY DEFINER/i);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.update_production_remarks/i);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.update_production_remarks/i);
assert.match(production, /Production remarks/);
assert.match(production, /update_production_remarks/);
assert.match(production, /maxLength=\{2000\}/);
assert.match(types, /remarks: string \| null/);
assert.match(types, /update_production_remarks:/);

console.log("production remarks contract: passed");
