import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../drizzle/migrations/0000_pending_signup_approval.sql", import.meta.url), "utf8");

// Rule: only the very first account becomes an active owner; everyone else waits inactive with no role.
assert.match(sql, /CASE WHEN is_first_user THEN 'active'::public\.user_status ELSE 'inactive'::public\.user_status END/);
assert.match(sql, /IF is_first_user THEN\s+INSERT INTO public\.user_roles[\s\S]*'owner'::public\.app_role/);
assert.equal((sql.match(/INSERT INTO public\.user_roles/g) ?? []).length, 1, "non-first signups must not receive a role");

// Rule: the signup trigger must not read managed auth tables (breaks signup with "permission denied for schema auth").
assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /auth\.users/);
assert.match(sql, /pg_advisory_xact_lock/);

console.log("pending signup approval contract passed");
