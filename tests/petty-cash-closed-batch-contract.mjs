import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260915152000_petty_cash_closed_batch_receipt_guard.sql",
    import.meta.url,
  ),
  "utf8",
);

assert.match(migration, /guard_petty_cash_receipt_batch/);
assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE/);
assert.match(migration, /status = 'open'/);
assert.match(migration, /Petty-cash receipts can only be changed while the batch is open/);

console.log("petty-cash closed-batch contract passed");
