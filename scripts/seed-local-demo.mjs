import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:59421";
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function must(request, label) {
  const result = await request;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const users = (await must(admin.auth.admin.listUsers(), "list users")).users;
let owner = users.find((user) => user.email === "owner@local.test");
if (!owner) {
  owner = (await must(
    admin.auth.admin.createUser({
      email: "owner@local.test",
      password: "password123",
      email_confirm: true,
      user_metadata: { display_name: "Local Owner" },
    }),
    "create local demo owner",
  )).user;
} else {
  await must(
    admin.auth.admin.updateUserById(owner.id, {
      password: "password123",
      email_confirm: true,
      user_metadata: { display_name: "Local Owner" },
    }),
    "reset local demo owner login",
  );
}
await must(
  admin.from("profiles").upsert({
    id: owner.id,
    email: "owner@local.test",
    display_name: "Local Owner",
    status: "active",
    signature_url: "https://local.invalid/demo-owner-signature",
  }),
  "set local demo owner signature",
);
await must(
  admin.from("user_roles").upsert({ user_id: owner.id, role: "owner" }, { onConflict: "user_id" }),
  "assign local demo owner role",
);

async function ensureByName(table, rows, key) {
  const result = [];
  for (const row of rows) {
    const existing = await must(admin.from(table).select("*").eq(key, row[key]).maybeSingle(), `find ${table}`);
    result.push(existing ?? (await must(admin.from(table).insert(row).select("*").single(), `insert ${table}`)));
  }
  return result;
}

const materials = await ensureByName("materials", [
  { name: "13oz Tarpaulin", unit: "sqm", category: "substrate", reorder_threshold: 20 },
  { name: "Glossy Vinyl", unit: "sqm", category: "substrate", reorder_threshold: 15 },
  { name: "Eco-Solvent Ink — CMYK", unit: "ml", category: "ink", reorder_threshold: 500 },
  { name: "Eyelets", unit: "pcs", category: "hardware", reorder_threshold: 100 },
], "name");

const suppliers = await ensureByName("suppliers", [
  { name: "Metro Print Supply", tin_number: "123-456-789-000", address: "123 Maginhawa St., Quezon City", contact_person: "Ana Reyes", phone: "0917 555 0142", payment_terms: "30 days", active: true },
  { name: "ColorHouse Trading", contact_person: "Marco Lim", phone: "0918 555 0198", active: true },
], "name");

// Keep the existing demo row complete when the seed script is run against a database
// that already contains the supplier.
await must(admin.from("suppliers").update({
  tin_number: "123-456-789-000",
  address: "123 Maginhawa St., Quezon City",
  payment_terms: "30 days",
}).eq("name", "Metro Print Supply"), "update Metro Print Supply demo details");

const material = Object.fromEntries(materials.map((row) => [row.name, row]));
const supplier = Object.fromEntries(suppliers.map((row) => [row.name, row]));

const customers = await ensureByName("customers", [
  { customer_name: "Harborview Café", contact_person: "Mia Santos", contact_number: "0917 111 2233" },
  { customer_name: "Northstar Events", contact_person: "Paolo Cruz", contact_number: "0918 222 3344" },
  { customer_name: "Brightline Realty", contact_person: "Jade Tan", contact_number: "0919 333 4455" },
], "customer_name");

const customer = Object.fromEntries(customers.map((row) => [row.customer_name, row]));
const existingQuote = await must(admin.from("quotations").select("id").eq("project_name", "Harborview Grand Opening").maybeSingle(), "find quote");
const quote = existingQuote ? [existingQuote] : [await must(
  admin.from("quotations").insert({
        customer_id: customer["Harborview Café"].id,
        project_name: "Harborview Grand Opening",
        quote_date: new Date().toISOString().slice(0, 10),
        status: "approved",
        subtotal: 18500,
        total_amount: 18500,
        tax_type: "non_vat",
        sales_agent: owner.email ?? "Demo Sales Agent",
        sales_agent_user_id: owner.id,
        created_by: owner.id,
      }).select("id").single(), "seed quote")];

const quoteId = quote[0].id;
const existingLine = await must(admin.from("quote_line_items").select("id").eq("quotation_id", quoteId).eq("description", "Outdoor tarpaulin banners").maybeSingle(), "find quote line");
const line = existingLine ? [existingLine] : [await must(
  admin.from("quote_line_items").insert({
        quotation_id: quoteId,
        description: "Outdoor tarpaulin banners",
        pricing_mode: "fixed",
        quantity: 1,
        unit_price: 18500,
        line_total: 18500,
        sort_order: 0,
      }).select("id").single(), "seed quote line")];

const existingJob = await must(admin.from("job_orders").select("id").eq("quotation_id", quoteId).maybeSingle(), "find job");
const job = existingJob ? [existingJob] : [await must(
  admin.from("job_orders").insert({
        quotation_id: quoteId,
        customer_id: customer["Harborview Café"].id,
        project_name: "Harborview Grand Opening",
        quoted_amount: 18500,
        target_completion_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        status: "in_production",
        prepared_by_user_id: owner.id,
        approved_by_user_id: owner.id,
        prepared_by_name_snapshot: owner.email ?? "Demo Owner",
        approved_by_name: owner.email ?? "Demo Owner",
      }).select("id").single(), "seed job order")];

const jobId = job[0].id;
const existingBomTemplate = await must(
  admin.from("bom_templates").select("*").eq("name", "Outdoor Banner Demo Recipe").eq("version", 1).maybeSingle(),
  "find demo BOM",
);
const bomTemplate = existingBomTemplate ?? (await must(
  admin.from("bom_templates").insert({ name: "Outdoor Banner Demo Recipe", version: 1, is_active: true }).select("*").single(),
  "seed demo BOM",
));
for (const component of [
  { bom_template_id: bomTemplate.id, material_id: material["13oz Tarpaulin"].id, quantity: 32 },
  { bom_template_id: bomTemplate.id, material_id: material["Glossy Vinyl"].id, quantity: 24 },
]) {
  const existingComponent = await must(
    admin.from("bom_template_components").select("id").eq("bom_template_id", component.bom_template_id).eq("material_id", component.material_id).maybeSingle(),
    "find demo BOM component",
  );
  if (!existingComponent) await must(admin.from("bom_template_components").insert(component), "seed demo BOM component");
}
const existingJobBom = await must(admin.from("job_boms").select("id").eq("job_order_id", jobId).maybeSingle(), "find job BOM");
if (!existingJobBom) {
  const jobLine = await must(admin.from("job_order_line_items").select("id").eq("job_order_id", jobId).limit(1).single(), "find job BOM line");
  const jobBom = await must(admin.from("job_boms").insert({ job_order_id: jobId, bom_template_id: bomTemplate.id, template_version: 1, released_at: new Date().toISOString(), released_by: owner.id }).select("id").single(), "seed job BOM");
  await must(admin.from("job_bom_items").insert([
    { job_bom_id: jobBom.id, job_order_line_item_id: jobLine.id, material_id: material["13oz Tarpaulin"].id, planned_quantity: 32, unit: "sqm" },
    { job_bom_id: jobBom.id, job_order_line_item_id: jobLine.id, material_id: material["Glossy Vinyl"].id, planned_quantity: 24, unit: "sqm" },
  ]), "seed job BOM items");
}
await must(admin.from("production_jobs").upsert({ job_order_id: jobId, status: "partially_reserved", job_type: "banner", responsible_user_id: owner.id }), "seed production plan");
const demoMovements = [
  { material_id: material["13oz Tarpaulin"].id, movement_type: "receipt", quantity: 48, idempotency_key: "local-demo-tarpaulin-receipt", created_by: owner.id },
  { material_id: material["13oz Tarpaulin"].id, movement_type: "reservation", quantity: 32, job_order_id: jobId, idempotency_key: "local-demo-tarpaulin-reservation", created_by: owner.id },
  { material_id: material["Glossy Vinyl"].id, movement_type: "receipt", quantity: 8, idempotency_key: "local-demo-vinyl-receipt", created_by: owner.id },
  { material_id: material["Eco-Solvent Ink — CMYK"].id, movement_type: "receipt", quantity: 350, idempotency_key: "local-demo-ink-receipt", created_by: owner.id },
];
for (const movement of demoMovements) {
  const existingMovement = await must(
    admin.from("inventory_movements").select("id").eq("idempotency_key", movement.idempotency_key).maybeSingle(),
    "find inventory movement",
  );
  if (!existingMovement) await must(admin.from("inventory_movements").insert(movement), "seed inventory movement");
}

const existingPurchase = await must(admin.from("purchase_requests").select("id").eq("job_order_id", jobId).eq("material_id", material["Glossy Vinyl"].id).maybeSingle(), "find purchase request");
if (!existingPurchase) await must(
  admin.from("purchase_requests").insert(
    {
      material_id: material["Glossy Vinyl"].id,
      job_order_id: jobId,
      requested_quantity: 24,
      received_quantity: 0,
      status: "requested",
      supplier_id: supplier["Metro Print Supply"].id,
      supplier_name: "Metro Print Supply",
      requested_by: owner.id,
    }), "seed purchase request");

// Demo item-template recipes: reusable material plans shown to staff only.
const itemTemplates = await must(admin.from("item_templates").select("id,name").in("name", ["A4 Detailer", "A4 Menu Board", "Tarpaulin Banner", "Sticker", "Backdrop", "Sintra Board"]), "find item templates");
const recipeByName = {
  "A4 Detailer": [[material["Glossy Vinyl"].id, 1, "per_item"], [material["Eco-Solvent Ink — CMYK"].id, 4, "per_item"]],
  "A4 Menu Board": [[material["Sintra Board"]?.id ?? material["Glossy Vinyl"].id, 1, "per_item"], [material["Eco-Solvent Ink — CMYK"].id, 4, "per_item"]],
  "Tarpaulin Banner": [[material["13oz Tarpaulin"].id, 12, "per_item"], [material["Eco-Solvent Ink — CMYK"].id, 8, "per_item"]],
  Sticker: [[material["Glossy Vinyl"].id, 1, "per_sqft"], [material["Eco-Solvent Ink — CMYK"].id, 4, "per_item"]],
  Backdrop: [[material["13oz Tarpaulin"].id, 180, "per_sqft"]],
  "Sintra Board": [[material["Glossy Vinyl"].id, 1, "per_item"]],
};
for (const item of itemTemplates ?? []) {
  for (const [materialId, quantity, basis] of recipeByName[item.name] ?? []) {
    const exists = await must(admin.from("item_template_materials").select("id").eq("item_template_id", item.id).eq("material_id", materialId).maybeSingle(), "find item recipe");
    if (!exists) await must(admin.from("item_template_materials").insert({ item_template_id: item.id, material_id: materialId, quantity, basis }), "seed item recipe");
  }
}

// Link the demo project to its Item Template, then freeze the recipe into the approved quote snapshot.
const bannerTemplate = (itemTemplates ?? []).find((item) => item.name === "Tarpaulin Banner");
if (bannerTemplate) {
  await must(admin.from("quote_line_items").update({ item_template_id: bannerTemplate.id, item_template_version: 1 }).eq("id", line[0].id), "link demo item template");
  await must(admin.from("quote_material_estimates").delete().eq("quotation_id", quoteId), "clear demo quote snapshot");
  await must(admin.from("quote_material_estimates").insert([
    { quotation_id: quoteId, quote_line_item_id: line[0].id, item_template_id: bannerTemplate.id, item_template_version: 1, material_id: material["13oz Tarpaulin"].id, material_name: "13oz Tarpaulin", unit: "sqm", basis: "per_item", component_quantity: 12, estimated_quantity: 12 },
    { quotation_id: quoteId, quote_line_item_id: line[0].id, item_template_id: bannerTemplate.id, item_template_version: 1, material_id: material["Eco-Solvent Ink — CMYK"].id, material_name: "Eco-Solvent Ink — CMYK", unit: "ml", basis: "per_item", component_quantity: 8, estimated_quantity: 8 },
  ]), "seed demo quote snapshot");
}

console.log("Local demo data is ready.");
