import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260915140000_petty_cash_funding_events.sql", import.meta.url),
  "utf8",
);
const reports = readFileSync(new URL("../src/routes/_app.reports.tsx", import.meta.url), "utf8");

assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.petty_cash_funding_events/);
assert.match(migration, /Cash can only be added to an open petty cash batch/);
assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE/);
assert.match(reports, /Add cash/);
assert.match(reports, /petty_cash_funding_events/);

console.log("petty cash funding events contract passed");
