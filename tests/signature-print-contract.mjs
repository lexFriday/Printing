import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [
  quotePrint,
  jobPrint,
  checkPrint,
  voucherPrint,
  usersPage,
  signatureMigration,
  hardeningMigration,
] = await Promise.all([
  read("src/routes/quotes.$id.print.tsx"),
  read("src/routes/jobs.$id.job-order.print.tsx"),
  read("src/routes/expenses.$id.check.print.tsx"),
  read("src/routes/expenses.$id.check-voucher.print.tsx"),
  read("src/routes/_app.settings.users.tsx"),
  read("supabase/migrations/20260909190000_safe_user_signature_workflow.sql"),
  read("supabase/migrations/20260909194000_signature_snapshot_immutability.sql"),
]);

assert.match(
  usersPage,
  /Remove signature\?[\s\S]*finalized\s+documents keep their original signature/,
  "signature removal explains its historical-document impact before confirmation",
);

assert.doesNotMatch(
  quotePrint,
  /Michaela Corre|Customer Service \/ Admin/,
  "quotation signer identity is never hardcoded",
);
assert.match(
  quotePrint,
  /sales_agent_signature_url_snapshot/,
  "final quotations use a stored signature snapshot",
);
assert.match(
  quotePrint,
  /THIS QUOTATION IS VALID ONLY FOR 30 DAYS/,
  "quotation includes 30-day validity notice",
);
assert.match(
  quotePrint,
  /text-red-600[\s\S]*THIS QUOTATION IS VALID ONLY FOR 30 DAYS/,
  "quotation validity notice is rendered in red bold text",
);
assert.match(
  jobPrint,
  /prepared_by_signature_url_snapshot/,
  "Job Order prepared-by signature is rendered",
);
assert.match(
  jobPrint,
  /SignBox[\s\S]*label="Sales Agent"/,
  "the Job Order labels the anchored account as Sales Agent",
);
assert.match(
  jobPrint,
  /approved_by_signature_url_snapshot/,
  "Job Order approved-by signature is rendered",
);
assert.match(
  jobPrint,
  /jo-meta-grid[\s\S]*margin-top: 0\.12in/,
  "Job Order PDF metadata uses explicit print-safe vertical spacing",
);
assert.match(
  jobPrint,
  /whitespace-nowrap">Job Order No\./,
  "Job Order number label cannot wrap in the PDF capture",
);
assert.match(
  jobPrint,
  /\.jo-form\s*\{[^}]*font-family:\s*Arial/,
  "Job Order source and PDF clone use the same font metrics",
);
assert.match(
  jobPrint,
  /flex min-h-\[0\.13in\] items-center justify-center border-b/,
  "Job Order metadata values are vertically centered above their guide lines",
);
assert.match(
  jobPrint,
  /\.jo-materials thead tr\s*\{[^}]*height:\s*0\.20in/,
  "downloaded Job Order material headings retain a print-safe row height",
);
assert.match(
  jobPrint,
  /\.jo-materials th\s*\{[^}]*vertical-align:\s*middle[^}]*padding:\s*0\.03in 0\.01in/,
  "downloaded Job Order material headings stay centered between their borders",
);
assert.match(
  quotePrint,
  /data\.sales_agent_user_id/,
  "draft quotations use only the explicitly selected Sales Agent",
);
assert.doesNotMatch(
  quotePrint,
  /sales_agent_user_id \?\? user/,
  "the logged-in user is never a signer fallback",
);
assert.doesNotMatch(
  checkPrint,
  /prepared_by_signature|addImage\(signature/i,
  "checks do not render account signatures",
);
assert.doesNotMatch(
  voucherPrint,
  /prepared_by_signature|addImage\(signature/i,
  "check vouchers do not render account signatures",
);
assert.doesNotMatch(
  signatureMigration,
  /lower\(trim\(/,
  "signers are never matched by display name",
);
assert.doesNotMatch(
  signatureMigration,
  /UPDATE public\.quotations quote/,
  "historical quotations are never retroactively signed",
);
assert.match(
  signatureMigration,
  /CREATE TRIGGER trg_snapshot_quotation_sales_agent[\s\S]*BEFORE INSERT OR UPDATE OF sales_agent_user_id/,
  "the selected Sales Agent name and signature are snapshotted on the quotation",
);
assert.match(
  signatureMigration,
  /user-signatures/,
  "signatures use a dedicated private object bucket",
);
assert.match(
  signatureMigration,
  /set_user_signature/,
  "signature metadata and audit updates use one server-side operation",
);
assert.match(
  signatureMigration,
  /p_target_user_id<>auth\.uid\(\) AND NOT app_private\.can_manage_users\(auth\.uid\(\)\)/,
  "self-service and owner-managed updates share one authorization boundary",
);
assert.match(
  signatureMigration,
  /split_part\(p_object_path,'\/',1\)<>p_target_user_id::text/,
  "an uploaded object must remain inside the target user's folder",
);
assert.match(
  signatureMigration,
  /file_size_limit, allowed_mime_types[\s\S]*524288[\s\S]*image\/png[\s\S]*image\/jpeg[\s\S]*image\/webp/,
  "Storage enforces signature size and MIME restrictions server-side",
);
assert.match(
  signatureMigration,
  /UPDATE public\.profiles SET signature_url=p_object_path[\s\S]*INSERT INTO public\.audit_logs/,
  "profile update and audit event are atomic in the same transaction",
);
assert.match(
  hardeningMigration,
  /UPDATE OF[\s\S]*sales_agent_signature_url_snapshot/,
  "quotation snapshot changes always invoke the immutability guard",
);
assert.match(
  hardeningMigration,
  /UPDATE OF[\s\S]*prepared_by_signature_url_snapshot[\s\S]*approved_by_signature_url_snapshot/,
  "Job Order snapshot changes always invoke the immutability guard",
);

const versions = (await readdir(new URL("../supabase/migrations", import.meta.url)))
  .filter((name) => name.endsWith(".sql"))
  .map((name) => name.slice(0, 14));
assert.equal(new Set(versions).size, versions.length, "every migration has a unique version");

console.log("signature print contract passed");
