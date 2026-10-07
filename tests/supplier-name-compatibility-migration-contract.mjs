import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260910171000_sync_legacy_supplier_name.sql", import.meta.url),
  "utf8",
);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.sync_supplier_name_columns/i);
assert.match(migration, /BEFORE INSERT OR UPDATE OF name, supplier_name/i);
assert.match(migration, /NEW\.supplier_name := NEW\.name/i);
assert.match(migration, /NEW\.name := NEW\.supplier_name/i);
assert.match(migration, /UPDATE public\.suppliers/i);
assert.doesNotMatch(migration, /DROP COLUMN/i);

console.log("supplier name compatibility migration contract: passed");
