import * as XLSX from "xlsx";
import { unzipSync, zipSync } from "fflate";
import { CHECK_VOUCHER_FIELDS, CHECK_VOUCHER_PAGE_SIZE_IN } from "./checkVoucherLayout";

export type PrintWorkbookType = "DR" | "SI" | "CHECK VOUCHER" | "CHECK";

type PrintFieldMap = Record<string, string | number | null | undefined>;

/** Create fixed-size, single-sheet print overlays. Check forms are intended for
 * the supplied preprinted stock; Excel prints the text at 100% actual size. */
export function downloadPrintWorkbook(
  type: PrintWorkbookType,
  fields: PrintFieldMap,
  filename: string,
) {
  const sheet = XLSX.utils.aoa_to_sheet([]);
  const put = (cell: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && String(value) !== "") sheet[cell] = { v: value };
  };
  let setup: PrintSetup;

  if (type === "DR") {
    put("D4", fields.number);
    put("D6", fields.customer);
    put("D7", fields.tin);
    put("D8", fields.address);
    put("J6", fields.date);
    put("J7", fields.terms);
    put("J8", fields.po);
    put("B12", fields.particulars);
    put("J12", fields.amount);
    setup = {
      width: 8.5,
      height: 11,
      orientation: "portrait",
      range: "A1:N20",
      maxRow: 20,
      maxCol: 14,
    };
  } else if (type === "SI") {
    put("J3", fields.number);
    put("J5", fields.date);
    put("B7", fields.customer);
    put("B8", fields.address);
    put("B12", fields.particulars);
    put("J12", fields.amount);
    put("J24", fields.total);
    setup = {
      width: 8.5,
      height: 11,
      orientation: "portrait",
      range: "A1:N28",
      maxRow: 28,
      maxCol: 14,
    };
  } else if (type === "CHECK VOUCHER") {
    // The sample is preprinted; the workbook contains only variable text and
    // is set to the physical 8.5 x 5.5 inch stock at true 100% scale.
    setup = {
      ...CHECK_VOUCHER_PAGE_SIZE_IN,
      orientation: "landscape",
      range: "A1:K31",
      maxRow: 31,
      maxCol: 11,
    };
    putAtInches(CHECK_VOUCHER_FIELDS.date, fields.date);
    putAtInches(CHECK_VOUCHER_FIELDS.payee, fields.payee);
    putAtInches(CHECK_VOUCHER_FIELDS.particulars, fields.particulars);
    putAtInches(CHECK_VOUCHER_FIELDS.amount1, fields.amount);
    putAtInches(CHECK_VOUCHER_FIELDS.amount2, fields.amount);
    putAtInches(
      { ...CHECK_VOUCHER_FIELDS.documentNo, topIn: CHECK_VOUCHER_FIELDS.particulars.topIn },
      fields.documentNo,
    );
    putAtInches(
      { ...CHECK_VOUCHER_FIELDS.checkNo, topIn: CHECK_VOUCHER_FIELDS.particulars.topIn },
      fields.checkNo,
    );
    putAtInches({ topIn: 5.04, leftIn: 0.92, widthIn: 1.8 }, fields.preparedBy);
  } else {
    put("B5", fields.payee);
    const date = [fields.dateMonth, fields.dateDay, fields.dateYear]
      .filter((part) => part !== null && part !== undefined && String(part) !== "")
      .join("/");
    put("H5", date);
    put("B7", fields.amountWords);
    put("H7", fields.amount);
    put("H10", fields.checkNo);
    setup = {
      width: 8,
      height: 3,
      orientation: "landscape",
      range: "A1:L12",
      maxRow: 12,
      maxCol: 12,
    };
  }

  sheet["!ref"] = setup.range;
  // A 0.5-inch column grid and 0.25-inch row grid make cell positions match
  // the inch coordinates used by the PDF preview (the last rows are clipped
  // to the exact paper height by the print area).
  sheet["!cols"] = Array.from({ length: setup.maxCol }, () => ({ wch: 5.0 }));
  sheet["!rows"] = Array.from({ length: setup.maxRow }, (_, i) => ({
    hpt: i === setup.maxRow - 1 ? (setup.height % 0.25 || 0.25) * 72 : 18,
  }));
  sheet["!pageSetup"] = { orientation: setup.orientation, paperSize: 9, scale: 100 };
  sheet["!margins"] = { left: 0, right: 0, top: 0, bottom: 0, header: 0, footer: 0 };
  sheet["!printOptions"] = { horizontalCentered: false, verticalCentered: false, gridLines: false };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, type);
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
  const exact = applyCustomPrintSetup(bytes, setup);
  const blob = new Blob([exact], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);

  function putAtInches(
    field: { topIn: number; leftIn: number; widthIn: number; align?: string },
    value: string | number | null | undefined,
  ) {
    if (value === null || value === undefined || String(value) === "") return;
    const col = Math.min(setup!.maxCol - 1, Math.max(0, Math.round(field.leftIn / 0.5)));
    const row = Math.min(setup!.maxRow - 1, Math.max(0, Math.round(field.topIn / 0.25)));
    const addr = XLSX.utils.encode_cell({ r: row, c: col });
    sheet[addr] = { v: value, s: { alignment: { horizontal: field.align ?? "left" } } };
  }
}

type PrintSetup = {
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
  range: string;
  maxRow: number;
  maxCol: number;
};

function applyCustomPrintSetup(bytes: ArrayBuffer, setup: PrintSetup) {
  const files = unzipSync(new Uint8Array(bytes));
  const path = "xl/worksheets/sheet1.xml";
  let xml = new TextDecoder().decode(files[path]);
  xml = xml.replace(/<pageMargins[^>]*\/>/, "");
  xml = xml.replace(/<pageSetup[^>]*\/>/, "");
  xml = xml.replace(/<printOptions[^>]*\/>/, "");
  // Put print settings before ignoredErrors: worksheet child order is defined
  // by OOXML, and Excel repairs workbooks where these nodes are reversed.
  // Omit paperSize because the 8 x 3 and 8.5 x 5.5 inch stocks are driver-defined
  // custom sizes, not valid standard OOXML paperSize enum values.
  const setupXml = `<pageMargins left="0" right="0" top="0" bottom="0" header="0" footer="0"/><pageSetup orientation="${setup.orientation}" scale="100"/>`;
  const insertionPoint = xml.includes("<ignoredErrors") ? "<ignoredErrors" : "</worksheet>";
  xml = xml.replace(insertionPoint, `${setupXml}${insertionPoint}`);
  files[path] = new TextEncoder().encode(xml);
  return zipSync(files);
}
