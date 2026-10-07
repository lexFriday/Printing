export const DEFAULT_PRODUCTION_STEPS = [
  "Artwork / Export",
  "Production / Printing",
  "Cutting / Finishing",
  "Quality Check",
] as const;

export function sortProductionGroupsByItemOrder<
  T extends { itemId: string; item?: { sort_order?: number | null } | null },
>(groups: T[]) {
  return [...groups].sort((a, b) => {
    const orderA = Number(a.item?.sort_order ?? Number.MAX_SAFE_INTEGER);
    const orderB = Number(b.item?.sort_order ?? Number.MAX_SAFE_INTEGER);
    return orderA - orderB || a.itemId.localeCompare(b.itemId);
  });
}

export function normalizeProductionSteps(stepNames: string[]) {
  if (stepNames.length === 0) throw new Error("Add at least one production step.");
  if (stepNames.length > 12) throw new Error("Use up to 12 production steps.");

  const normalized = stepNames.map((name) => name.trim());
  if (normalized.some((name) => !name)) throw new Error("Name every production step.");

  const uniqueNames = new Set(normalized.map((name) => name.toLocaleLowerCase()));
  if (uniqueNames.size !== normalized.length) {
    throw new Error("Give every production step a different name.");
  }

  return normalized;
}
