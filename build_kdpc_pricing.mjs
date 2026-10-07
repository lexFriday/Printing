import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "C:/Users/skhart/OneDrive/Documents/ChatGPT/printing/outputs/kdpc-pricing";
await fs.mkdir(outputDir, { recursive: true });
const wb = Workbook.create();
const navy = "#172554", blue = "#2563EB", pale = "#EFF6FF", gray = "#F8FAFC", border = "#CBD5E1";
const styleSheet = (sheet, title, subtitle, endCol) => {
  sheet.getRange(`A1:${endCol}1`).merge();
  sheet.getRange("A1").values = [[title]];
  sheet.getRange(`A1:${endCol}1`).format = { fill: navy, font: { name: "Arial", size: 16, bold: true, color: "#FFFFFF" }, verticalAlignment: "Center" };
  sheet.getRange(`A2:${endCol}2`).merge();
  sheet.getRange("A2").values = [[subtitle]];
  sheet.getRange(`A2:${endCol}2`).format = { fill: pale, font: { name: "Arial", size: 10, color: navy }, wrapText: true };
  sheet.getRange(`A1:${endCol}2`).format.rowHeight = 26;
};
const table = (sheet, range, values, widths = []) => {
  sheet.getRange(range).values = values;
  const top = range.split(":")[0].replace(/\d+/g, "");
  const end = range.split(":")[1].replace(/\d+/g, "");
  sheet.getRange(`${top}${range.match(/\d+/)[0]}:${end}${values.length + Number(range.match(/\d+/)[0]) - 1}`).format = { font: { name: "Arial", size: 10 }, borders: { color: border, style: "Continuous" } };
  sheet.getRange(`${top}${range.match(/\d+/)[0]}:${end}${range.match(/\d+/)[0]}`).format = { fill: blue, font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" }, wrapText: true, borders: { color: border, style: "Continuous" } };
  widths.forEach((w, i) => sheet.getRangeByIndexes(0, i, 1, 1).format.columnWidth = w);
};

const coated = wb.worksheets.add("Coated Paper");
styleSheet(coated, "Coated (C2S) Paper 13” × 19”", "Price per printed sheet in Philippine pesos. Grayscale: subtract ₱3/sheet. Two-sided printing: add ₱16/sheet.", "I");
const coatedRows = [["GSM", "1–19 sheets", "20–49 sheets", "50–99 sheets", "100–299 sheets", "300–499 sheets", "500–799 sheets", "800–999 sheets", "1000+ sheets"], [113,32,31,30,28,26,24,22,21], [148,33,32,31,29,27,25,23,22], [170,35,34,33,31,29,27,25,23], [200,36,35,34,32,30,28,26,24], [250,38,37,36,33,31,29,27,25], [300,40,39,38,36,33,31,28,26], [350,43,42,40,38,35,33,30,28]];
table(coated, "A4:I11", coatedRows, [12,16,16,16,18,18,18,18,16]);
coated.getRange("A13:I15").values = [["Usage notes", "", "", "", "", "", "", "", ""], ["Color mode", "Full color price shown", "", "", "", "", "", "", ""], ["Print sides", "Add ₱16 per sheet for two-sided printing", "", "", "", "", "", "", ""]];
coated.getRange("A13:I13").merge(); coated.getRange("A13:I13").format = { fill: gray, font: { name: "Arial", bold: true, color: navy } };
coated.freezePanes.freezeRows(4);

const stickers = wb.worksheets.add("Sticker Labels");
styleSheet(stickers, "Stickers / Labels 13” × 19”", "Price per sheet in Philippine pesos. Grayscale: subtract ₱3/sheet. Specialty stock requires a quote.", "G");
const stickerRows = [["Stock group", "1–99 sheets", "100–299 sheets", "300–499 sheets", "500–749 sheets", "750–999 sheets", "1000+ sheets"], ["Regular: Kraft / Bookpaper / Satin / Hi-gloss", 52,50,48,46,44,42], ["Waterproof: Pearl Gloss / Matte / Clear", 67,65,63,61,59,57], ["Specialty: Corolla / Tintoretto / Constellation / Mylar", "RFQ", "RFQ", "RFQ", "RFQ", "RFQ", "RFQ"]];
table(stickers, "A4:G7", stickerRows, [48,16,17,17,17,17,16]);
stickers.freezePanes.freezeRows(4);

const finishing = wb.worksheets.add("Finishing");
styleSheet(finishing, "Post-Press / Finishing Options", "Use these as add-ons to the printed-sheet price. “Starts at” and RFQ values require confirmation before quoting.", "D");
const finishRows = [["Category", "Option", "Price", "Unit / rule"], ["Lamination", "Matte & Glossy", 20, "per side"], ["Lamination", "Matte & Glossy - Labels", 30, "per job / confirm current rate"], ["Lamination", "Silk", 30, "per side"], ["Lamination", "Foil on Silk", 120, "per job / confirm current rate"], ["Lamination", "Spot UV", "RFQ", "request quote"], ["Lamination", "Emboss/Deboss/Foil Stamp", "RFQ", "request quote"], ["Cutting", "Regular Straight", 5, "per sheet"], ["Cutting", "Easy-peel / Kiss cut", 10, "per sheet"], ["Cutting", "Diecut / Full Cut", "RFQ", "request quote"], ["Binding", "Ring / Coil", "Starts at 10", "starting price"], ["Binding", "Saddle Stitch", "Starts at 5", "starting price"]];
table(finishing, "A4:D15", finishRows, [18,34,18,32]);
finishing.freezePanes.freezeRows(4);

const guide = wb.worksheets.add("Pricing Guide");
styleSheet(guide, "Sheet Pricing Guide", "Simple reference for setting up item templates and quoting.", "D");
const guideRows = [["Step", "What the user selects", "What the system calculates", "Source / note"], [1, "Item template", "Pricing type and item details", "The item template is the sellable work"], [2, "Printed sheets", "Matches the item’s sheet tier", "Choose the rate range that fits the order"], [3, "Paper stock and GSM", "Uses its configured sheet rates", "Coated and sticker items have separate rates"], [4, "Colour and print sides", "Applies any configured adjustment", "Confirm whether an adjustment applies"], [5, "Finishing options", "Adds lamination, cutting, or binding charges", "RFQ and starting prices need confirmation"]];
table(guide, "A4:D10", guideRows, [10,32,45,34]);
guide.freezePanes.freezeRows(4);

for (const s of [coated, stickers, finishing, guide]) { s.getUsedRange().format.verticalAlignment = "Center"; }
wb.recalculate();
const preview = await wb.render({ sheetName: "Coated Paper", range: "A1:I15", scale: 1, format: "png" });
await fs.writeFile(`${outputDir}/preview.png`, new Uint8Array(await preview.arrayBuffer()));
const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(`${outputDir}/KolourPro-sheet-pricing.xlsx`);
