import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260915151000_petty_cash_receipt_evidence.sql",
    import.meta.url,
  ),
  "utf8",
);

assert.match(migration, /ADD COLUMN IF NOT EXISTS receipt_missing_reason/);
assert.match(migration, /job_expenses_petty_cash_receipt_evidence/);
assert.match(migration, /payment_proof_storage_path IS NOT NULL/);
assert.match(migration, /receipt_missing_reason/);
assert.match(migration, /NOT VALID/);
assert.match(migration, /job_expenses_petty_cash_receipt_paid/);
assert.match(migration, /payment_status = 'paid'/);

console.log("petty cash receipt evidence contract passed");
