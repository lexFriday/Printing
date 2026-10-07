import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260910170000_repair_legacy_supplier_columns.sql", import.meta.url),
  "utf8",
);

assert.match(migration, /ADD COLUMN IF NOT EXISTS name TEXT/i);
assert.match(migration, /supplier_name/i);
assert.match(migration, /ADD COLUMN IF NOT EXISTS active BOOLEAN/i);
assert.match(migration, /is_active/i);
assert.doesNotMatch(migration, /DROP COLUMN/i, "Supplier repair must preserve legacy data");
assert.match(migration, /SET NOT NULL/i);

console.log("supplier canonical columns migration contract: passed");
