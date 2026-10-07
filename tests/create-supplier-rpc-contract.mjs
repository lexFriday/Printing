import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const route = readFileSync(
  new URL("../src/routes/_app.purchasing.index.tsx", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../supabase/migrations/20260910172000_create_supplier_rpc.sql", import.meta.url),
  "utf8",
);

assert.match(route, /rpc as any\)\("create_supplier"/);
assert.doesNotMatch(route, /from\("suppliers" as never\)[\s\S]{0,100}\.insert\(/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_supplier/i);
assert.match(migration, /has_role\(auth\.uid\(\), 'owner'\)/i);
assert.match(migration, /has_role\(auth\.uid\(\), 'admin'\)/i);
assert.match(migration, /has_role\(auth\.uid\(\), 'staff'\)/i);
assert.match(migration, /INSERT INTO public\.audit_logs/i);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_supplier/i);

console.log("create supplier RPC contract: passed");
