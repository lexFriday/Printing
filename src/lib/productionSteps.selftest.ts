import assert from "node:assert/strict";
import { normalizeProductionSteps, sortProductionGroupsByItemOrder } from "./productionSteps.ts";

const productionCards = [
  { itemId: "second", item: { sort_order: 2 }, state: "ready" },
  { itemId: "first", item: { sort_order: 1 }, state: "blocked" },
];

assert.deepEqual(
  sortProductionGroupsByItemOrder(productionCards).map((card) => card.itemId),
  ["first", "second"],
  "production cards should follow Job Order item order instead of status",
);

productionCards[0].state = "in_progress";
productionCards[1].state = "complete";

assert.deepEqual(
  sortProductionGroupsByItemOrder(productionCards).map((card) => card.itemId),
  ["first", "second"],
  "changing production state must not move a product card",
);

assert.deepEqual(
  normalizeProductionSteps([" Artwork approval ", "Printing", "Quality check"]),
  ["Artwork approval", "Printing", "Quality check"],
  "step names should be trimmed while preserving their order",
);

assert.throws(
  () => normalizeProductionSteps([]),
  /at least one production step/i,
  "a custom production plan must keep at least one step",
);

assert.throws(
  () => normalizeProductionSteps(["Printing", " printing "]),
  /different name/i,
  "duplicate step names should be rejected case-insensitively",
);

assert.throws(
  () => normalizeProductionSteps(["Artwork", ""]),
  /name every production step/i,
  "blank steps should not be saved",
);

assert.throws(
  () => normalizeProductionSteps(Array.from({ length: 13 }, (_, index) => `Step ${index + 1}`)),
  /up to 12 production steps/i,
  "custom plans should have a clear operational limit",
);

console.log("production step validation self-test passed");
