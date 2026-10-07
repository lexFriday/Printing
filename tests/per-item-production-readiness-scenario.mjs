import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL ?? "http://127.0.0.1:57421", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz");
const suffix = Date.now();
const must = async (q) => { const r = await q; if (r.error) throw r.error; return r.data; };
const customer = await must(db.from("customers").insert({ customer_name: `Readiness Scenario ${suffix}`, contact_person: "Scenario QA", contact_number: "000" }).select("id").single());
const quote = await must(db.from("quotations").insert({ customer_id: customer.id, project_name: `Readiness Scenario ${suffix}`, quote_date: new Date().toISOString().slice(0,10), status: "approved", subtotal: 200, total_amount: 200, tax_type: "non_vat" }).select("id").single());
const lines = await must(db.from("quote_line_items").insert([
  { quotation_id: quote.id, description: "Ready item", pricing_mode: "fixed", quantity: 1, unit_price: 100, line_total: 100, sort_order: 0 },
  { quotation_id: quote.id, description: "Blocked item", pricing_mode: "fixed", quantity: 1, unit_price: 100, line_total: 100, sort_order: 1 },
]).select("id,description"));
const job = await must(db.from("job_orders").insert({ quotation_id: quote.id, customer_id: customer.id, project_name: `Readiness Scenario ${suffix}`, quoted_amount: 200, status: "in_production", tax_type: "non_vat" }).select("id").single());
// Creating the JO snapshots its quote lines through the production workflow trigger.
// Reuse those snapshots rather than inserting duplicate line items.
const joli = await must(db.from("job_order_line_items").select("id,quote_line_item_id,description").eq("job_order_id", job.id).order("sort_order"));
assert.equal(joli.length, 2);
const materials = await must(db.from("materials").select("id,name").in("name", ["Eco-Solvent Ink — CMYK", "Glossy Vinyl"]));
const tarp = materials.find((m) => m.name === "Eco-Solvent Ink — CMYK"); const vinyl = materials.find((m) => m.name === "Glossy Vinyl");
await must(db.from("quote_material_estimates").insert([
  { quotation_id: quote.id, quote_line_item_id: lines[0].id, material_id: tarp.id, material_name: tarp.name, unit: "ml", basis: "per_item", component_quantity: 1, estimated_quantity: 1 },
  { quotation_id: quote.id, quote_line_item_id: lines[1].id, material_id: vinyl.id, material_name: vinyl.name, unit: "sqm", basis: "per_item", component_quantity: 999, estimated_quantity: 999 },
]));
await must(db.from("production_jobs").insert({ job_order_id: job.id, job_type: "general", status: "preparing" }));
// Use the seeded inventory balance. The scenario deliberately avoids writing
// movements because inventory history is append-only/immutable.
const rows = await must(db.rpc("production_item_readiness", { p_job_order_id: job.id }));
const byItem = [...new Map(rows.map((row) => [row.job_order_line_item_id, row])).values()];
assert.equal(byItem.length, 2); const ready = byItem.find((row) => row.description === "Ready item"); const blocked = byItem.find((row) => row.description === "Blocked item"); assert.equal(ready.status, "ready"); assert.equal(blocked.status, "blocked"); assert.equal(blocked.shortage_materials[0].material_name, "Glossy Vinyl");
await must(db.from("job_orders").delete().eq("id", job.id)); await must(db.from("quotations").delete().eq("id", quote.id)); await must(db.from("customers").delete().eq("id", customer.id));
console.log("per-item production readiness scenario: passed");
