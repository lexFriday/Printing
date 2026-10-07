import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260910100000_keep_production_in_progress_between_steps.sql", import.meta.url),
  "utf8",
);

assert.match(migration, /task\.status IN \('in_progress','on_hold','done'\)/);
assert.match(migration, /THEN 'in_progress'::public\.production_status/);
assert.match(migration, /job\.status = 'pending'/);
assert.match(migration, /SET status = 'in_production'/);
assert.match(migration, /Repair records created by the previous parent-state derivation/);

console.log("production parent state contract passed");
