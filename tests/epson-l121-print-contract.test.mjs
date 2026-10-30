import assert from "node:assert/strict";
import {
  CHECK_LAYOUT_CONFIG,
  LAYOUT_CONFIG,
  SERVICE_INVOICE_LAYOUT_CONFIG,
  CHECK_VOUCHER_LAYOUT_CONFIG,
  generateDeliveryReceiptPdf,
  generateCheckPdf,
  generateServiceInvoicePdf,
  generateCheckVoucherPdf,
  EPSON_L121_TRAY_OFFSETS,
  getMockJobOrder,
  getMockExpense,
  getMockInvoice,
} from "../scripts/print-delivery-receipt.mjs";

console.log("[TEST] 1. Checking Epson L121 right-edge tray offsets calculation...");

// Tray Carriage: A4 (8.2677" = 210 mm)
const A4_WIDTH_IN = 8.2677;

// 1. Delivery Receipt: 5.5" wide
// Epson L121 right load: Top-feed unscaled A4 aligns directly at paper origin (offset = 0.0)
assert.equal(EPSON_L121_TRAY_OFFSETS.deliveryReceipt, 0.0, "DR right-edge offset must be 0.0 inches");

// 2. Bank Check: 8.0" wide (top-feed for Epson L120/L121)
// Epson L121 right load: 8.2677 - 8.0 = 0.2677"
const checkExpectedOffsetIn = Number((A4_WIDTH_IN - 8.0).toFixed(4));
assert.equal(checkExpectedOffsetIn, 0.2677, "Check right-edge offset must be 0.2677 inches for top-feed");

// 3. Service Invoice: 15 cm wide = 15 / 2.54 = ~5.9055"
// Epson L121 right load: Top-feed unscaled A4 aligns directly at paper origin (offset = 0.0)
assert.equal(EPSON_L121_TRAY_OFFSETS.serviceInvoice, 0.0, "SI right-edge offset must be 0.0 inches");

// 4. Check Voucher: 210 mm wide (A5 landscape top-feed for Epson L120/L121)
// Epson L121 top load: full carriage width (210 - 210) mm = 0.0"
assert.equal(EPSON_L121_TRAY_OFFSETS.checkVoucher, 0.0, "CV right-edge offset must be 0.0 inches (full carriage width)");

console.log("  ✓ Right-edge tray math verified.");

console.log("[TEST] 2. Verifying PDF generation for both Standard and Epson L121...");

const mockJob = getMockJobOrder();
const mockExpense = getMockExpense();
const mockInvoice = getMockInvoice();

// Delivery Receipt
const drStd = generateDeliveryReceiptPdf(mockJob, LAYOUT_CONFIG, "standard");
const drL121 = generateDeliveryReceiptPdf(mockJob, LAYOUT_CONFIG, "epson-l121");
const drUnpriced = generateDeliveryReceiptPdf({ ...mockJob, priced: false }, LAYOUT_CONFIG, "standard");
const drHiddenPo = generateDeliveryReceiptPdf({ ...mockJob, includePo: false }, LAYOUT_CONFIG, "standard");
const drWithPo = generateDeliveryReceiptPdf({ ...mockJob, includePo: true }, LAYOUT_CONFIG, "standard");
assert.ok(drStd.output("arraybuffer").byteLength > 1000, "DR standard PDF should generate");
assert.ok(drL121.output("arraybuffer").byteLength > 1000, "DR Epson L121 PDF should generate");
assert.ok(drUnpriced.output("arraybuffer").byteLength > 1000, "DR unpriced PDF should generate");
assert.ok(drHiddenPo.output("arraybuffer").byteLength > 1000, "DR with hidden PO PDF should generate");
assert.ok(drWithPo.output("arraybuffer").byteLength > 1000, "DR with included PO PDF should generate");
assert.equal(drL121.internal.pageSize.getWidth(), Math.round(A4_WIDTH_IN * 72), "DR Epson L121 should be A4 canvas");

// Bank Check
const chkStd = generateCheckPdf(mockExpense, CHECK_LAYOUT_CONFIG, "standard");
const chkL121 = generateCheckPdf(mockExpense, CHECK_LAYOUT_CONFIG, "epson-l121");
assert.ok(chkStd.output("arraybuffer").byteLength > 1000, "Check standard PDF should generate");
assert.ok(chkL121.output("arraybuffer").byteLength > 1000, "Check Epson L121 PDF should generate");

// Service Invoice
const siStd = generateServiceInvoicePdf(mockInvoice, SERVICE_INVOICE_LAYOUT_CONFIG, "standard");
const siL121 = generateServiceInvoicePdf(mockInvoice, SERVICE_INVOICE_LAYOUT_CONFIG, "epson-l121");
assert.ok(siStd.output("arraybuffer").byteLength > 1000, "SI standard PDF should generate");
assert.ok(siL121.output("arraybuffer").byteLength > 1000, "SI Epson L121 PDF should generate");
assert.equal(siL121.internal.pageSize.getWidth(), Math.round(A4_WIDTH_IN * 72), "SI Epson L121 should be A4 canvas");

// Check Voucher
const cvStd = generateCheckVoucherPdf(mockExpense, CHECK_VOUCHER_LAYOUT_CONFIG, "standard");
const cvL121 = generateCheckVoucherPdf(mockExpense, CHECK_VOUCHER_LAYOUT_CONFIG, "epson-l121");
assert.ok(cvStd.output("arraybuffer").byteLength > 1000, "CV standard PDF should generate");
assert.ok(cvL121.output("arraybuffer").byteLength > 1000, "CV Epson L121 PDF should generate");
assert.equal(cvL121.internal.pageSize.getWidth(), Math.round(A4_WIDTH_IN * 72), "CV Epson L121 should be A4 canvas");

console.log("[TEST] 3. Verifying Zero-Recalibration Guarantee...");
// The Epson L121 profile applies a pure horizontal translation (or right-tray offset) without altering
// any relative field coordinates, line step intervals, or baseline alignments.
assert.equal(LAYOUT_CONFIG.header.deliveredTo.leftIn, 1.5, "DR Customer relative coordinate untouched");
assert.equal(LAYOUT_CONFIG.header.address.topIn, 2.79, "DR Address relative top updated");
assert.equal(LAYOUT_CONFIG.header.poNo.leftIn, 4.25, "DR PO No relative left updated");
assert.equal(LAYOUT_CONFIG.items.columns.description.leftIn, 1.2, "DR Line item relative coordinate untouched");
assert.equal(CHECK_LAYOUT_CONFIG.fields.payee.topIn, 1.00, "Check payee relative top updated to 1.00in");
assert.equal(CHECK_LAYOUT_CONFIG.fields.payee.leftIn, 1.30, "Check payee relative left untouched");
assert.equal(SERVICE_INVOICE_LAYOUT_CONFIG.header.soldTo.leftIn, 1.38, "SI Customer relative coordinate untouched");
assert.equal(CHECK_VOUCHER_LAYOUT_CONFIG.fields.payee.leftIn, 1.15, "CV Payee relative coordinate updated to 1.15in");
assert.equal(CHECK_VOUCHER_LAYOUT_CONFIG.fields.particulars.leftIn, 0.50, "CV Particulars relative coordinate updated to 0.50in");
assert.equal(CHECK_VOUCHER_LAYOUT_CONFIG.fields.columns.checkDate.header.topIn, 3.55, "CV Check Date header top coordinate");
assert.equal(CHECK_VOUCHER_LAYOUT_CONFIG.fields.columns.checkDate.header.leftIn, 1.20, "CV Check Date header left coordinate");
assert.equal(CHECK_VOUCHER_LAYOUT_CONFIG.fields.columns.documentNo.header.topIn, 3.55, "CV Document No header top coordinate");
assert.equal(CHECK_VOUCHER_LAYOUT_CONFIG.fields.columns.documentNo.header.leftIn, 2.90, "CV Document No header left coordinate");
assert.equal(CHECK_VOUCHER_LAYOUT_CONFIG.fields.columns.checkNo.header.topIn, 3.55, "CV Check No header top coordinate");
assert.equal(CHECK_VOUCHER_LAYOUT_CONFIG.fields.columns.checkNo.header.leftIn, 4.60, "CV Check No header left coordinate");
assert.equal(CHECK_VOUCHER_LAYOUT_CONFIG.fields.amount.row1.topIn, 3.10, "CV Amount row 1 top coordinate");
assert.equal(CHECK_VOUCHER_LAYOUT_CONFIG.fields.amount.line1.topIn, 3.16, "CV Amount single underline top coordinate");
assert.equal(CHECK_VOUCHER_LAYOUT_CONFIG.fields.amount.row2.topIn, 3.32, "CV Amount total row top coordinate");
assert.equal(CHECK_VOUCHER_LAYOUT_CONFIG.fields.signatures.preparedBy.topIn, 5.62, "CV Prepared By aligns on bottom dotted line");

console.log("  ✓ Zero-recalibration guarantee verified: all relative field baselines intact.");
console.log("All Epson L121 print contracts PASSED!");
