import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

function readEnv() {
  const envPath = path.resolve(".env.local");
  const raw = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=["']?(.+?)["']?$/);
    if (match) process.env[match[1]] ??= match[2];
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

readEnv();

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

assert(url, "Missing local Supabase URL.");
assert(key, "Missing local Supabase publishable key.");

const supabase = createClient(url, key);
const suffix = Date.now();

const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
  email: "owner@local.test",
  password: "password123",
});
if (authError) throw authError;
assert(auth.user, "Owner sign-in did not return a user.");

const signatureUrl = `https://example.test/signatures/${suffix}.png`;
const profileUpdate = await supabase
  .from("profiles")
  .update({ signature_url: signatureUrl, display_name: `Goal 2 Owner ${suffix}` })
  .eq("id", auth.user.id);
if (profileUpdate.error) throw profileUpdate.error;

const { data: profile, error: profileError } = await supabase.rpc("get_current_user_profile");
if (profileError) throw profileError;
const currentProfile = Array.isArray(profile) ? profile[0] : profile;
assert(
  currentProfile?.user_id === auth.user.id,
  "Current user profile RPC returned the wrong user.",
);
assert(currentProfile?.role === "owner", "Current user profile RPC did not return owner role.");
assert(
  currentProfile?.signature_url === signatureUrl,
  "Current user profile RPC did not return signature.",
);

const { data: customer, error: customerError } = await supabase
  .from("customers")
  .insert({
    customer_name: `Goal 2 Customer ${suffix}`,
    contact_person: "QA",
    contact_number: "000",
  })
  .select("id")
  .single();
if (customerError) throw customerError;

const { data: quote, error: quoteError } = await supabase
  .from("quotations")
  .insert({
    customer_id: customer.id,
    project_name: `Goal 2 Quote ${suffix}`,
    sales_agent: currentProfile.display_name,
    sales_agent_user_id: currentProfile.user_id,
    adjustment_label: "Round off",
    adjustment_amount: -5,
    created_by: auth.user.id,
  })
  .select("id")
  .single();
if (quoteError) throw quoteError;

const { error: lineError } = await supabase.from("quote_line_items").insert({
  quotation_id: quote.id,
  description: "Regression line",
  pricing_mode: "fixed",
  quantity: 1,
  unit_price: 100,
  line_total: 100,
});
if (lineError) throw lineError;

const { data: adjustedQuote, error: adjustedError } = await supabase
  .from("quotations")
  .select("subtotal,total_amount,adjustment_amount")
  .eq("id", quote.id)
  .single();
if (adjustedError) throw adjustedError;
assert(Number(adjustedQuote.subtotal) === 100, "Subtotal did not derive from line items.");
assert(
  Number(adjustedQuote.total_amount) === 95,
  "Total did not derive from subtotal + adjustment.",
);

const sent = await supabase
  .from("quotations")
  .update({ status: "sent", sent_at: new Date().toISOString() })
  .eq("id", quote.id);
if (sent.error) throw sent.error;

const { data: sentQuote, error: sentQuoteError } = await supabase
  .from("quotations")
  .select("sales_agent_signature_url_snapshot")
  .eq("id", quote.id)
  .single();
if (sentQuoteError) throw sentQuoteError;
assert(
  sentQuote.sales_agent_signature_url_snapshot === signatureUrl,
  "Sending quote did not snapshot signature.",
);

const approved = await supabase
  .from("quotations")
  .update({ status: "approved", approved_at: new Date().toISOString() })
  .eq("id", quote.id);
if (approved.error) throw approved.error;

const blankReopen = await supabase.rpc("reopen_quotation_for_correction", {
  quotation_id: quote.id,
  reason: " ",
});
assert(blankReopen.error, "Blank reopen reason should fail.");

const reopened = await supabase.rpc("reopen_quotation_for_correction", {
  quotation_id: quote.id,
  reason: "Regression correction",
});
if (reopened.error) throw reopened.error;

const { data: reopenedQuote, error: reopenedQuoteError } = await supabase
  .from("quotations")
  .select("status,sent_at,approved_at")
  .eq("id", quote.id)
  .single();
if (reopenedQuoteError) throw reopenedQuoteError;
assert(reopenedQuote.status === "draft", "Reopened quote did not return to draft.");
assert(reopenedQuote.sent_at === null, "Reopened quote should clear sent_at.");
assert(reopenedQuote.approved_at === null, "Reopened quote should clear approved_at.");

const { data: audit, error: auditError } = await supabase
  .from("audit_logs")
  .select("id")
  .eq("entity_type", "quotation")
  .eq("entity_id", quote.id)
  .eq("action", "quotation.reopened")
  .maybeSingle();
if (auditError) throw auditError;
assert(audit, "Reopen did not write audit log.");

await supabase
  .from("quotations")
  .update({ status: "sent", sent_at: new Date().toISOString() })
  .eq("id", quote.id);
await supabase
  .from("quotations")
  .update({ status: "approved", approved_at: new Date().toISOString() })
  .eq("id", quote.id);

const { data: job, error: jobError } = await supabase
  .from("job_orders")
  .insert({
    quotation_id: quote.id,
    customer_id: customer.id,
    project_name: `Goal 2 Job ${suffix}`,
    quoted_amount: 95,
    status: "pending",
  })
  .select("id,quoted_amount")
  .single();
if (jobError) throw jobError;
assert(Number(job.quoted_amount) === 95, "Job order did not use adjusted quote total.");

const blockedReopen = await supabase.rpc("reopen_quotation_for_correction", {
  quotation_id: quote.id,
  reason: "Should be blocked",
});
assert(blockedReopen.error, "Reopen after job order should fail.");

console.log("Goal 2 quote foundation regression passed.");
