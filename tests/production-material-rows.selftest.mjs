import assert from "node:assert/strict";

let validateCustomMaterialRows;
let getMaterialPlanActions;
try {
  ({ validateCustomMaterialRows, getMaterialPlanActions } =
    await import("../src/lib/productionMaterialRows.ts"));
} catch {
  validateCustomMaterialRows = () => [
    { index: -1, field: "module", message: "Validation is not implemented." },
  ];
}

assert.equal(typeof getMaterialPlanActions, "function", "material-plan action selection exists");

assert.deepEqual(
  getMaterialPlanActions({
    canRelease: true,
    hasProduction: false,
    isReleased: false,
    hasPreparedMaterials: false,
    hasBom: false,
    needsCustomMaterials: true,
  }),
  { primary: "add", secondary: null },
  "a custom item without materials offers Add materials without requiring a production plan first",
);

assert.deepEqual(
  getMaterialPlanActions({
    canRelease: true,
    hasProduction: true,
    isReleased: false,
    hasPreparedMaterials: true,
    hasBom: true,
    needsCustomMaterials: false,
  }),
  { primary: "release", secondary: "add" },
  "a prepared BOM makes release primary and material editing secondary",
);

assert.deepEqual(
  getMaterialPlanActions({
    canRelease: true,
    hasProduction: true,
    isReleased: false,
    hasPreparedMaterials: false,
    hasBom: false,
    needsCustomMaterials: false,
  }),
  { primary: "use", secondary: null },
  "a configured project offers Use project materials",
);

const validRows = [
  { lineId: "item-1", materialId: "vinyl", quantity: "2", unit: "sqm" },
  { lineId: "item-1", materialId: "ink", quantity: "1.5", unit: "ml" },
];

assert.deepEqual(
  validateCustomMaterialRows(validRows),
  [],
  "accepts complete, unique material rows",
);

assert.deepEqual(
  validateCustomMaterialRows([...validRows, { ...validRows[0] }]),
  [{ index: 2, field: "materialId", message: "This material is already included." }],
  "rejects the same material twice for one item",
);

assert.deepEqual(
  validateCustomMaterialRows([{ lineId: "item-1", materialId: "", quantity: "0", unit: "" }]),
  [
    { index: 0, field: "materialId", message: "Choose a material." },
    { index: 0, field: "quantity", message: "Enter a quantity greater than zero." },
  ],
  "returns errors beside the affected fields",
);

console.log("Production material row validation passed.");
