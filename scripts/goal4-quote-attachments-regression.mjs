import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split("=").map((part) => part.replace(/^"|"$/g, ""))),
);

const supabaseUrl = env.SUPABASE_URL;
const anonKey = env.SUPABASE_PUBLISHABLE_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = "quote-attachments";

function client(key = anonKey) {
  return createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function failStep(step, error) {
  throw new Error(`${step}: ${error.message}`);
}

async function signIn(email) {
  const supabase = client();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: "password123",
  });
  if (error) throw error;
  if (!data.user) throw new Error(`No user returned for ${email}`);
  return { supabase, userId: data.user.id };
}

async function cleanup(admin, ids) {
  if (ids.storagePath) {
    await admin.storage.from(bucket).remove([ids.storagePath]);
  }
  if (ids.attachmentId) {
    await admin.from("quote_attachments").delete().eq("id", ids.attachmentId);
  }
  if (ids.quoteId) {
    await admin.from("quotations").delete().eq("id", ids.quoteId);
  }
  if (ids.customerId) {
    await admin.from("customers").delete().eq("id", ids.customerId);
  }
}

const admin = client(serviceKey);
const ids = {};

try {
  const ownerSession = await signIn("owner@local.test");
  const salesSession = await signIn("sales@local.test");
  const viewerSession = await signIn("viewer@local.test");
  const owner = ownerSession.supabase;
  const sales = salesSession.supabase;
  const viewer = viewerSession.supabase;

  const { data: customer, error: customerError } = await owner
    .from("customers")
    .insert({
      customer_name: `Goal 4 Customer ${Date.now()}`,
      contact_person: "QA",
      contact_number: "000",
      address: "QA",
    })
    .select("id")
    .single();
  if (customerError) throw customerError;
  ids.customerId = customer.id;

  const { data: quote, error: quoteError } = await owner
    .from("quotations")
    .insert({
      customer_id: customer.id,
      project_name: `Goal 4 Quote ${Date.now()}`,
      quote_date: new Date().toISOString().slice(0, 10),
      tax_type: "non_vat",
      status: "draft",
    })
    .select("id")
    .single();
  if (quoteError) throw quoteError;
  ids.quoteId = quote.id;

  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  );
  ids.storagePath = `${quote.id}/goal4-${Date.now()}.png`;
  const { error: uploadError } = await sales.storage
    .from(bucket)
    .upload(ids.storagePath, bytes, { contentType: "image/png", upsert: false });
  if (uploadError) throw uploadError;

  const { data: attachment, error: attachmentError } = await sales
    .from("quote_attachments")
    .insert({
      quotation_id: quote.id,
      storage_path: ids.storagePath,
      file_name: "goal4.png",
      file_type: "image/png",
      file_size: bytes.length,
      uploaded_by: salesSession.userId,
    })
    .select("id")
    .single();
  if (attachmentError) failStep("insert attachment metadata", attachmentError);
  ids.attachmentId = attachment.id;

  const { data: visibleToSales, error: salesReadError } = await sales
    .from("quote_attachments")
    .select("id, storage_path")
    .eq("quotation_id", quote.id)
    .is("deleted_at", null);
  if (salesReadError) failStep("read attachment as sales", salesReadError);
  assert.equal(visibleToSales.length, 1, "Sales should see internal quote attachment metadata.");

  const { data: signed, error: signedError } = await sales.storage
    .from(bucket)
    .createSignedUrl(ids.storagePath, 60);
  if (signedError) failStep("create signed URL as sales", signedError);
  assert.ok(
    signed.signedUrl.includes("token="),
    "Signed URL should be generated for storage path.",
  );

  const { data: visibleToViewer, error: viewerReadError } = await viewer
    .from("quote_attachments")
    .select("id")
    .eq("quotation_id", quote.id);
  if (viewerReadError) failStep("read attachment as viewer", viewerReadError);
  assert.equal(visibleToViewer.length, 0, "Viewer must not see internal quote attachments.");

  const { error: invalidTypeError } = await sales.from("quote_attachments").insert({
    quotation_id: quote.id,
    storage_path: `${quote.id}/bad.txt`,
    file_name: "bad.txt",
    file_type: "text/plain",
    file_size: 12,
    uploaded_by: salesSession.userId,
  });
  assert.ok(invalidTypeError, "Invalid attachment file type should be rejected.");

  const { error: deleteError } = await owner
    .from("quote_attachments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", attachment.id);
  if (deleteError) failStep("soft delete attachment as owner", deleteError);

  const { data: afterDelete, error: afterDeleteError } = await sales
    .from("quote_attachments")
    .select("id")
    .eq("quotation_id", quote.id)
    .is("deleted_at", null);
  if (afterDeleteError) failStep("read after soft delete", afterDeleteError);
  assert.equal(afterDelete.length, 0, "Soft-deleted attachment should not appear.");

  console.log("Goal 4 quote attachments Supabase regression passed.");
} finally {
  await cleanup(admin, ids);
}
