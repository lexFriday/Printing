import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(
  new URL("../src/routes/_app.settings.item-templates.tsx", import.meta.url),
  "utf8",
);

assert.match(
  page,
  /max-h-\[60vh\] overflow-y-auto rounded-md border[^>]*tabIndex=\{0\}[^>]*aria-label="Item templates list"/,
  "Item Templates should scroll inside a keyboard-focusable list region",
);
assert.match(
  page,
  /<TableHeader className="sticky top-0 z-10 bg-background">/,
  "The Item Templates header should remain visible while rows scroll",
);

console.log("item templates inner scroll contract passed");
