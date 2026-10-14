import * as XLSX from "xlsx";
import { unzipSync, zipSync } from "fflate";

type CellValue = string | number | boolean | Date | null | undefined;

/** Fill the supplied SI/DR workbook without rebuilding or reflowing its layout. */
export async function downloadFilledTemplate(
  template: "sales-invoice" | "delivery-receipt",
  sheetIndex: number,
  cells: Record<string, CellValue>,
  filename: string,
  _options?: Record<string, unknown>,
) {
  const response = await fetch(
    template === "delivery-receipt" ? "/delivery-receipt-template.xlsx" : "/invoice-template.xlsx",
  );
  if (!response.ok) throw new Error("Print Excel template could not be loaded.");
  const workbook = XLSX.read(await response.arrayBuffer(), { type: "array", cellStyles: true });
  const sheetName = workbook.SheetNames[sheetIndex];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet || !sheetName) throw new Error("Print Excel template sheet could not be found.");

  const clear = (address: string) => {
    const cell = sheet[address];
    if (!cell) return;
    delete cell.v;
    delete cell.f;
    delete cell.F;
    cell.t = "s";
  };
  if (template === "sales-invoice") {
    [
      "B9",
      "F8",
      "F10",
      "A11",
      "B13",
      ...Array.from({ length: 18 }, (_, i) => `A${13 + i}`),
    ].forEach(clear);
    for (let row = 22; row <= 29; row += 1)
      ["A", "E", "F", "G"].forEach((column) => clear(`${column}${row}`));
  } else if (sheetIndex === 0) {
    ["B9", "F9", "B10", "B11", "B12", "C15", "F11"].forEach(clear);
    for (let row = 19; row <= 33; row += 1)
      ["B", "C", "D", "F"].forEach((column) => clear(`${column}${row}`));
  } else {
    for (let row = 19; row <= 27; row += 1)
      ["B", "C", "D", "F"].forEach((column) => clear(`${column}${row}`));
  }

  for (const [address, value] of Object.entries(cells)) {
    const previous = sheet[address] ?? {};
    const nextValue = value ?? "";
    const replacement = {
      ...previous,
      v: nextValue,
      t: typeof nextValue === "number" ? "n" : nextValue instanceof Date ? "d" : "s",
    };
    delete replacement.f;
    delete replacement.F;
    sheet[address] = replacement;
  }

  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
  const repairedBytes = restorePrintSetup(bytes, template);
  const blob = new Blob([repairedBytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

function restorePrintSetup(bytes: ArrayBuffer, template: "sales-invoice" | "delivery-receipt") {
  const files = unzipSync(new Uint8Array(bytes));
  const path = "xl/worksheets/sheet1.xml";
  if (!files[path]) {
    return new Uint8Array(bytes);
  }
  let xml = new TextDecoder().decode(files[path]);
  if (template === "sales-invoice") {
    // SI SSOT: Letter landscape, custom margins in inches, and fit all rows
    // onto one page while retaining the template's original columns.
    xml = xml.replace(
      /<sheetPr><pageSetUpPr[^>]*\/><\/sheetPr>/g,
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>',
    );
    xml = xml.replace(
      /<pageMargins[^>]*\/>/g,
      '<pageMargins left="0.7" right="1.3" top="4.2" bottom="1.8" header="0.8" footer="0.8"/>',
    );
    xml = xml.replace(
      /<pageSetup[^>]*\/>/g,
      '<pageSetup paperSize="1" orientation="landscape" fitToWidth="0" fitToHeight="1"/>',
    );
    if (!xml.includes("<sheetPr")) {
      const rootStart = xml.indexOf("<worksheet");
      const rootEnd = xml.indexOf(">", rootStart) + 1;
      xml = `${xml.slice(0, rootEnd)}<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${xml.slice(rootEnd)}`;
    }
    if (!xml.includes("<pageSetup")) {
      const setup =
        '<pageSetup paperSize="1" orientation="landscape" fitToWidth="0" fitToHeight="1"/>';
      const insertionPoint = xml.includes("<ignoredErrors") ? "<ignoredErrors" : "</worksheet>";
      xml = xml.replace(insertionPoint, `${setup}${insertionPoint}`);
    }
    files[path] = new TextEncoder().encode(xml);
    return zipSync(files);
  }

  xml = xml.replace(
    /<sheetPr><pageSetUpPr[^>]*\/><\/sheetPr>/g,
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>',
  );
  // DR SSOT: A4 landscape, Last Custom margins (0.6 cm left/right,
  // 1.9 cm top/bottom, 0.8 cm header/footer), adjust to 80% (not fit-to-page).
  xml = xml.replace(
    /<pageMargins[^>]*\/>/g,
    '<pageMargins left="0.2362204724" right="0.2362204724" top="0.7480314961" bottom="0.7480314961" header="0.3149606299" footer="0.3149606299"/>',
  );
  xml = xml.replace(
    /<pageSetup[^>]*\/>/g,
    '<pageSetup paperSize="9" orientation="landscape" scale="80"/>',
  );
  if (!xml.includes("<sheetPr")) {
    const rootStart = xml.indexOf("<worksheet");
    const rootEnd = xml.indexOf(">", rootStart) + 1;
    xml = `${xml.slice(0, rootEnd)}<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${xml.slice(rootEnd)}`;
  }
  if (!xml.includes("<pageSetup")) {
    const setup = '<pageSetup paperSize="9" orientation="landscape" scale="80"/>';
    const insertionPoint = xml.includes("<ignoredErrors") ? "<ignoredErrors" : "</worksheet>";
    xml = xml.replace(insertionPoint, `${setup}${insertionPoint}`);
  }
  files[path] = new TextEncoder().encode(xml);
  return zipSync(files);
}
