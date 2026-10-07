export type MaterialVariance = {
  planned: number;
  actual: number;
  variance: number;
  status: "under" | "on_plan" | "over";
};

export type MaterialReadinessRow = {
  plannedQuantity: number;
  reservedQuantity: number;
};

export type MaterialReadinessSummary = {
  isReady: boolean;
  shortageCount: number;
  totalShortage: number;
};

export type OpenPurchaseRequest = {
  id: string;
  supplierName: string | null;
  status: "requested" | "ordered" | "partially_received" | "received" | "cancelled";
  remainingQuantity: number;
};

export type SupplierPurchaseGroup = {
  supplierName: string;
  requestIds: string[];
};

export type JobOrderPurchaseRequest = {
  id: string;
  jobOrderId: string | null;
  jobNumber: string | null;
  projectName: string | null;
};

export type JobOrderPurchaseGroup = Omit<JobOrderPurchaseRequest, "id"> & { requestIds: string[] };

export function groupPurchaseRequestsByJobOrder(
  requests: JobOrderPurchaseRequest[],
): JobOrderPurchaseGroup[] {
  const groups = new Map<string, JobOrderPurchaseGroup>();
  for (const request of requests) {
    if (!request.jobOrderId) continue;
    const group = groups.get(request.jobOrderId) ?? {
      jobOrderId: request.jobOrderId,
      jobNumber: request.jobNumber,
      projectName: request.projectName,
      requestIds: [],
    };
    group.requestIds.push(request.id);
    groups.set(request.jobOrderId, group);
  }
  return [...groups.values()].sort((left, right) =>
    String(left.jobNumber ?? "").localeCompare(String(right.jobNumber ?? "")),
  );
}

export function purchaseRequestNextAction(
  status: OpenPurchaseRequest["status"],
  supplierName: string | null,
) {
  if (status === "received") return "View receipt";
  if (status === "cancelled") return "View request";
  if (!supplierName?.trim()) return "Choose supplier";
  if (status === "ordered") return "Record receipt";
  if (status === "partially_received") return "Receive remaining quantity";
  return "Mark order placed";
}

/**
 * A purchasing queue is a read-only grouping of existing shortage requests.
 * It intentionally does not create a purchase-order aggregate or new quantity
 * source of truth.
 */
export function groupOpenPurchaseRequestsBySupplier(
  requests: OpenPurchaseRequest[],
): SupplierPurchaseGroup[] {
  const groups = new Map<string, SupplierPurchaseGroup>();
  for (const request of requests) {
    if (request.status === "received" || request.status === "cancelled" || request.remainingQuantity <= 0) continue;
    const supplierName = request.supplierName?.trim() || "Supplier not set";
    const group = groups.get(supplierName) ?? { supplierName, requestIds: [] };
    group.requestIds.push(request.id);
    groups.set(supplierName, group);
  }
  return [...groups.values()].sort((left, right) => left.supplierName.localeCompare(right.supplierName));
}

export function availableStock(input: { onHand: number; reserved: number }): number {
  return Math.max(0, input.onHand - input.reserved);
}

/** Round a shortage up to the smallest whole pack/roll quantity. */
export function purchaseQuantity(shortage: number, packSize = 1): number {
  if (!Number.isFinite(shortage) || shortage <= 0) return 0;
  if (!Number.isFinite(packSize) || packSize <= 0) throw new Error("packSize must be positive");
  return Math.ceil(shortage / packSize) * packSize;
}

export function materialVariance(planned: number, actual: number): MaterialVariance {
  if (!Number.isFinite(planned) || planned < 0) throw new Error("planned must be non-negative");
  if (!Number.isFinite(actual) || actual < 0) throw new Error("actual must be non-negative");
  const variance = actual - planned;
  return {
    planned,
    actual,
    variance,
    status: variance === 0 ? "on_plan" : variance > 0 ? "over" : "under",
  };
}

export function summarizeMaterialReadiness(rows: MaterialReadinessRow[]): MaterialReadinessSummary {
  let shortageCount = 0;
  let totalShortage = 0;

  for (const row of rows) {
    const shortage = Math.max(0, Number(row.plannedQuantity) - Number(row.reservedQuantity));
    if (shortage > 0) {
      shortageCount += 1;
      totalShortage += shortage;
    }
  }

  return {
    isReady: rows.length > 0 && shortageCount === 0,
    shortageCount,
    totalShortage,
  };
}
