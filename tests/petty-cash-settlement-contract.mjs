import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260915154000_petty_cash_settlement.sql", import.meta.url),
  "utf8",
);

assert.match(migration, /ADD COLUMN IF NOT EXISTS cash_returned_amount/);
assert.match(migration, /settle_and_close_petty_cash_batch/);
assert.match(migration, /must reconcile to zero before closing/);
assert.match(migration, /validate_petty_cash_batch_balance/);
assert.match(migration, /One CV can only be created after a closed petty-cash batch/);

console.log("petty-cash settlement contract passed");
