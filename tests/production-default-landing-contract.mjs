import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const roles = readFileSync(new URL("../src/lib/roles.ts", import.meta.url), "utf8");
const auth = readFileSync(new URL("../src/routes/auth.tsx", import.meta.url), "utf8");
const index = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

assert.match(roles, /export function defaultLandingForRole/);
assert.match(roles, /role === "production"\) return "\/production"/);
assert.match(roles, /role === "sales"\) return "\/quotes"/);
assert.match(auth, /import \{ defaultLandingForRole \} from "@\/lib\/roles"/);
assert.doesNotMatch(auth, /role === "production"\) return "\/jobs"/);
assert.match(index, /defaultLandingForRole/);
assert.match(index, /from\("user_roles"\)/);

console.log("production default landing contract: passed");
