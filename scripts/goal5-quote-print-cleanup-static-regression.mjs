import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const print = readFileSync("src/routes/quotes.$id.print.tsx", "utf8");

assert.doesNotMatch(print, /<div className="font-bold">VAT Mode<\/div>/);
assert.doesNotMatch(print, /<div className="font-bold">TIN<\/div>/);
assert.doesNotMatch(print, /<div className="font-bold">Sales Agent<\/div>/);
assert.doesNotMatch(print, /<div className="font-bold">Terms<\/div>/);
assert.doesNotMatch(print, /\["VAT Mode"/);
assert.doesNotMatch(print, /\["TIN"/);
assert.doesNotMatch(print, /\["Sales Agent"/);
assert.doesNotMatch(print, /\["Terms"/);

assert.match(print, /quoteNumber/);
assert.match(print, /quoteDate/);
assert.match(print, /projectName/);
assert.match(print, /customer_name/);
assert.match(print, /contact_person/);
assert.match(print, /Terms and Condition:/);
assert.match(print, /adjustmentAmount/);
assert.match(print, /Number\(.*adjustment.*\) !== 0/s);
assert.match(print, /sales_agent_signature_url_snapshot/);
assert.match(print, /signatureUrl/);
assert.match(print, /Approved By:/);
assert.doesNotMatch(print, /quote_attachments|QuoteAttachmentsSection/);

console.log("Goal 5 quote print cleanup static regression passed.");
