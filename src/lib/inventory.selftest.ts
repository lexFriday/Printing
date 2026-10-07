import { inventoryBalance, purchaseQuantity } from "./inventory.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const balance = inventoryBalance([
  { type: "receipt", quantity: 100 },
  { type: "reservation", quantity: 60 },
  { type: "consumption", quantity: 40 },
  { type: "reservation_release", quantity: 40 },
]);
assert(balance.onHand === 60 && balance.reserved === 20 && balance.available === 40, "ledger math failed");
assert(purchaseQuantity(63, 50) === 100, "pack rounding failed");
let rejected = false;
try {
  inventoryBalance([{ type: "reservation", quantity: 1 }]);
} catch {
  rejected = true;
}
assert(rejected, "invalid reservation should fail");
console.log("Inventory self-test passed");
