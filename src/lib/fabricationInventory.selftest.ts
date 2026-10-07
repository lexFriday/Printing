import { strict as assert } from "node:assert";
import {
  availableStock,
  groupOpenPurchaseRequestsBySupplier,
  groupPurchaseRequestsByJobOrder,
  purchaseQuantity,
  materialVariance,
  summarizeMaterialReadiness,
  purchaseRequestNextAction,
} from "./fabricationInventory.ts";

assert.equal(availableStock({ onHand: 100, reserved: 30 }), 70);
assert.equal(purchaseQuantity(13, 5), 15);
assert.deepEqual(materialVariance(10, 12), {
  planned: 10,
  actual: 12,
  variance: 2,
  status: "over",
});
assert.deepEqual(materialVariance(10, 8), {
  planned: 10,
  actual: 8,
  variance: -2,
  status: "under",
});
assert.deepEqual(
  summarizeMaterialReadiness([
    { plannedQuantity: 12, reservedQuantity: 12 },
    { plannedQuantity: 8, reservedQuantity: 4 },
  ]),
  { isReady: false, shortageCount: 1, totalShortage: 4 },
);
assert.deepEqual(
  groupPurchaseRequestsByJobOrder([
    { id: "a", jobOrderId: "jo-2", jobNumber: "JO-002", projectName: "Lobby" },
    { id: "b", jobOrderId: null, jobNumber: null, projectName: null },
    { id: "c", jobOrderId: "jo-2", jobNumber: "JO-002", projectName: "Lobby" },
    { id: "d", jobOrderId: "jo-1", jobNumber: "JO-001", projectName: "Facade" },
  ]),
  [
    { jobOrderId: "jo-1", jobNumber: "JO-001", projectName: "Facade", requestIds: ["d"] },
    { jobOrderId: "jo-2", jobNumber: "JO-002", projectName: "Lobby", requestIds: ["a", "c"] },
  ],
);
assert.deepEqual(
  summarizeMaterialReadiness([
    { plannedQuantity: 12, reservedQuantity: 12 },
    { plannedQuantity: 8, reservedQuantity: 8 },
  ]),
  { isReady: true, shortageCount: 0, totalShortage: 0 },
);
assert.deepEqual(
  groupOpenPurchaseRequestsBySupplier([
    { id: "a", supplierName: "Ink Depot", status: "requested", remainingQuantity: 2 },
    { id: "b", supplierName: "Ink Depot", status: "partially_received", remainingQuantity: 3 },
    { id: "c", supplierName: null, status: "requested", remainingQuantity: 1 },
    { id: "d", supplierName: "Ink Depot", status: "received", remainingQuantity: 0 },
  ]),
  [
    { supplierName: "Ink Depot", requestIds: ["a", "b"] },
    { supplierName: "Supplier not set", requestIds: ["c"] },
  ],
);
assert.equal(purchaseRequestNextAction("requested", null), "Choose supplier");
assert.equal(purchaseRequestNextAction("requested", "Metro Print Supply"), "Mark order placed");
assert.equal(purchaseRequestNextAction("ordered", "Metro Print Supply"), "Record receipt");
assert.equal(purchaseRequestNextAction("partially_received", "Metro Print Supply"), "Receive remaining quantity");
assert.equal(purchaseRequestNextAction("received", "Metro Print Supply"), "View receipt");
assert.equal(purchaseRequestNextAction("cancelled", "Metro Print Supply"), "View request");
console.log("fabrication inventory self-test: passed");
