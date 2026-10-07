import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/routes/_app.settings.item-templates.tsx", import.meta.url), "utf8");

assert.match(page, /Materials \/ BOM/);
assert.match(page, /item_template_materials/);
assert.match(page, /item_template_id/);
assert.match(page, /Save materials/);
assert.match(page, /Only an owner or admin can manage template materials/);
assert.match(page, /\.eq\("active", true\)/, "The editor must load only the current recipe rows");
assert.match(page, /p_idempotency_key: value\.idempotencyKey/, "A retry must reuse the draft's save key");
assert.match(page, />Material<\/div>/);
assert.match(page, />Quantity<\/div>/);
assert.match(page, />Basis<\/div>/);
assert.match(page, />Per item<\/SelectItem>/, "Basis labels should fit without truncation");
assert.match(page, />Per line<\/SelectItem>/, "Fixed usage should have a concise label");
assert.match(page, /id="basis-guidance"/, "Basis guidance should be explained once");
assert.match(page, /aria-describedby="basis-guidance"/, "Basis controls should reference the shared guidance");
assert.doesNotMatch(page, /function basisHelp/, "Basis guidance should not repeat below every row");
assert.match(page, /role="alert"/, "Invalid material rows need inline accessible errors");
assert.match(page, /Discard unsaved recipe changes\?/);
assert.match(
  page,
  /DialogContent className="flex max-h-\[calc\(100dvh-2rem\)\] flex-col overflow-hidden sm:max-w-4xl"/,
  "The BOM dialog should stay inside the viewport",
);
assert.match(
  page,
  /className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-2" tabIndex=\{0\} aria-label="Template materials"/,
  "The material rows should have their own keyboard-focusable scroll region",
);
assert.match(
  page,
  /sm:grid-cols-\[minmax\(0,1fr\)_8rem_9rem_5\.5rem\]/,
  "Long material names must not push quantity, basis, or remove controls outside the dialog",
);
assert.match(
  page,
  /<DialogFooter className="shrink-0 border-t pt-4">/,
  "The save actions should stay outside the scrolling material list",
);

console.log("Item Template materials contract: passed");
