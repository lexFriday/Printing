import assert from "node:assert/strict";
import fs from "node:fs";
import { buildQuoteWorkbook } from "../src/lib/quoteExcelExport.ts";

console.log("[TEST] 1. Testing Quotation Excel workbook generation (ExcelJS with visual styles & images)...");

// Read a sample image buffer for logo and attachment tests
const sampleLogoBuffer = fs.readFileSync("public/brand/arlechino-jo-logo.png");
const sampleLogoArrayBuf = sampleLogoBuffer.buffer.slice(
  sampleLogoBuffer.byteOffset,
  sampleLogoBuffer.byteOffset + sampleLogoBuffer.byteLength,
);

const smallQuote = {
  quoteNumber: "QUO-2026-0001",
  quoteDate: "2026-10-23",
  projectName: "Branch Signage Package",
  taxType: "vatable",
  customerName: "ACME Corporation",
  customerAddress: "123 Business Blvd., Quezon City",
  contactPerson: "Jane Doe",
  contactNumber: "0917-123-4567",
  email: "jane@acme.ph",
  tinNumber: "123-456-789-000",
  terms: "50% DP, 50% upon delivery",
  remarks: "Includes delivery and installation",
  salesAgent: "John Smith",
  subtotal: 30000,
  adjustmentAmount: 0,
  totalAmount: 33600,
  companyLogoUrl: "/brand/arlechino-jo-logo.png",
  approvedBySignatureUrl: "/brand/arlechino-jo-logo.png", // sample signature
  lines: [
    {
      id: "line-1",
      description: "Backlit Acrylic Signage",
      width: 120,
      height: 60,
      unit_of_measure: "cm",
      quantity: 2,
      unit_price: 7500,
      line_total: 15000,
    },
    {
      id: "line-2",
      description: "Frosted Vinyl Window Film",
      width: 200,
      height: 100,
      unit_of_measure: "cm",
      quantity: 1,
      unit_price: 15000,
      line_total: 15000,
    },
    {
      id: "line-blank",
      description: "[BLANK_LINE]",
      quantity: 0,
      unit_price: 0,
      line_total: 0,
      is_blank: true,
    },
  ],
  attachments: [
    {
      id: "att-1",
      quote_line_item_id: "line-1",
      file_name: "acrylic-mockup.png",
      buffer: sampleLogoArrayBuf,
    },
  ],
};

const wbSmall = await buildQuoteWorkbook(smallQuote);
assert.ok(wbSmall, "Workbook must be created");

const ws = wbSmall.getWorksheet("Quotation");
assert.ok(ws, "Quotation worksheet exists");

// 1. Verify Title Banner (Row 5)
const titleCell = ws.getCell("A5");
assert.equal(titleCell.value, "QUOTATION", "Title banner must be QUOTATION");
assert.equal(titleCell.font?.bold, true, "Title must be bold");
assert.equal(titleCell.font?.color?.argb, "FFFFFFFF", "Title text must be white");
assert.equal(titleCell.fill?.fgColor?.argb, "FF332F91", "Title fill must match PDF blue #332f91");

// 2. Verify Metadata (Rows 7-11)
assert.equal(ws.getCell("A7").value, "QTN#:");
assert.equal(ws.getCell("B7").value, "QUO-2026-0001");
assert.equal(ws.getCell("E7").value, "Date:");
assert.equal(ws.getCell("A8").value, "Project:");
assert.equal(ws.getCell("B8").value, "BRANCH SIGNAGE PACKAGE");
assert.equal(ws.getCell("A9").value, "Company Name:");
assert.equal(ws.getCell("B9").value, "ACME CORPORATION");
assert.equal(ws.getCell("E9").value, "Attention:");
assert.equal(ws.getCell("F9").value, "JANE DOE");

// 3. Verify Table Header Row
// Find the header row with 'ITEM'
let headerRowNum = -1;
for (let r = 10; r <= 20; r++) {
  if (ws.getCell(`A${r}`).value === "ITEM") {
    headerRowNum = r;
    break;
  }
}
assert.ok(headerRowNum > 0, "Header row must exist");
assert.equal(ws.getCell(`B${headerRowNum}`).value, "QTY");
assert.equal(ws.getCell(`C${headerRowNum}`).value, "ITEM");
assert.equal(ws.getCell(`D${headerRowNum}`).value, "MEASUREMENT");
assert.equal(ws.getCell(`E${headerRowNum}`).value, "UNIT PRICE");
assert.equal(ws.getCell(`F${headerRowNum}`).value, "TOTAL PRICE");

const headCell = ws.getCell(`A${headerRowNum}`);
assert.equal(headCell.fill?.fgColor?.argb, "FF000000", "Table header fill must be black");
assert.equal(headCell.font?.color?.argb, "FFFFFFFF", "Table header font must be white");

// 4. Verify Data Rows & Exclude Blank Spacer
const rowItem1 = headerRowNum + 1;
assert.equal(ws.getCell(`A${rowItem1}`).value, 1);
assert.equal(ws.getCell(`B${rowItem1}`).value, 2);
assert.equal(ws.getCell(`C${rowItem1}`).value, "BACKLIT ACRYLIC SIGNAGE");
assert.equal(ws.getCell(`D${rowItem1}`).value, "120 × 60 CM");
assert.equal(ws.getCell(`E${rowItem1}`).value, 7500);
assert.equal(ws.getCell(`F${rowItem1}`).value, 15000);

const rowItem2 = headerRowNum + 2;
assert.equal(ws.getCell(`A${rowItem2}`).value, 2);
assert.equal(ws.getCell(`C${rowItem2}`).value, "FROSTED VINYL WINDOW FILM");
assert.equal(ws.getCell(`F${rowItem2}`).value, 15000);

// Row item 3 should NOT be the blank spacer
const rowAfter2 = headerRowNum + 3;
assert.notEqual(ws.getCell(`C${rowAfter2}`).value, "[BLANK_LINE]", "Blank line spacer must be excluded");

// 5. Verify Row Height for item with photo (dynamically scaled to fit normal aspect ratio)
assert.ok(ws.getRow(rowItem1).height >= 70, `Row with photo attachment should expand height (actual: ${ws.getRow(rowItem1).height})`);

// 6. Verify Images Embedded
const images = ws.getImages();
assert.ok(images.length >= 2, `Expected embedded images (logo, photo, signature), found: ${images.length}`);

// 7. Verify Number Formats
assert.equal(ws.getCell(`E${rowItem1}`).numFmt, "#,##0.00", "Unit price must be formatted as #,##0.00");
assert.equal(ws.getCell(`F${rowItem1}`).numFmt, "#,##0.00", "Total price must be formatted as #,##0.00");

// 8. Verify Write Buffer
const smallBuffer = await wbSmall.xlsx.writeBuffer();
assert.ok(smallBuffer.byteLength > 20000, "Excel binary with images should be > 20KB");
console.log(`  ✓ Small quote Excel verified (${smallBuffer.byteLength} bytes, ${images.length} embedded images).`);

console.log("[TEST] 2. Testing large quotation (60 line items) Excel export...");

const largeLines = Array.from({ length: 60 }, (_, i) => ({
  id: `large-${i + 1}`,
  description: `Custom Wall Graphic Panel Item ${i + 1}`,
  width: 50,
  height: 50,
  unit_of_measure: "cm",
  quantity: 5,
  unit_price: 1000,
  line_total: 5000,
}));

const largeQuote = {
  quoteNumber: "QUO-2026-9999",
  quoteDate: "2026-10-23",
  projectName: "Massive 60-Item Rollout",
  taxType: "non_vat",
  customerName: "Large Enterprise Inc.",
  subtotal: 300000,
  totalAmount: 300000,
  lines: largeLines,
  companyLogoUrl: "/brand/arlechino-jo-logo.png",
};

const wbLarge = await buildQuoteWorkbook(largeQuote);
const wsLarge = wbLarge.getWorksheet("Quotation");
assert.ok(wsLarge, "Large worksheet exists");

// Find item 60
let foundItem60 = false;
wsLarge.eachRow((row) => {
  if (row.getCell(1).value === 60) {
    assert.equal(row.getCell(3).value, "CUSTOM WALL GRAPHIC PANEL ITEM 60");
    assert.equal(row.getCell(6).value, 5000);
    foundItem60 = true;
  }
});
assert.ok(foundItem60, "Item 60 must be found and correct in large quote");

const largeBuffer = await wbLarge.xlsx.writeBuffer();
assert.ok(largeBuffer.byteLength > 30000, "Large workbook buffer should be > 30KB");
console.log(`  ✓ Large quote (60 items) Excel verified (${largeBuffer.byteLength} bytes).`);

console.log("All Quotation Excel Export contract tests PASSED!");
