import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const foundationPath = new URL("../supabase/migrations/20260909170000_quote_linked_invoice_foundation.sql", import.meta.url);
const workflowPath = new URL("../supabase/migrations/20260909171000_create_invoice_from_approved_quote.sql", import.meta.url);
const issuePath = new URL("../supabase/migrations/20260909172000_issue_quote_linked_draft_invoice.sql", import.meta.url);

assert.equal(existsSync(foundationPath), true, "quote-linked invoice foundation migration must exist");
assert.equal(existsSync(workflowPath), true, "approved-quote invoice workflow migration must exist");
assert.equal(existsSync(issuePath), true, "draft invoice issuing migration must exist");

const foundation = readFileSync(foundationPath, "utf8");
const workflow = readFileSync(workflowPath, "utf8");
const issue = readFileSync(issuePath, "utf8");
const quotePage = readFileSync(new URL("../src/routes/_app.quotes.$id.tsx", import.meta.url), "utf8");

assert.match(foundation, /ADD VALUE IF NOT EXISTS 'draft'/);
assert.match(foundation, /ADD COLUMN IF NOT EXISTS quotation_id UUID REFERENCES public\.quotations/);
assert.match(foundation, /UNIQUE.*quotation_id|invoices_quotation_id_unique/is);
assert.match(workflow, /create_invoice_from_approved_quote/);
assert.match(workflow, /status::TEXT <> 'approved'/);
assert.match(workflow, /ON CONFLICT \(quotation_id\).*DO NOTHING/is);
assert.match(workflow, /INSERT INTO public\.invoice_line_items/is);
assert.match(issue, /issue_draft_invoice/);
assert.match(issue, /OLD\.status = 'draft'/);
assert.match(quotePage, /Create invoice/);
assert.match(quotePage, /Open invoice/);
assert.match(quotePage, /create_invoice_from_approved_quote/);

console.log("quote invoice workflow contract: passed");
