import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260910180000_link_quote_invoice_to_job_order.sql", import.meta.url),
  "utf8",
);

assert.match(migration, /UPDATE public\.invoices[\s\S]*SET job_order_id = v_job\.id[\s\S]*quotation_id = p_quotation_id/);
assert.match(migration, /UPDATE public\.invoices AS invoice[\s\S]*FROM public\.job_orders AS job[\s\S]*invoice\.quotation_id = job\.quotation_id/);
assert.match(migration, /invoice\.job_order_id IS NULL/);
assert.match(migration, /OLD\.job_order_id IS NULL[\s\S]*NEW\.job_order_id IS NOT NULL/);
assert.match(migration, /job\.quotation_id = OLD\.quotation_id/);
assert.match(migration, /NEW\.status IS NOT DISTINCT FROM OLD\.status/);

console.log("quote/invoice/job linkage contract passed");
