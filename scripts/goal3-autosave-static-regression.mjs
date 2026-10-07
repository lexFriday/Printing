import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const helper = readFileSync("src/lib/quoteDraftRecovery.ts", "utf8");
const editRoute = readFileSync("src/routes/_app.quotes.$id.edit.tsx", "utf8");
const newRoute = readFileSync("src/routes/_app.quotes.new.tsx", "utf8");

assert.match(helper, /export function buildQuoteDraftKey/);
assert.match(helper, /export function isQuoteDraftValidForSystemSave/);
assert.match(helper, /export function loadQuoteDraft/);
assert.match(helper, /export function saveQuoteDraft/);
assert.match(helper, /export function clearQuoteDraft/);
assert.match(helper, /localStorage/);
assert.match(helper, /quoteTotal <= 0/);

assert.match(editRoute, /AUTO_SAVE_DELAY_MS\s*=\s*5000/);
assert.match(editRoute, /Saved locally/);
assert.match(editRoute, /This quote was updated by someone else\. Reload before continuing\./);
assert.match(editRoute, /document\.visibilityState === "hidden"/);
assert.match(editRoute, /window\.addEventListener\("blur"/);
assert.match(editRoute, /\.eq\("updated_at", loadedUpdatedAt/);
assert.match(editRoute, /quote\.data\.status !== "draft"/);

assert.match(newRoute, /Saved locally/);
assert.match(newRoute, /Recovered draft/);
assert.match(newRoute, /clearQuoteDraft/);

console.log("Goal 3 autosave static regression passed.");
