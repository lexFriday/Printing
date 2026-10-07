export type CustomMaterialRow = {
  lineId: string;
  materialId: string;
  quantity: string;
  unit: string;
};

export type CustomMaterialRowError = {
  index: number;
  field: "materialId" | "quantity";
  message: string;
};

type MaterialPlanAction = "add" | "release" | "use";

export function getMaterialPlanActions({
  canRelease,
  hasProduction,
  isReleased,
  hasPreparedMaterials,
  hasBom,
  needsCustomMaterials,
}: {
  canRelease: boolean;
  hasProduction: boolean;
  isReleased: boolean;
  hasPreparedMaterials: boolean;
  hasBom: boolean;
  needsCustomMaterials: boolean;
}): { primary: MaterialPlanAction | null; secondary: MaterialPlanAction | null } {
  if (!canRelease || isReleased) return { primary: null, secondary: null };
  if (!hasBom && needsCustomMaterials) return { primary: "add", secondary: null };
  if (!hasProduction) return { primary: null, secondary: null };
  if (hasPreparedMaterials) return { primary: "release", secondary: "add" };
  if (!hasBom) return { primary: "use", secondary: null };
  return { primary: null, secondary: null };
}

export function validateCustomMaterialRows(rows: CustomMaterialRow[]): CustomMaterialRowError[] {
  const errors: CustomMaterialRowError[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    if (!row.materialId || !row.unit) {
      errors.push({ index, field: "materialId", message: "Choose a material." });
    } else {
      const key = `${row.lineId}:${row.materialId}`;
      if (seen.has(key)) {
        errors.push({ index, field: "materialId", message: "This material is already included." });
      }
      seen.add(key);
    }

    if (!Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0) {
      errors.push({ index, field: "quantity", message: "Enter a quantity greater than zero." });
    }
  });

  return errors;
}
