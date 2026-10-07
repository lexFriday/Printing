import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260904110000_unified_production_readiness.sql", import.meta.url), "utf8");

assert.match(migration, /production_material_readiness/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public.production_queue/);
assert.match(migration, /FROM public\.production_material_readiness/);
console.log("Readiness source contract: passed");
