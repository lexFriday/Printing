import * as XLSX from "xlsx";

export const MATERIAL_IMPORT_HEADERS = [
  "Material Name",
  "Unit",
  "Category",
  "Reorder Threshold",
  "Units Per Pack",
  "Starting Quantity",
] as const;

export type MaterialImportRow = {
  rowNumber: number;
  name: string;
  unit: string;
  category: string;
  reorder_threshold: number;
  pack_size: number;
  starting_quantity: number;
  errors: string[];
};

const clean = (value: unknown) => String(value ?? "").trim();
const key = (value: unknown) => clean(value).toLocaleLowerCase();
const number = (value: unknown) => Number(clean(value).replaceAll(",", ""));

function parseRows(rows: unknown[][], existingNames: string[]) {
  const [headerRow, ...dataRows] = rows;
  const headers = (headerRow ?? []).map(key);
  const missing = MATERIAL_IMPORT_HEADERS.filter((header) => !headers.includes(key(header)));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}`);

  const index = (header: string) => headers.indexOf(key(header));
  const seen = new Set<string>();
  const existing = new Set(existingNames.map(key));

  return dataRows
    .map((row, offset): MaterialImportRow => {
      const name = clean(row[index("Material Name")]);
      const unit = clean(row[index("Unit")]);
      const category = clean(row[index("Category")]);
      const reorderThreshold = number(row[index("Reorder Threshold")]);
      const packSize = number(row[index("Units Per Pack")]);
      const startingQuantityValue = clean(row[index("Starting Quantity")]);
      const startingQuantity = number(startingQuantityValue);
      const errors: string[] = [];
      const nameKey = key(name);

      if (!name) errors.push("Material name is required");
      else if (existing.has(nameKey)) errors.push("Material already exists");
      else if (seen.has(nameKey)) errors.push("Duplicate material name in this file");
      if (!unit) errors.push("Unit is required");
      if (!category) errors.push("Category is required");
      if (!Number.isFinite(reorderThreshold) || reorderThreshold < 0)
        errors.push("Reorder threshold must be zero or greater");
      if (!Number.isFinite(packSize) || packSize <= 0)
        errors.push("Units per pack must be greater than zero");
      if (!startingQuantityValue) errors.push("Starting quantity is required");
      else if (!Number.isFinite(startingQuantity) || startingQuantity < 0)
        errors.push("Starting quantity must be zero or greater");
      if (name) seen.add(nameKey);

      return {
        rowNumber: offset + 2,
        name,
        unit,
        category,
        reorder_threshold: reorderThreshold,
        pack_size: packSize,
        starting_quantity: startingQuantity,
        errors,
      };
    })
    .filter((row) => row.name || row.unit || row.category);
}

export async function parseMaterialImportFile(file: File, existingNames: string[]) {
  if (file.size > 5_000_000) throw new Error("File must be 5 MB or smaller.");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("The file has no worksheet.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  if (rows.length > 5_001) throw new Error("Import is limited to 5,000 materials at a time.");
  return parseRows(rows, existingNames);
}

export function materialImportTemplateCsv() {
  return `${MATERIAL_IMPORT_HEADERS.join(",")}\r\nGlossy Vinyl,sqm,substrate,10,5,25\r\n`;
}

export function materialImportPayload(rows: MaterialImportRow[]) {
  return rows
    .filter((row) => row.errors.length === 0)
    .map(({ name, unit, category, reorder_threshold, pack_size, starting_quantity }) => ({
      name,
      unit,
      category,
      reorder_threshold,
      pack_size,
      starting_quantity,
    }));
}

export function rejectedMaterialCsv(rows: MaterialImportRow[]) {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    "Row,Material Name,Starting Quantity,Reason",
    ...rows
      .filter((row) => row.errors.length)
      .map((row) =>
        [row.rowNumber, row.name, row.starting_quantity, row.errors.join("; ")]
          .map(escape)
          .join(","),
      ),
  ].join("\r\n");
}
