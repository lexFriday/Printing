import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260831192000_align_production_job_order_contract.sql", import.meta.url),
  "utf8",
);
const productionDocument = readFileSync(
  new URL("../src/routes/_app.production.$jobOrderId.tsx", import.meta.url),
  "utf8",
);
const jobDocument = readFileSync(
  new URL("../src/routes/_app.jobs.$id.tsx", import.meta.url),
  "utf8",
);
const statusGuard = readFileSync(
  new URL("../supabase/migrations/20260831193000_guard_job_ready_after_production.sql", import.meta.url),
  "utf8",
);
const shortageContract = readFileSync(
  new URL("../supabase/migrations/20260831195000_correct_shortage_after_reservation.sql", import.meta.url),
  "utf8",
);
const preparingShortageFix = readFileSync(
  new URL("../supabase/migrations/20260905190000_allow_preparing_shortage_requests.sql", import.meta.url),
  "utf8",
);
const supplementalMaterialFix = readFileSync(
  new URL("../supabase/migrations/20260905200000_supplement_released_job_bom.sql", import.meta.url),
  "utf8",
);
const itemReadinessSsotFix = readFileSync(
  new URL("../supabase/migrations/20260905210000_restore_item_readiness_bom_ssot.sql", import.meta.url),
  "utf8",
);
const followUpShortageFix = readFileSync(
  new URL("../supabase/migrations/20260905220000_follow_up_shortage_requests.sql", import.meta.url),
  "utf8",
);

assert.match(migration, /v_job\.status::TEXT <> 'pending'/);
assert.doesNotMatch(migration, /v_job\.status::TEXT <> 'open'/);
assert.match(migration, /owner or admin plan creation required/);
assert.match(productionDocument, /Release material plan/);
assert.match(productionDocument, /release\.mutate\(\)/);
assert.match(productionDocument, /Use project materials/);
assert.match(statusGuard, /production must be completed before the Job Order can be marked ready/);
assert.match(jobDocument, /job\.status === "pending" \|\| job\.status === "in_production"/);
assert.match(shortageContract, /v_shortage := GREATEST\(0, v_planned - v_reserved - v_available\)/);
assert.match(shortageContract, /v_requested := CEIL\(v_shortage \/ v_pack\) \* v_pack/);
assert.match(preparingShortageFix, /status IN \('preparing', 'partially_reserved', 'ready_to_start', 'in_progress'\)/);
assert.match(supplementalMaterialFix, /ADD COLUMN IF NOT EXISTS is_supplemental BOOLEAN NOT NULL DEFAULT FALSE/);
assert.match(supplementalMaterialFix, /production\.status IN \('preparing','partially_reserved','ready_to_start','in_progress'\)/);
assert.match(supplementalMaterialFix, /INSERT INTO public\.job_bom_items\(job_bom_id,job_order_line_item_id,material_id,planned_quantity,unit,is_supplemental,added_after_release_by/);
assert.match(productionDocument, /invalidateQueries\(\{ queryKey: \["inventory-material-summary"\] \}\)/);
assert.match(productionDocument, /disabled=\{movement\.isPending\}[\s\S]{0,100}Reserve \{reservable\}/);
assert.doesNotMatch(productionDocument, /readinessByItem\.get\(item\.id\)/);
assert.match(productionDocument, /readinessByMaterial\.get\(item\.material_id\)/);
assert.match(productionDocument, /const purchasingShortageItems = displayItems\.filter/);
assert.match(productionDocument, /Materials for this item/);
assert.match(productionDocument, /Reserve \{reservableQuantity\} \{material\.unit\}/);
assert.match(productionDocument, /Request .* from Purchasing/);
assert.match(productionDocument, /hasPurchasingShortage\s+\? "Purchasing \/ Operations"\s+: "Operations"/);
assert.match(itemReadinessSsotFix, /JOIN public\.job_bom_items/);
assert.doesNotMatch(itemReadinessSsotFix, /quote_material_estimates/);
assert.match(productionDocument, /const remainingForMaterial = Math\.max\([\s\S]{0,120}Number\(item\.planned_quantity\) - reservedQuantity,[\s\S]{0,40}\)/);
assert.match(productionDocument, /const hasTrueShortage = availableQuantity < remainingForMaterial/);
assert.match(followUpShortageFix, /status IN \('requested', 'ordered', 'partially_received'\)/);
assert.doesNotMatch(followUpShortageFix, /status::TEXT <> 'cancelled'/);
assert.match(productionDocument, /\.in\("status", \["requested", "ordered", "partially_received"\]\)/);
assert.doesNotMatch(productionDocument, /window\.prompt\("Why is this task on hold\?"\)/);
assert.match(productionDocument, /setHoldReason\(""\);\s+setHoldTask\(\{ id: task\.id, label: task\.task_type \}\)/);
assert.match(productionDocument, /<DialogTitle>Put task on hold<\/DialogTitle>/);

console.log("operations production contract: passed");
