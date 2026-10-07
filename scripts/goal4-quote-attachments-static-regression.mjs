import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const migration = readFileSync(
  "supabase/migrations/20260702093000_goal4_quote_attachments.sql",
  "utf8",
);
const component = readFileSync("src/components/QuoteAttachmentsSection.tsx", "utf8");
const detail = readFileSync("src/routes/_app.quotes.$id.tsx", "utf8");
const edit = readFileSync("src/routes/_app.quotes.$id.edit.tsx", "utf8");
const print = readFileSync("src/routes/quotes.$id.print.tsx", "utf8");

assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.quote_attachments/);
assert.match(migration, /storage\.buckets/);
assert.match(migration, /quote-attachments/);
assert.match(migration, /image\/jpeg/);
assert.match(migration, /image\/png/);
assert.match(migration, /image\/webp/);
assert.match(migration, /deleted_at/);
assert.match(migration, /can_view_sensitive_operations/);
assert.match(migration, /can_sales_work/);
assert.match(migration, /role::text IN \('owner', 'admin'\)/);
assert.match(migration, /storage\.objects/);

assert.match(component, /createSignedUrl/);
assert.match(component, /upload\(/);
assert.match(component, /quote-attachments/);
assert.match(component, /10 \* 1024 \* 1024/);
assert.match(component, /image\/jpeg/);
assert.match(component, /deleted_at/);
assert.match(component, /canDeleteQuoteAttachments/);

assert.match(detail, /QuoteAttachmentsSection/);
assert.match(edit, /QuoteAttachmentsSection/);
assert.doesNotMatch(print, /quote_attachments|QuoteAttachmentsSection/);

console.log("Goal 4 quote attachments static regression passed.");
