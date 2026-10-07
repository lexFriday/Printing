export type InventoryMovementType =
  | "receipt"
  | "reservation"
  | "reservation_release"
  | "consumption"
  | "return"
  | "waste"
  | "correction";

export type InventoryMovement = {
  type: InventoryMovementType;
  quantity: number;
};

export function inventoryBalance(movements: InventoryMovement[]) {
  let onHand = 0;
  let reserved = 0;
  for (const movement of movements) {
    if (movement.quantity <= 0) throw new Error("Movement quantity must be positive");
    switch (movement.type) {
      case "receipt":
      case "return":
      case "correction":
        onHand += movement.quantity;
        break;
      case "consumption":
      case "waste":
        onHand -= movement.quantity;
        break;
      case "reservation":
        reserved += movement.quantity;
        break;
      case "reservation_release":
        reserved -= movement.quantity;
        break;
    }
  }
  if (onHand < 0) throw new Error("Inventory cannot go below zero");
  if (reserved < 0 || reserved > onHand) throw new Error("Invalid reservation balance");
  return { onHand, reserved, available: onHand - reserved };
}

export function purchaseQuantity(required: number, packSize?: number | null) {
  if (required < 0) throw new Error("Required quantity cannot be negative");
  if (!packSize || packSize <= 0) return required;
  return Math.ceil(required / packSize) * packSize;
}
