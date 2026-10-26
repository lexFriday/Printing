import ExcelJS from "exceljs";
import { COMPANY_PROFILE } from "./brand";
import { fmtDate } from "./format";
import { computeInclusiveVat } from "./calc";

export interface QuoteExcelLine {
  id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  width?: number | null;
  height?: number | null;
  unit_of_measure?: string | null;
  is_blank?: boolean;
  sort_order?: number | null;
}

export interface QuoteExcelAttachment {
  id?: string;
  quote_line_item_id?: string | null;
  file_name?: string;
  signedUrl?: string | null;
  buffer?: ArrayBuffer;
  base64?: string;
}

export interface QuoteExcelExportPayload {
  quoteNumber: string;
  quoteDate?: string | Date | null;
  projectName: string;
  customerName?: string | null;
  customerAddress?: string | null;
  contactPerson?: string | null;
  contactNumber?: string | null;
  email?: string | null;
  tinNumber?: string | null;
  taxType?: "vatable" | "non_vat" | string | null;
  terms?: string | null;
  remarks?: string | null;
  salesAgent?: string | null;
  subtotal: number;
  adjustmentAmount?: number;
  totalAmount: number;
  lines: QuoteExcelLine[];
  companyLogoUrl?: string | null;
  approvedBySignatureUrl?: string | null;
  attachments?: QuoteExcelAttachment[];
}

interface ImageDimensionResult {
  width: number;
  height: number;
  extension: "png" | "jpeg" | "gif";
}

function parseImageDimensions(buffer: ArrayBuffer): ImageDimensionResult {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 16) return { width: 100, height: 100, extension: "png" };

  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    const view = new DataView(buffer);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return { width, height, extension: "png" };
  }

  // JPEG: FF D8
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    const view = new DataView(buffer);
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        const height = view.getUint16(offset + 5, false);
        const width = view.getUint16(offset + 7, false);
        return { width, height, extension: "jpeg" };
      }
      const length = view.getUint16(offset + 2, false);
      offset += 2 + length;
    }
    return { width: 100, height: 100, extension: "jpeg" };
  }

  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    const view = new DataView(buffer);
    const width = view.getUint16(6, true);
    const height = view.getUint16(8, true);
    return { width, height, extension: "gif" };
  }

  return { width: 100, height: 100, extension: "png" };
}

/**
 * Scales an image proportionally so its aspect ratio is strictly preserved.
 * It will never stretch, distort, or upscale beyond 100% normal size.
 */
function fitDimensions(
  origWidth: number,
  origHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (!origWidth || !origHeight) return { width: maxWidth, height: maxHeight };
  const ratio = Math.min(maxWidth / origWidth, maxHeight / origHeight, 1);
  return {
    width: Math.max(1, Math.round(origWidth * ratio)),
    height: Math.max(1, Math.round(origHeight * ratio)),
  };
}

// Column widths in characters matching PDF quotation table:
// Col A: Item # (12) - fits "Company Name:" without truncation
// Col B: Qty (12)
// Col C: Description (42)
// Col D: Measurement (26)
// Col E: Unit Price (16)
// Col F: Total Price (18)
const COL_WIDTHS_CHARS = [12, 12, 42, 26, 16, 18];

// Convert character column widths to approximate display pixels at 96 DPI
function getColWidthPx(width: number): number {
  return Math.floor((width * 7 + 5) / 7 * 7) + 5;
}

const COL_WIDTHS_PX = COL_WIDTHS_CHARS.map(getColWidthPx);
const TOTAL_TABLE_WIDTH_PX = COL_WIDTHS_PX.reduce((sum, w) => sum + w, 0); // ~942px

// EMUs per pixel (OpenXML standard: 1 pixel = 9525 EMUs)
const EMUS_PER_PX = 9525;

/**
 * Resolves exact OpenXML { nativeCol, nativeColOff } for any horizontal pixel position
 */
function getAnchorFromPixelX(pixelX: number): { nativeCol: number; nativeColOff: number } {
  let accum = 0;
  for (let i = 0; i < COL_WIDTHS_PX.length; i++) {
    if (pixelX < accum + COL_WIDTHS_PX[i] || i === COL_WIDTHS_PX.length - 1) {
      const colOffsetPx = pixelX - accum;
      return {
        nativeCol: i,
        nativeColOff: Math.round(colOffsetPx * EMUS_PER_PX),
      };
    }
    accum += COL_WIDTHS_PX[i];
  }
  return { nativeCol: 0, nativeColOff: 0 };
}

function formatMeasurement(line: QuoteExcelLine): string {
  if (line.width && line.height && line.unit_of_measure) {
    const uom =
      line.unit_of_measure.charAt(0).toUpperCase() +
      line.unit_of_measure.slice(1).toLowerCase();
    return `${line.width} × ${line.height} ${uom}`;
  }
  return "N/A";
}

async function loadImageData(
  src?: string | null,
): Promise<{ buffer: ArrayBuffer; extension: "png" | "jpeg" | "gif"; width: number; height: number } | null> {
  if (!src) return null;

  // Handle data URLs
  if (src.startsWith("data:image/")) {
    try {
      const isJpeg = src.includes("jpeg") || src.includes("jpg");
      const isGif = src.includes("gif");
      const base64Data = src.split(",")[1];
      const binaryString =
        typeof atob !== "undefined"
          ? atob(base64Data)
          : Buffer.from(base64Data, "base64").toString("binary");
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const arrayBuf = bytes.buffer;
      const dims = parseImageDimensions(arrayBuf);
      return {
        buffer: arrayBuf,
        extension: isGif ? "gif" : isJpeg ? "jpeg" : dims.extension,
        width: dims.width,
        height: dims.height,
      };
    } catch {
      return null;
    }
  }

  // Handle Node.js local files (e.g. tests)
  if (typeof window === "undefined") {
    try {
      const filePath = src.startsWith("/") ? `public${src}` : src;
      const fs = await import("fs");
      if (fs.existsSync(filePath)) {
        const fileBuf = fs.readFileSync(filePath);
        const arrayBuf = fileBuf.buffer.slice(
          fileBuf.byteOffset,
          fileBuf.byteOffset + fileBuf.byteLength,
        );
        const dims = parseImageDimensions(arrayBuf);
        return {
          buffer: arrayBuf,
          extension: dims.extension,
          width: dims.width,
          height: dims.height,
        };
      }
    } catch {
      // Continue to fetch if fs lookup fails
    }
  }

  // Handle Browser HTTP fetch
  if (typeof fetch !== "undefined") {
    try {
      const res = await fetch(src);
      if (!res.ok) return null;
      const blob = await res.blob();
      const arrayBuf = await blob.arrayBuffer();
      const dims = parseImageDimensions(arrayBuf);
      return {
        buffer: arrayBuf,
        extension: dims.extension,
        width: dims.width,
        height: dims.height,
      };
    } catch {
      return null;
    }
  }

  return null;
}

export async function buildQuoteWorkbook(data: QuoteExcelExportPayload): Promise<ExcelJS.Workbook> {
  const isVatable = data.taxType === "vatable";
  const validLines = (data.lines || []).filter(
    (l) => !l.is_blank && l.description !== "[BLANK_LINE]" && l.description?.trim() !== "",
  );

  const baseTotal = Number(data.subtotal || 0) + Number(data.adjustmentAmount || 0);
  const vat = computeInclusiveVat(baseTotal);
  const totalAmount = isVatable ? vat.grossTotal : Number(data.totalAmount || baseTotal || 0);

  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY_PROFILE.name;
  wb.created = new Date();

  const ws = wb.addWorksheet("Quotation", {
    views: [{ showGridLines: true }],
    pageSetup: {
      paperSize: 1, // Letter
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });

  // Set column widths matching PDF table
  ws.columns = [
    { key: "item", width: COL_WIDTHS_CHARS[0] },         // Col A: Item #
    { key: "qty", width: COL_WIDTHS_CHARS[1] },          // Col B: Qty
    { key: "desc", width: COL_WIDTHS_CHARS[2] },         // Col C: Description
    { key: "measurement", width: COL_WIDTHS_CHARS[3] },  // Col D: Measurement & Photos
    { key: "unitPrice", width: COL_WIDTHS_CHARS[4] },    // Col E: Unit Price
    { key: "totalPrice", width: COL_WIDTHS_CHARS[5] },   // Col F: Total Price
  ];

  // 1. Company Header / Logo (Rows 1-3)
  ws.addRow([]);
  ws.addRow([]);
  ws.addRow([]);

  const logoSource = data.companyLogoUrl || COMPANY_PROFILE.logo;
  const logoData = await loadImageData(logoSource);
  if (logoData) {
    try {
      const logoImgId = wb.addImage({
        buffer: logoData.buffer,
        extension: logoData.extension,
      });

      // Maintain normal proportions (max 180w x 70h, never stretched)
      const logoFit = fitDimensions(logoData.width, logoData.height, 180, 70);

      // Precisely center horizontally across the entire table (columns A to F)
      const logoLeftPx = Math.max(0, TOTAL_TABLE_WIDTH_PX / 2 - logoFit.width / 2);
      const logoAnchor = getAnchorFromPixelX(logoLeftPx);

      // Frame rows 1-3 to fit the logo cleanly with vertical centering
      const row2Height = Math.max(45, Math.round(logoFit.height * 0.75 + 10));
      ws.getRow(1).height = 10;
      ws.getRow(2).height = row2Height;
      ws.getRow(3).height = 10;

      const totalHeaderPx = Math.round((10 + row2Height + 10) * (96 / 72));
      const topOffsetPx = Math.max(0, (totalHeaderPx - logoFit.height) / 2);

      ws.addImage(logoImgId, {
        tl: {
          nativeCol: logoAnchor.nativeCol,
          nativeColOff: logoAnchor.nativeColOff,
          nativeRow: 0,
          nativeRowOff: Math.round(topOffsetPx * EMUS_PER_PX),
        },
        ext: { width: logoFit.width, height: logoFit.height },
        editAs: "oneCell",
      });
    } catch {
      ws.getRow(1).height = 15;
      ws.getRow(2).height = 25;
      ws.getRow(3).height = 15;
    }
  } else {
    ws.getRow(1).height = 15;
    ws.getRow(2).height = 25;
    ws.getRow(3).height = 15;
  }

  // Row 4: Spacing
  ws.addRow([]);
  ws.getRow(4).height = 8;

  // 2. Title Bar: "QUOTATION" (Row 5)
  ws.mergeCells("A5:F5");
  const titleRow = ws.getRow(5);
  titleRow.height = 28;
  const titleCell = ws.getCell("A5");
  titleCell.value = "QUOTATION";
  titleCell.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF332F91" }, // PDF deep blue
  };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };

  // Row 6: Spacing
  ws.addRow([]);
  ws.getRow(6).height = 8;

  // 3. Metadata Section (Rows 7-11)
  const metaStyle = {
    fontBold: { name: "Arial", size: 10, bold: true, color: { argb: "FF000000" } },
    fontNormal: { name: "Arial", size: 10, bold: false, color: { argb: "FF000000" } },
  };

  // Row 7: QTN# and Date
  const r7 = ws.getRow(7);
  r7.height = 19;
  ws.getCell("A7").value = "QTN#:";
  ws.getCell("A7").font = metaStyle.fontBold;
  ws.mergeCells("B7:C7");
  ws.getCell("B7").value = data.quoteNumber || "—";
  ws.getCell("B7").font = metaStyle.fontBold;

  ws.getCell("E7").value = "Date:";
  ws.getCell("E7").font = metaStyle.fontBold;
  ws.getCell("E7").alignment = { horizontal: "right" };
  ws.getCell("F7").value = fmtDate(data.quoteDate);
  ws.getCell("F7").font = metaStyle.fontNormal;

  // Row 8: Project
  const r8 = ws.getRow(8);
  r8.height = 19;
  ws.getCell("A8").value = "Project:";
  ws.getCell("A8").font = metaStyle.fontBold;
  ws.mergeCells("B8:D8");
  ws.getCell("B8").value = (data.projectName || "—").toUpperCase();
  ws.getCell("B8").font = metaStyle.fontNormal;

  // Row 9: Company Name & Attention
  const r9 = ws.getRow(9);
  r9.height = 19;
  ws.getCell("A9").value = "Company Name:";
  ws.getCell("A9").font = metaStyle.fontBold;
  ws.mergeCells("B9:D9");
  ws.getCell("B9").value = (data.customerName || "Customer").toUpperCase();
  ws.getCell("B9").font = metaStyle.fontNormal;

  ws.getCell("E9").value = "Attention:";
  ws.getCell("E9").font = metaStyle.fontBold;
  ws.getCell("E9").alignment = { horizontal: "right" };
  ws.getCell("F9").value = (data.contactPerson || "—").toUpperCase();
  ws.getCell("F9").font = metaStyle.fontBold;

  // Row 10: Address & Contact Number
  const r10 = ws.getRow(10);
  r10.height = 19;
  ws.getCell("A10").value = "Address:";
  ws.getCell("A10").font = metaStyle.fontBold;
  ws.mergeCells("B10:D10");
  ws.getCell("B10").value = (data.customerAddress || "N/A").toUpperCase();
  ws.getCell("B10").font = metaStyle.fontNormal;

  ws.getCell("E10").value = "Contact:";
  ws.getCell("E10").font = metaStyle.fontBold;
  ws.getCell("E10").alignment = { horizontal: "right" };
  ws.getCell("F10").value = data.contactNumber || "—";
  ws.getCell("F10").font = metaStyle.fontNormal;

  // Row 11: TIN & Email
  const r11 = ws.getRow(11);
  r11.height = 19;
  ws.getCell("A11").value = "TIN:";
  ws.getCell("A11").font = metaStyle.fontBold;
  ws.mergeCells("B11:D11");
  ws.getCell("B11").value = data.tinNumber || "N/A";
  ws.getCell("B11").font = metaStyle.fontNormal;

  ws.getCell("E11").value = "Email:";
  ws.getCell("E11").font = metaStyle.fontBold;
  ws.getCell("E11").alignment = { horizontal: "right" };
  ws.getCell("F11").value = data.email || "—";
  ws.getCell("F11").font = metaStyle.fontNormal;

  let nextRow = 12;
  if (data.remarks) {
    const rRemarks = ws.getRow(nextRow);
    rRemarks.height = 19;
    ws.getCell(`A${nextRow}`).value = "Remarks:";
    ws.getCell(`A${nextRow}`).font = metaStyle.fontBold;
    ws.mergeCells(`B${nextRow}:F${nextRow}`);
    ws.getCell(`B${nextRow}`).value = data.remarks;
    ws.getCell(`B${nextRow}`).font = metaStyle.fontNormal;
    nextRow++;
  }

  // Spacing before table
  ws.getRow(nextRow).height = 10;
  nextRow++;

  // 4. Main Quotation Table Header (Row nextRow)
  const headerRowNum = nextRow;
  const headerRow = ws.getRow(headerRowNum);
  headerRow.height = 24;

  const headers = [
    { col: "A", label: "ITEM" },
    { col: "B", label: "QTY" },
    { col: "C", label: "ITEM" },
    { col: "D", label: "MEASUREMENT" },
    { col: "E", label: "UNIT PRICE" },
    { col: "F", label: "TOTAL PRICE" },
  ];

  headers.forEach(({ col, label }) => {
    const cell = ws.getCell(`${col}${headerRowNum}`);
    cell.value = label;
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF000000" }, // Black header matching PDF
    };
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      top: { style: "thin", color: { argb: "FF000000" } },
      bottom: { style: "thin", color: { argb: "FF000000" } },
      left: { style: "thin", color: { argb: "FF000000" } },
      right: { style: "thin", color: { argb: "FF000000" } },
    };
  });

  nextRow++;

  // Attachments lookup by line item id
  const attachmentsByLineId = new Map<string, QuoteExcelAttachment[]>();
  (data.attachments || []).forEach((att) => {
    if (!att.quote_line_item_id) return;
    const list = attachmentsByLineId.get(att.quote_line_item_id) || [];
    list.push(att);
    attachmentsByLineId.set(att.quote_line_item_id, list);
  });

  // Border style for data cells
  const gridBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FF000000" } },
    bottom: { style: "thin", color: { argb: "FF000000" } },
    left: { style: "thin", color: { argb: "FF000000" } },
    right: { style: "thin", color: { argb: "FF000000" } },
  };

  // 5. Data Rows
  for (let idx = 0; idx < validLines.length; idx++) {
    const line = validLines[idx];
    const currentRow = nextRow;
    const row = ws.getRow(currentRow);

    const lineAtts = line.id ? attachmentsByLineId.get(line.id) || [] : [];
    const hasPhoto = lineAtts.length > 0 && Boolean(lineAtts[0].signedUrl || lineAtts[0].base64 || lineAtts[0].buffer);

    const itemNum = idx + 1;
    const qty = Number(line.quantity || 0);
    const desc = (line.description || "").toUpperCase();
    const measurement = formatMeasurement(line).toUpperCase();
    const unitPrice =
      line.quantity > 0 ? Number(line.line_total || 0) / qty : Number(line.unit_price || 0);
    const lineTotal = Number(line.line_total || 0);

    // Cell A: Item #
    const cellA = ws.getCell(`A${currentRow}`);
    cellA.value = itemNum;
    cellA.font = { name: "Arial", size: 10, bold: true };
    cellA.alignment = { vertical: "middle", horizontal: "center" };
    cellA.border = gridBorder;

    // Cell B: Qty
    const cellB = ws.getCell(`B${currentRow}`);
    cellB.value = qty;
    cellB.numFmt = "#,##0";
    cellB.font = { name: "Arial", size: 10, bold: true };
    cellB.alignment = { vertical: "middle", horizontal: "center" };
    cellB.border = gridBorder;

    // Cell C: Description
    const cellC = ws.getCell(`C${currentRow}`);
    cellC.value = desc;
    cellC.font = { name: "Arial", size: 10, bold: true };
    cellC.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cellC.border = gridBorder;

    // Cell D: Measurement + Photo
    const cellD = ws.getCell(`D${currentRow}`);
    cellD.value = measurement !== "N/A" ? measurement : hasPhoto ? "" : "N/A";
    cellD.font = { name: "Arial", size: 9, bold: true };
    cellD.alignment = { vertical: hasPhoto ? "top" : "middle", horizontal: "center", wrapText: true };
    cellD.border = gridBorder;

    let dynamicRowHeight = 26;

    // Embed line item photo if available - strictly maintaining normal aspect ratio!
    if (hasPhoto) {
      const att = lineAtts[0];
      const photoData = att.buffer
        ? {
            buffer: att.buffer,
            extension: "png" as const,
            ...parseImageDimensions(att.buffer),
          }
        : await loadImageData(att.signedUrl || att.base64);

      if (photoData) {
        try {
          const photoImgId = wb.addImage({
            buffer: photoData.buffer,
            extension: photoData.extension,
          });

          // Proportional scaling: max 170w x 75h, NEVER stretched
          const photoFit = fitDimensions(photoData.width, photoData.height, 170, 75);

          // Center horizontally within Column D (Col D pixel width is COL_WIDTHS_PX[3])
          const colDPx = COL_WIDTHS_PX[3];
          const leftOffsetPx = Math.max(0, (colDPx - photoFit.width) / 2);

          // Set dynamic row height to comfortably contain text and the un-stretched photo
          const photoPtHeight = Math.round(photoFit.height * 0.75);
          dynamicRowHeight = Math.max(
            30,
            photoPtHeight + (measurement !== "N/A" ? 28 : 12),
          );

          ws.addImage(photoImgId, {
            tl: {
              nativeCol: 3,
              nativeColOff: Math.round(leftOffsetPx * EMUS_PER_PX),
              nativeRow: currentRow - 1,
              nativeRowOff: Math.round((measurement !== "N/A" ? 20 : 6) * EMUS_PER_PX),
            },
            ext: { width: photoFit.width, height: photoFit.height },
            editAs: "oneCell",
          });
        } catch {
          dynamicRowHeight = 26;
        }
      }
    }

    row.height = dynamicRowHeight;

    // Cell E: Unit Price
    const cellE = ws.getCell(`E${currentRow}`);
    cellE.value = unitPrice;
    cellE.numFmt = "#,##0.00";
    cellE.font = { name: "Arial", size: 10, bold: true };
    cellE.alignment = { vertical: "middle", horizontal: "right" };
    cellE.border = gridBorder;

    // Cell F: Total Price
    const cellF = ws.getCell(`F${currentRow}`);
    cellF.value = lineTotal;
    cellF.numFmt = "#,##0.00";
    cellF.font = { name: "Arial", size: 10, bold: true };
    cellF.alignment = { vertical: "middle", horizontal: "right" };
    cellF.border = gridBorder;

    nextRow++;
  }

  // Row spacing after data table
  ws.getRow(nextRow).height = 10;
  nextRow++;

  // 6. Summary / Totals Rows
  const totalRowHeight = 22;

  // Subtotal
  const rSub = ws.getRow(nextRow);
  rSub.height = totalRowHeight;
  const subLabel = ws.getCell(`E${nextRow}`);
  subLabel.value = "SUBTOTAL";
  subLabel.font = { name: "Arial", size: 10, bold: true };
  subLabel.alignment = { vertical: "middle", horizontal: "right" };

  const subVal = ws.getCell(`F${nextRow}`);
  subVal.value = Number(data.subtotal || 0);
  subVal.numFmt = "#,##0.00";
  subVal.font = { name: "Arial", size: 10, bold: true };
  subVal.alignment = { vertical: "middle", horizontal: "right" };
  nextRow++;

  if (isVatable) {
    // VATable Sales
    const rVatSales = ws.getRow(nextRow);
    rVatSales.height = totalRowHeight;
    const vsLabel = ws.getCell(`E${nextRow}`);
    vsLabel.value = "VATABLE SALES";
    vsLabel.font = { name: "Arial", size: 10, bold: true };
    vsLabel.alignment = { vertical: "middle", horizontal: "right" };

    const vsVal = ws.getCell(`F${nextRow}`);
    vsVal.value = vat.vatableSales;
    vsVal.numFmt = "#,##0.00";
    vsVal.font = { name: "Arial", size: 10, bold: true };
    vsVal.alignment = { vertical: "middle", horizontal: "right" };
    nextRow++;

    // VAT
    const rVat = ws.getRow(nextRow);
    rVat.height = totalRowHeight;
    const vatLabel = ws.getCell(`E${nextRow}`);
    vatLabel.value = "VAT (12%)";
    vatLabel.font = { name: "Arial", size: 10, bold: true };
    vatLabel.alignment = { vertical: "middle", horizontal: "right" };

    const vatVal = ws.getCell(`F${nextRow}`);
    vatVal.value = vat.vat;
    vatVal.numFmt = "#,##0.00";
    vatVal.font = { name: "Arial", size: 10, bold: true };
    vatVal.alignment = { vertical: "middle", horizontal: "right" };
    nextRow++;
  }

  // Total Row (with accounting top single & bottom double borders)
  const rTotal = ws.getRow(nextRow);
  rTotal.height = 24;
  const totLabel = ws.getCell(`E${nextRow}`);
  totLabel.value = "TOTAL";
  totLabel.font = { name: "Arial", size: 11, bold: true };
  totLabel.alignment = { vertical: "middle", horizontal: "right" };
  totLabel.border = {
    top: { style: "thin", color: { argb: "FF000000" } },
    bottom: { style: "double", color: { argb: "FF000000" } },
  };

  const totVal = ws.getCell(`F${nextRow}`);
  totVal.value = totalAmount;
  totVal.numFmt = "#,##0.00";
  totVal.font = { name: "Arial", size: 11, bold: true };
  totVal.alignment = { vertical: "middle", horizontal: "right" };
  totVal.border = {
    top: { style: "thin", color: { argb: "FF000000" } },
    bottom: { style: "double", color: { argb: "FF000000" } },
  };
  nextRow++;

  // Spacing before Terms
  ws.getRow(nextRow).height = 14;
  nextRow++;

  // 7. Terms Section
  const defaultTerms = "FULL PAYMENT DUE WITHIN 30 DAYS AFTER INVOICE.";
  const termsText = (data.terms || defaultTerms).toUpperCase();
  ws.getCell(`A${nextRow}`).value = "TERMS:";
  ws.getCell(`A${nextRow}`).font = { name: "Arial", size: 10, bold: true };
  nextRow++;

  ws.mergeCells(`A${nextRow}:F${nextRow}`);
  const termsCell = ws.getCell(`A${nextRow}`);
  termsCell.value = termsText;
  termsCell.font = { name: "Arial", size: 9, bold: false };
  termsCell.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(nextRow).height = Math.max(22, Math.ceil(termsText.length / 70) * 16);
  nextRow++;

  // Remarks Section (if provided)
  if (data.remarks) {
    ws.getRow(nextRow).height = 10;
    nextRow++;
    ws.getCell(`A${nextRow}`).value = "REMARKS:";
    ws.getCell(`A${nextRow}`).font = { name: "Arial", size: 10, bold: true };
    nextRow++;

    ws.mergeCells(`A${nextRow}:F${nextRow}`);
    const remarksCell = ws.getCell(`A${nextRow}`);
    remarksCell.value = data.remarks;
    remarksCell.font = { name: "Arial", size: 9, bold: false };
    remarksCell.alignment = { wrapText: true, vertical: "top" };
    ws.getRow(nextRow).height = Math.max(22, Math.ceil(data.remarks.length / 70) * 16);
    nextRow++;
  }

  // Spacing before Signatures
  ws.getRow(nextRow).height = 20;
  nextRow++;

  // 8. Signatures Block
  const sigHeaderRow = nextRow;
  ws.getCell(`A${sigHeaderRow}`).value = "APPROVED BY:";
  ws.getCell(`A${sigHeaderRow}`).font = { name: "Arial", size: 10, bold: true };

  ws.getCell(`D${sigHeaderRow}`).value = "CONFORME:";
  ws.getCell(`D${sigHeaderRow}`).font = { name: "Arial", size: 10, bold: true };
  nextRow++;

  // Signature image space (Row nextRow)
  const sigSpaceRow = nextRow;
  let sigSpaceHeight = 36;

  // Embed sales agent signature if provided - maintaining normal proportions!
  if (data.approvedBySignatureUrl) {
    const sigData = await loadImageData(data.approvedBySignatureUrl);
    if (sigData) {
      try {
        const sigImgId = wb.addImage({
          buffer: sigData.buffer,
          extension: sigData.extension,
        });

        // Proportional fit: max 140w x 42h, NEVER stretched
        const sigFit = fitDimensions(sigData.width, sigData.height, 140, 42);

        // Center inside Columns A-C (total width COL_WIDTHS_PX[0]+[1]+[2])
        const colsACWidthPx = COL_WIDTHS_PX[0] + COL_WIDTHS_PX[1] + COL_WIDTHS_PX[2];
        const sigLeftPx = Math.max(0, colsACWidthPx / 2 - sigFit.width / 2);
        const sigAnchor = getAnchorFromPixelX(sigLeftPx);

        sigSpaceHeight = Math.max(36, Math.round(sigFit.height * 0.75 + 10));

        ws.addImage(sigImgId, {
          tl: {
            nativeCol: sigAnchor.nativeCol,
            nativeColOff: sigAnchor.nativeColOff,
            nativeRow: sigSpaceRow - 1,
            nativeRowOff: 45000,
          },
          ext: { width: sigFit.width, height: sigFit.height },
          editAs: "oneCell",
        });
      } catch {
        sigSpaceHeight = 36;
      }
    }
  }

  ws.getRow(sigSpaceRow).height = sigSpaceHeight;
  nextRow++;

  // Signature line row (underline)
  const sigLineRow = nextRow;
  ws.getRow(sigLineRow).height = 6;
  ["A", "B", "C"].forEach((col) => {
    ws.getCell(`${col}${sigLineRow}`).border = {
      bottom: { style: "thin", color: { argb: "FF000000" } },
    };
  });
  ["D", "E", "F"].forEach((col) => {
    ws.getCell(`${col}${sigLineRow}`).border = {
      bottom: { style: "thin", color: { argb: "FF000000" } },
    };
  });
  nextRow++;

  // Signer names row
  const sigNameRow = nextRow;
  ws.getRow(sigNameRow).height = 18;
  ws.getCell(`A${sigNameRow}`).value = (data.salesAgent || "Sales Representative").toUpperCase();
  ws.getCell(`A${sigNameRow}`).font = { name: "Arial", size: 10, bold: true };

  const customerSigner = (
    data.contactPerson ||
    data.customerName ||
    "Customer"
  ).toUpperCase();
  ws.getCell(`D${sigNameRow}`).value = customerSigner;
  ws.getCell(`D${sigNameRow}`).font = { name: "Arial", size: 10, bold: true };
  nextRow++;

  // Signer titles/subtitles row
  const sigTitleRow = nextRow;
  ws.getRow(sigTitleRow).height = 16;
  ws.getCell(`A${sigTitleRow}`).value = "SALES REPRESENTATIVE";
  ws.getCell(`A${sigTitleRow}`).font = { name: "Arial", size: 9, bold: false };

  ws.getCell(`D${sigTitleRow}`).value = (data.customerName || "Customer").toUpperCase();
  ws.getCell(`D${sigTitleRow}`).font = { name: "Arial", size: 9, bold: false };

  return wb;
}

export async function downloadQuoteExcel(data: QuoteExcelExportPayload): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const wb = await buildQuoteWorkbook(data);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);

  const safeNumber = (data.quoteNumber || "quotation").replace(/[^a-zA-Z0-9_\-]/g, "_");
  const safeProject = (data.projectName || "").replace(/[^a-zA-Z0-9_\-]/g, "_").trim();
  const filename = safeProject ? `${safeNumber}-${safeProject}.xlsx` : `${safeNumber}.xlsx`;

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
