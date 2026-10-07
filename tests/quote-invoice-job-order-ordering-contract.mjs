import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/migrations/20260910181000_link_job_order_when_creating_quote_invoice.sql", import.meta.url), "utf8");
assert.match(sql, /WHERE job\.quotation_id = p_quotation_id/);
assert.match(sql, /v_quote\.id, NULL, v_quote\.customer_id/);
assert.match(sql, /v_invoice\.job_order_id IS NULL AND v_job_order_id IS NOT NULL/);
assert.match(sql, /IF v_job_order_id IS NOT NULL THEN[\s\S]*UPDATE public\.invoices SET job_order_id = v_job_order_id/);
console.log("quote invoice creation-order contract passed");
