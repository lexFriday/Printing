import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20260910130000_import_materials_with_opening_stock.sql",
    import.meta.url,
  ),
  "utf8",
);
const component = readFileSync(
  new URL("../src/components/MaterialImportDialog.tsx", import.meta.url),
  "utf8",
);

assert.match(sql, /CREATE OR REPLACE FUNCTION public\.import_materials_with_opening_stock/);
assert.match(sql, /public\.has_role\(auth\.uid\(\), 'owner'\)/);
assert.match(sql, /public\.has_role\(auth\.uid\(\), 'admin'\)/);
assert.match(sql, /INSERT INTO public\.materials/);
assert.match(sql, /INSERT INTO public\.inventory_movements/);
assert.match(sql, /'receipt'/);
assert.match(sql, /starting_quantity < 0/);
assert.match(sql, /starting_quantity > 0/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.import_materials_with_opening_stock/);
assert.match(component, /"import_materials_with_opening_stock"/);
assert.doesNotMatch(component, /supabase\.from\("materials"\).*\.insert/s);

console.log("Material import opening-stock contract: passed");
