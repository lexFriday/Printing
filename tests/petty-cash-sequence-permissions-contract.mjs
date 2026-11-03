import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pettyCashNumbersMigration = readFileSync(
  new URL("../supabase/migrations/20260922161000_petty_cash_numbers.sql", import.meta.url),
  "utf8",
);
const generalExpenseNumbersMigration = readFileSync(
  new URL("../supabase/migrations/20260922162000_general_expense_numbers.sql", import.meta.url),
  "utf8",
);
const sequenceGrantsMigration = readFileSync(
  new URL("../supabase/migrations/20260930100000_grant_number_sequence_permissions.sql", import.meta.url),
  "utf8",
);

assert.match(
  pettyCashNumbersMigration,
  /GRANT USAGE, SELECT ON SEQUENCE public\.petty_cash_number_seq TO authenticated/i,
);
assert.match(
  generalExpenseNumbersMigration,
  /GRANT USAGE, SELECT ON SEQUENCE public\.general_expense_number_seq TO authenticated/i,
);
assert.match(
  sequenceGrantsMigration,
  /GRANT USAGE, SELECT ON SEQUENCE public\.petty_cash_number_seq TO authenticated/i,
);
assert.match(
  sequenceGrantsMigration,
  /GRANT USAGE, SELECT ON SEQUENCE public\.general_expense_number_seq TO authenticated/i,
);

console.log("petty-cash sequence permissions contract passed");

