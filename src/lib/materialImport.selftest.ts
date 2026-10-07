import { strict as assert } from "node:assert";
import {
  MATERIAL_IMPORT_HEADERS,
  materialImportPayload,
  materialImportTemplateCsv,
  parseMaterialImportFile,
  rejectedMaterialCsv,
} from "./materialImport.ts";

assert.deepEqual(MATERIAL_IMPORT_HEADERS, [
  "Material Name",
  "Unit",
  "Category",
  "Reorder Threshold",
  "Units Per Pack",
  "Starting Quantity",
]);

const file = new File(
  [
    `${MATERIAL_IMPORT_HEADERS.join(",")}\n`,
    "Glossy Vinyl,sqm,substrate,10,5,25\n",
    " glossy vinyl ,sqm,substrate,10,5,0\n",
    "Ink,reams,NJL opening inventory,-1,0,-1\n",
    "Paper,,,0,1,\n",
  ],
  "materials.csv",
  { type: "text/csv" },
);

const rows = await parseMaterialImportFile(file, ["Existing Board"]);
assert.equal(rows.length, 4);
assert.deepEqual(rows[0], {
  rowNumber: 2,
  name: "Glossy Vinyl",
  unit: "sqm",
  category: "substrate",
  reorder_threshold: 10,
  pack_size: 5,
  starting_quantity: 25,
  errors: [],
});
assert.match(rows[1].errors.join("; "), /Duplicate material name in this file/);
assert.match(rows[2].errors.join("; "), /Reorder threshold must be zero or greater/);
assert.match(rows[2].errors.join("; "), /Units per pack must be greater than zero/);
assert.match(rows[2].errors.join("; "), /Starting quantity must be zero or greater/);
assert.doesNotMatch(rows[2].errors.join("; "), /Unit must|Category must/);
assert.equal(rows[2].category, "NJL opening inventory");
assert.match(rows[3].errors.join("; "), /Unit is required/);
assert.match(rows[3].errors.join("; "), /Category is required/);
assert.match(rows[3].errors.join("; "), /Starting quantity is required/);

const existing = new File(
  [`${MATERIAL_IMPORT_HEADERS.join(",")}\nExisting Board,sheet,substrate,0,1,0\n`],
  "existing.csv",
  { type: "text/csv" },
);
const [existingRow] = await parseMaterialImportFile(existing, [" existing board "]);
assert.match(existingRow.errors.join("; "), /Material already exists/);

assert.match(
  materialImportTemplateCsv(),
  /^Material Name,Unit,Category,Reorder Threshold,Units Per Pack,Starting Quantity\r\n/,
);
assert.match(materialImportTemplateCsv(), /Glossy Vinyl,sqm,substrate,10,5,25/);
assert.match(rejectedMaterialCsv(rows), /Row,Material Name,Starting Quantity,Reason/);
assert.match(rejectedMaterialCsv(rows), /Duplicate material name in this file/);
assert.deepEqual(materialImportPayload(rows), [
  {
    name: "Glossy Vinyl",
    unit: "sqm",
    category: "substrate",
    reorder_threshold: 10,
    pack_size: 5,
    starting_quantity: 25,
  },
]);

console.log("Material import self-test: passed");
