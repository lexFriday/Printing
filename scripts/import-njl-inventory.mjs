import { createClient } from "@supabase/supabase-js";

// NJL opening inventory import. This is additive and idempotent: it never deletes
// or rewrites existing movements, so historical client records remain intact.
const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:57421";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const rows = [
  ["TOP WHITE CARBONLESS", 5, "reams", "CDR PRINTING SUPPLY"],
  ["MIDDLE BLUE CARBONLESS", 5, "reams", "CDR PRINTING SUPPLY"],
  ["MIDDLE PINK CARBONLESS", 5, "reams", "CDR PRINTING SUPPLY"],
  ["IK COPY 8.5x11", 3, "reams", "CDR PRINTING SUPPLY"],
  ["BOOK 60 12.5x19", 100, "pcs", "CDR PRINTING SUPPLY"],
  ["C2S80", 100, "pcs", "CDR PRINTING SUPPLY"],
  ["C2S120", 50, "pcs", "CDR PRINTING SUPPLY"],
  ["TARPAULIN C12STAR (3.3'x164')", 3, "rolls", "ARTMART SIGNAGE MATERIALS TRADING"],
  ["TARPAULIN C12STAR (4.5'x164')", 3, "rolls", "ARTMART SIGNAGE MATERIALS TRADING"],
  ["TARPAULIN C12STAR (6'x164')", 1, "rolls", "ARTMART SIGNAGE MATERIALS TRADING"],
  ["TARPAULIN C12STAR (10.5'x164')", 2, "rolls", "ARTMART SIGNAGE MATERIALS TRADING"],
];

const fail = (label, result) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};

const owner = fail("list users", await admin.auth.admin.listUsers()).users.find((u) => u.email === "owner@local.test");
if (!owner) throw new Error("No owner account found; run this after NJL owner provisioning.");

for (const [name, quantity, unit, supplierName] of rows) {
  const foundMaterial = fail("find material", await admin.from("materials").select("id").ilike("name", name).maybeSingle());
  const material = foundMaterial ?? fail("insert material", await admin.from("materials").insert({ name, unit, category: "NJL opening inventory" }).select("id").single());
  const foundSupplier = fail("find supplier", await admin.from("suppliers").select("id,name").eq("name", supplierName).maybeSingle());
  const supplier = foundSupplier ?? fail("insert supplier", await admin.from("suppliers").insert({ name: supplierName }).select("id,name").single());
  const key = `njl-opening-${material.id}`;
  const existing = fail("check opening receipt", await admin.from("inventory_movements").select("id").eq("idempotency_key", key).maybeSingle());
  if (!existing) fail("record opening receipt", await admin.from("inventory_movements").insert({ material_id: material.id, movement_type: "receipt", quantity, idempotency_key: key, notes: `NJL opening stock; supplier: ${supplierName}`, created_by: owner.id }));
  console.log(`${name}: ${quantity} ${unit} (${supplier.name})`);
}

console.log(`Imported ${rows.length} NJL materials without modifying historical movements.`);
