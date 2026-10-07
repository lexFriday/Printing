import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../src/routes/_app.settings.bom-templates.tsx", import.meta.url), "utf8");
const strayRoute = readFileSync(new URL("../src/routes/_app.settings.bom-templates 2.tsx", import.meta.url), "utf8");
assert.match(route, /redirect\(\{ to: "\/settings\/item-templates" \}\)/, "legacy BOM route must lead to the Item Template recipe SSOT");
assert.doesNotMatch(route, /save_bom_template_version/, "the legacy route must not expose a second recipe writer");
assert.match(strayRoute, /redirect\(\{ to: "\/settings\/item-templates" \}\)/, "stray legacy BOM route must lead to the Item Template recipe SSOT");
assert.doesNotMatch(strayRoute, /save_bom_template_version/, "the stray route must not expose a second recipe writer");
console.log("Legacy BOM route deprecation contract: passed");
