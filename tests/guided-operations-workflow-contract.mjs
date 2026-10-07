import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [roles, sidebar, productionQueue, purchaseDetail, inventoryDetail, templates] =
  await Promise.all([
    read("src/lib/roles.ts"),
    read("src/components/AppSidebar.tsx"),
    read("src/routes/_app.production.index.tsx"),
    read("src/routes/_app.purchasing.$requestId.tsx"),
    read("src/routes/_app.inventory.$materialId.tsx"),
    read("src/routes/_app.settings.item-templates.tsx"),
  ]);

for (const helper of [
  "canOperateInventory",
  "canOperatePurchasing",
  "canManageOperationalSettings",
  "canApproveOperationalException",
]) {
  assert.match(roles, new RegExp(`export function ${helper}\\(`), `${helper} is centralized`);
}

assert.match(sidebar, /canOperateInventory\(role\)/, "inventory navigation follows operations permission");
assert.match(sidebar, /canOperatePurchasing\(role\)/, "purchasing navigation follows operations permission");
assert.match(productionQueue, /to="\/jobs\/\$id"/, "production queue opens the Job Order workspace");
assert.doesNotMatch(productionQueue, /to="\/production\/\$jobOrderId"/, "production queue has no duplicate detail path");
assert.match(purchaseDetail, /canOperatePurchasing\(role\)/, "purchase actions are role-aware");
assert.match(purchaseDetail, /canApproveOperationalException\(role\)/, "purchase cancellation is manager-controlled");
assert.match(inventoryDetail, /canOperateInventory\(role\)/, "inventory actions are role-aware");
assert.match(inventoryDetail, /canApproveOperationalException\(role\)/, "inventory corrections are manager-controlled");
assert.match(templates, /Materials \/ BOM/, "BOM remains inside Item Templates");

console.log("guided operations workflow contract passed");
