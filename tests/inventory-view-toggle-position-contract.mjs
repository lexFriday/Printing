import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const inventoryPage = readFileSync(
  new URL("../src/routes/_app.inventory.tsx", import.meta.url),
  "utf8",
);
const templatesPage = readFileSync(
  new URL("../src/routes/_app.settings.item-templates.tsx", import.meta.url),
  "utf8",
);

assert.match(inventoryPage, /<ItemTemplatesPage navigation=\{viewToggle\} \/>/);

const headerPosition = templatesPage.indexOf("<PageHeader");
const navigationPosition = templatesPage.indexOf("{navigation}");

assert.ok(headerPosition >= 0, "Item Templates must render its page header");
assert.ok(
  navigationPosition > headerPosition,
  "The Inventory / Item Templates toggle must appear below the Item Templates header",
);

console.log("Inventory view toggle position contract: passed");
