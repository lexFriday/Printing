import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:57421";
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";
const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function clientFor(email) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await client.auth.signInWithPassword({ email, password: "password123" });
  if (result.error) throw result.error;
  return client;
}

const owner = await clientFor("owner@local.test");
const staff = await clientFor("staff@local.test");
const materials = await owner.from("materials").select("id").eq("is_active", true).limit(2);
assert.equal(materials.error, null, "local active materials should be available for the demo test");
assert.equal(materials.data.length, 2, "the local demo needs two active materials");

const name = `Phase 5 test template ${Date.now()}`;
const components = materials.data.map((material, index) => ({ material_id: material.id, quantity: index + 1 }));
const revisionKey = `phase5-repeat-${Date.now()}`;
const first = await owner.rpc("save_bom_template_version", {
  p_name: name,
  p_components: components,
  p_idempotency_key: crypto.randomUUID(),
});
assert.equal(first.error, null, "owner should create a BOM template version");
assert.ok(first.data, "owner should receive the created template id");

const repeated = await owner.rpc("save_bom_template_version", {
  p_name: name,
  p_components: components,
  p_idempotency_key: revisionKey,
});
assert.equal(repeated.error, null, "owner should create a second template version");
const retry = await owner.rpc("save_bom_template_version", {
  p_name: name,
  p_components: components,
  p_idempotency_key: revisionKey,
});
assert.equal(retry.error, null, "retry should not fail");
assert.equal(retry.data, repeated.data, "a retry must return the existing version");

const versions = await owner
  .from("bom_templates")
  .select("id,version,is_active,bom_template_components(material_id,quantity)")
  .eq("name", name)
  .order("version");
assert.equal(versions.error, null);
assert.deepEqual(
  versions.data.map((template) => ({ version: template.version, active: template.is_active })),
  [
    { version: 1, active: false },
    { version: 2, active: true },
  ],
  "a revision preserves history and makes only the latest version current",
);
assert.equal(versions.data[1].bom_template_components.length, 2, "the version keeps its material plan");

const staffAttempt = await staff.rpc("save_bom_template_version", {
  p_name: `${name} staff`,
  p_components: components,
  p_idempotency_key: crypto.randomUUID(),
});
assert.notEqual(staffAttempt.error, null, "staff must not manage BOM templates");

const directInsert = await owner.from("bom_templates").insert({ name: `${name} direct`, version: 1 });
assert.notEqual(directInsert.error, null, "templates must use the guarded versioning RPC");

const cleanupTemplates = await service.from("bom_templates").select("id").eq("name", name);
assert.equal(cleanupTemplates.error, null, "test fixtures should be discoverable for cleanup");
const cleanupIds = cleanupTemplates.data.map((template) => template.id);
const cleanupComponents = await service
  .from("bom_template_components")
  .delete()
  .in("bom_template_id", cleanupIds);
assert.equal(cleanupComponents.error, null, "test BOM components should be removable");
const cleanupVersions = await service.from("bom_templates").delete().in("id", cleanupIds);
assert.equal(cleanupVersions.error, null, "test BOM versions should be removable");

console.log("Graphic Wizard Phase 5 RPC checks passed");
