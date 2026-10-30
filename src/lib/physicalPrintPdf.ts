import { jsPDF } from "jspdf";
import { addTemplateBackground } from "./preprintedPdf";
import { amountToPesoWords } from "./amountWords";

function fmtDate(date: unknown) {
  if (!date) return "";
  const d = new Date(date as string | number | Date);
  if (isNaN(d.getTime())) return String(date);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtMoney(num: unknown) {
  if (num === null || num === undefined || isNaN(Number(num))) return "";
  return Number(num).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// =========================================================================
// 1. DELIVERY RECEIPT (Exact match to scripts/print-delivery-receipt.mjs)
// =========================================================================
export const DR_LAYOUT_CONFIG = {
  paper: {
    widthIn: 5.5,
    heightIn: 8.5,
  },
  globalOffset: {
    topIn: -0.08,
    leftIn: 0.0,
  },
  header: {
    deliveredTo: { topIn: 2.42, leftIn: 1.5, maxWidthIn: 2.1 },
    date: { topIn: 2.39, leftIn: 4.25 },
    tin: { topIn: 2.61, leftIn: 0.65, maxWidthIn: 2.5 },
    terms: { topIn: 2.61, leftIn: 4.08 },
    address: { topIn: 2.79, leftIn: 1.15, maxWidthIn: 2.3 },
    poNo: { topIn: 2.83, leftIn: 4.25 },
    businessStyle: { topIn: 3.05, leftIn: 1.55, maxWidthIn: 3.4 },
  },
  items: {
    headerTopIn: 3.7,
    startTopIn: 3.92,
    rowStepIn: 0.32,
    maxRows: 7,
    columns: {
      qtyAndUnit: { leftIn: 0.45, align: "left" as const },
      description: { leftIn: 1.2, align: "left" as const, maxWidthIn: 2.15 },
      unitPrice: { leftIn: 4.05, align: "right" as const },
      amount: { leftIn: 4.68, align: "center" as const },
    },
    total: {
      topIn: 6.85,
      leftIn: 4.68,
      align: "center" as const,
    },
  },
};

export async function generateDeliveryReceiptPdf(
  data: any,
  config = DR_LAYOUT_CONFIG,
  _printerModel = "standard",
  templateUrl = "/templates/delivery-receipt-template.jpg",
  calibration?: { page?: { xMm?: number; yMm?: number } },
) {
  let effectiveConfig = config;
  if (calibration?.page) {
    const xIn = (Number(calibration.page.xMm) || 0) / 25.4;
    const yIn = (Number(calibration.page.yMm) || 0) / 25.4;
    effectiveConfig = {
      ...config,
      globalOffset: {
        topIn: (config.globalOffset?.topIn || 0) + yIn,
        leftIn: (config.globalOffset?.leftIn || 0) + xIn,
      },
    };
  }

  const widthPt = effectiveConfig.paper.widthIn * 72;
  const heightPt = effectiveConfig.paper.heightIn * 72;

  const doc = new jsPDF({
    unit: "pt",
    format: [widthPt, heightPt],
    orientation: "portrait",
  });
  (doc as any).__calibrated = true;

  if (templateUrl) {
    await addTemplateBackground(doc, templateUrl, widthPt, heightPt);
  }

  const drawText = (
    text: unknown,
    topIn: number,
    leftIn: number,
    { align = "left" as "left" | "right" | "center", size = 9, fontStyle = "normal" as "normal" | "bold" } = {},
  ) => {
    if (!text && text !== 0) return;
    const finalTopPt = (topIn + effectiveConfig.globalOffset.topIn) * 72;
    const finalLeftPt = (leftIn + effectiveConfig.globalOffset.leftIn) * 72;

    doc.setFontSize(size);
    doc.setFont("helvetica", fontStyle);
    doc.setTextColor(0, 0, 0);
    doc.text(String(text), finalLeftPt, finalTopPt, { align, baseline: "alphabetic" });
  };

  const customer = data.customer || {};
  const quote = data.quotation || {};

  drawText(
    customer.customer_name || data.customer_name,
    config.header.deliveredTo.topIn,
    config.header.deliveredTo.leftIn,
    { size: 9.5, fontStyle: "bold" },
  );
  drawText(
    fmtDate(data.delivered_at || data.receiptDate || new Date()),
    config.header.date.topIn,
    config.header.date.leftIn,
    { size: 9 },
  );
  drawText(customer.tin_number, config.header.tin.topIn, config.header.tin.leftIn, { size: 9 });
  drawText(quote.terms || data.terms, config.header.terms.topIn, config.header.terms.leftIn, { size: 8.5 });

  if (customer.address) {
    const maxAddrWidthPt = (config.header.address.maxWidthIn || 2.3) * 72;
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    const addrLines = (doc.splitTextToSize(String(customer.address), maxAddrWidthPt) as string[]) || [];
    if (addrLines.length <= 1) {
      drawText(customer.address, config.header.address.topIn, config.header.address.leftIn, { size: 8 });
    } else {
      drawText(addrLines[0], config.header.address.topIn - 0.03, config.header.address.leftIn, { size: 7.2 });
      drawText(addrLines[1], config.header.address.topIn + 0.08, config.header.address.leftIn, { size: 7.2 });
    }
  }

  const showPo = data.includePo !== false && data.showPo !== false && !data.hidePo;
  if (showPo) {
    drawText(
      data.client_po_number || data.clientPoNumber || quote.quote_number || data.quoteNumber,
      config.header.poNo.topIn,
      config.header.poNo.leftIn,
      { size: 9 },
    );
  }
  drawText(
    customer.business_style || "",
    config.header.businessStyle.topIn,
    config.header.businessStyle.leftIn,
    { size: 8.5 },
  );

  const isPriced =
    data.priced !== false &&
    String(data.priced).toLowerCase() !== "false" &&
    data.withPrices !== false;
  const headerTopIn = config.items.headerTopIn || 3.7;
  drawText("QTY", headerTopIn, config.items.columns.qtyAndUnit.leftIn, { size: 8, fontStyle: "bold" });
  drawText("ITEM", headerTopIn, config.items.columns.description.leftIn, { size: 8, fontStyle: "bold" });
  if (isPriced) {
    drawText("UNITPRICE", headerTopIn, config.items.columns.unitPrice.leftIn, {
      align: "right",
      size: 8,
      fontStyle: "bold",
    });
    drawText("TOTAL", headerTopIn, config.items.columns.amount.leftIn, {
      align: config.items.columns.amount.align || "center",
      size: 8,
      fontStyle: "bold",
    });
  }

  let currentTopIn = config.items.startTopIn || 3.92;
  const projectName = data.project_name || data.projectName;
  if (projectName) {
    drawText(String(projectName).toUpperCase(), currentTopIn, config.items.columns.description.leftIn, {
      size: 8,
      fontStyle: "bold",
    });
    currentTopIn += 0.2;
  }

  const lines = (data.lines || []).slice(0, config.items.maxRows || 7);
  let grandTotal = 0;
  const maxDescWidthPt = (config.items.columns.description.maxWidthIn || 2.15) * 72;

  lines.forEach((line: any) => {
    const qtyUnit = `${line.quantity || ""} ${line.unit_of_measure || line.unit || "PCS"}`.trim();
    const unitPrice = line.unit_price ? fmtMoney(line.unit_price) : "";
    const lineTotal = line.line_total ? fmtMoney(line.line_total) : "";
    grandTotal += Number(line.line_total || 0);

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    const descLines = (doc.splitTextToSize(String(line.description || ""), maxDescWidthPt) as string[]) || [];

    drawText(qtyUnit, currentTopIn, config.items.columns.qtyAndUnit.leftIn, { size: 8 });
    if (isPriced && unitPrice) {
      drawText(unitPrice, currentTopIn, config.items.columns.unitPrice.leftIn, { align: "right", size: 8 });
    }
    if (isPriced && lineTotal) {
      drawText(lineTotal, currentTopIn, config.items.columns.amount.leftIn, {
        align: config.items.columns.amount.align || "center",
        size: 8.5,
        fontStyle: "bold",
      });
    }

    descLines.forEach((dLine, dIdx) => {
      drawText(dLine, currentTopIn + dIdx * 0.13, config.items.columns.description.leftIn, { size: 8 });
    });

    currentTopIn += Math.max(descLines.length * 0.13, config.items.rowStepIn || 0.32);
  });

  if (isPriced && grandTotal > 0) {
    drawText(fmtMoney(grandTotal), config.items.total.topIn, config.items.total.leftIn, {
      align: config.items.total.align || "center",
      size: 9.5,
      fontStyle: "bold",
    });
  }

  return doc;
}

// =========================================================================
// 2. SERVICE INVOICE (Exact match to scripts/print-delivery-receipt.mjs)
// =========================================================================
export const SI_LAYOUT_CONFIG = {
  paper: {
    widthIn: 15 / 2.54, // ~5.9055"
    heightIn: 20 / 2.54, // ~7.8740"
  },
  globalOffset: {
    topIn: -0.09,
    leftIn: -0.05,
  },
  header: {
    date: { topIn: 1.5625, rightIn: 0.55 },
    soldTo: { topIn: 1.75, leftIn: 1.38, maxWidthIn: 4.1 },
    registeredName: { topIn: 2.02, leftIn: 1.38, maxWidthIn: 2.05 }, // Row 2 Left: Project Name field (bounded to 2.05" so it doesn't overlap PO)
    poNo: { topIn: 2.02, leftIn: 3.55, maxWidthIn: 2.0 }, // Row 2 Right: CE/P.O NO: label at 3.55", red number at 4.38"
    tin: { topIn: 2.24, leftIn: 1.38, maxWidthIn: 2.2 },
    businessAddress: { topIn: 2.47, leftIn: 1.38, maxWidthIn: 3.9 },
  },
  items: {
    startTopIn: 2.88,
    rowStepIn: 0.2,
    maxRows: 12,
    columns: {
      description: { leftIn: 0.42, maxWidthIn: 2.70 },
      qty: { leftIn: 3.55, align: "right" as const },
      unitPrice: { leftIn: 4.40, align: "right" as const },
      amount: { leftIn: 5.52, align: "right" as const },
    },
  },
  totals: {
    startTopIn: 5.5,
    rowStepIn: 0.2,
    columns: {
      summaryLeft: { leftIn: 1.95, align: "right" as const },
      summaryRight: { leftIn: 5.52, align: "right" as const },
    },
  },
};

export async function generateServiceInvoicePdf(
  data: any,
  config = SI_LAYOUT_CONFIG,
  _printerModel = "standard",
  templateUrl = "/templates/service-invoice-template.jpg",
  calibration?: { page?: { xMm?: number; yMm?: number } },
) {
  let effectiveConfig = config;
  if (calibration?.page) {
    const xIn = (Number(calibration.page.xMm) || 0) / 25.4;
    const yIn = (Number(calibration.page.yMm) || 0) / 25.4;
    effectiveConfig = {
      ...config,
      globalOffset: {
        topIn: (config.globalOffset?.topIn || 0) + yIn,
        leftIn: (config.globalOffset?.leftIn || 0) + xIn,
      },
    };
  }

  const widthPt = effectiveConfig.paper.widthIn * 72;
  const heightPt = effectiveConfig.paper.heightIn * 72;

  const doc = new jsPDF({
    unit: "pt",
    format: [widthPt, heightPt],
    orientation: "portrait",
  });
  (doc as any).__calibrated = true;

  if (templateUrl) {
    await addTemplateBackground(doc, templateUrl, widthPt, heightPt);
  }

  const drawText = (
    text: unknown,
    topIn: number,
    leftIn: number,
    { align = "left" as "left" | "right" | "center", size = 9, fontStyle = "normal" as "normal" | "bold" } = {},
  ) => {
    if (!text && text !== 0) return;
    const finalTopPt = (topIn + effectiveConfig.globalOffset.topIn) * 72;
    const finalLeftPt = (leftIn + effectiveConfig.globalOffset.leftIn) * 72;

    doc.setFontSize(size);
    doc.setFont("helvetica", fontStyle);
    doc.setTextColor(0, 0, 0);
    doc.text(String(text), finalLeftPt, finalTopPt, { align, baseline: "alphabetic" });
  };

  const customer = data.customer || {};
  const dateStr = fmtDate(data.invoice_date || data.invoiceDate || new Date());
  const lines = (data.lines || []).slice(0, config.items.maxRows || 6);

  const dateLeftIn = config.paper.widthIn - (config.header.date.rightIn || 0.49);
  drawText(dateStr, config.header.date.topIn, dateLeftIn, { align: "right", size: 9 });

  const custName = customer.customer_name || customer.customerName || data.customer_name || "";
  drawText(custName, config.header.soldTo.topIn, config.header.soldTo.leftIn, { size: 9, fontStyle: "bold" });

  // Row 2 Left (Registered Name pre-printed row): Used for Project Name, with 2-line wrap bounded to 2.05"
  const projectName =
    data.project_name ||
    data.projectName ||
    data.job?.project_name ||
    data.quotation?.project_name ||
    customer.registered_name ||
    "";
  if (projectName) {
    const maxProjWidthPt = (config.header.registeredName.maxWidthIn || 2.05) * 72;
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    const projLines = (doc.splitTextToSize(String(projectName), maxProjWidthPt) as string[]) || [];
    if (projLines.length <= 1) {
      drawText(projectName, config.header.registeredName.topIn, config.header.registeredName.leftIn, { size: 8, fontStyle: "bold" });
    } else {
      drawText(projLines[0], config.header.registeredName.topIn - 0.045, config.header.registeredName.leftIn, { size: 7.2, fontStyle: "bold" });
      drawText(projLines[1], config.header.registeredName.topIn + 0.045, config.header.registeredName.leftIn, { size: 7.2, fontStyle: "bold" });
    }
  }

  // Row 2 Right: CE/P.O NO: (label black bold, number RED bold)
  const po = String(data.client_po_number || data.clientPoNumber || "").trim();
  if (po) {
    drawText("CE/P.O NO:", config.header.poNo.topIn, config.header.poNo.leftIn, { size: 8.5, fontStyle: "bold" });
    const finalTopPt = (config.header.poNo.topIn + effectiveConfig.globalOffset.topIn) * 72;
    const poNumLeftIn = 4.38;
    const finalLeftPt = (poNumLeftIn + effectiveConfig.globalOffset.leftIn) * 72;
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(220, 38, 38);
    doc.text(po, finalLeftPt, finalTopPt, { align: "left", baseline: "alphabetic" });
    doc.setTextColor(0, 0, 0);
  }

  const tin = customer.tin_number || customer.tinNumber || data.tin_number || "";
  drawText(tin, config.header.tin.topIn, config.header.tin.leftIn, { size: 9 });

  const addr = customer.address || data.address || "";
  if (addr) {
    const maxAddrWidthPt = (config.header.businessAddress.maxWidthIn || 3.9) * 72;
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    const addrLines = (doc.splitTextToSize(String(addr), maxAddrWidthPt) as string[]) || [];
    if (addrLines.length <= 1) {
      drawText(addr, config.header.businessAddress.topIn, config.header.businessAddress.leftIn, { size: 7.5 });
    } else if (addrLines.length === 2) {
      drawText(addrLines[0], config.header.businessAddress.topIn - 0.05, config.header.businessAddress.leftIn, { size: 7.2 });
      drawText(addrLines[1], config.header.businessAddress.topIn + 0.05, config.header.businessAddress.leftIn, { size: 7.2 });
    } else {
      drawText(addrLines[0], config.header.businessAddress.topIn - 0.07, config.header.businessAddress.leftIn, { size: 6.8 });
      drawText(addrLines[1], config.header.businessAddress.topIn + 0.03, config.header.businessAddress.leftIn, { size: 6.8 });
      drawText(addrLines[2], config.header.businessAddress.topIn + 0.13, config.header.businessAddress.leftIn, { size: 6.8 });
    }
  }

  const maxDescWidthPt = (config.items.columns.description.maxWidthIn || 2.70) * 72;

  lines.forEach((line: any, idx: number) => {
    const rowTopIn = config.items.startTopIn + idx * (config.items.rowStepIn || 0.2);
    const desc = (line.description || "").trim();
    const qty = line.quantity !== undefined ? String(line.quantity) : "";
    const unitPrice = line.unit_price || line.unitPrice ? fmtMoney(line.unit_price || line.unitPrice) : "";
    const lineTotal = line.line_total || line.lineTotal ? fmtMoney(line.line_total || line.lineTotal) : "";

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    const singleLineWidth = doc.getTextWidth(desc);

    if (singleLineWidth <= maxDescWidthPt) {
      drawText(desc, rowTopIn, config.items.columns.description.leftIn, { size: 8.5 });
    } else if (doc.setFontSize(6.5), doc.getTextWidth(desc) <= maxDescWidthPt) {
      drawText(desc, rowTopIn, config.items.columns.description.leftIn, { size: 6.5 });
    } else {
      doc.setFontSize(6.0);
      const descLines = (doc.splitTextToSize(desc, maxDescWidthPt) as string[]) || [];
      if (descLines.length <= 1) {
        drawText(desc, rowTopIn, config.items.columns.description.leftIn, { size: 6.0 });
      } else {
        const line1 = descLines[0];
        const remaining = descLines.slice(1).join(" ");
        const splitRemaining = (doc.splitTextToSize(remaining, maxDescWidthPt) as string[]) || [];
        const line2 = splitRemaining[0] || remaining;

        drawText(line1, rowTopIn - 0.055, config.items.columns.description.leftIn, { size: 6.0 });
        drawText(line2, rowTopIn + 0.018, config.items.columns.description.leftIn, { size: 6.0 });
      }
    }

    if (qty) drawText(qty, rowTopIn, config.items.columns.qty.leftIn, { align: "right", size: 8.5 });
    if (unitPrice) drawText(unitPrice, rowTopIn, config.items.columns.unitPrice.leftIn, { align: "right", size: 8.5 });
    if (lineTotal) drawText(lineTotal, rowTopIn, config.items.columns.amount.leftIn, { align: "right", size: 8.5, fontStyle: "bold" });
  });

  const grossTotal = Number(data.gross_total_snapshot ?? data.grossTotal ?? data.invoice_amount ?? data.invoiceAmount ?? 0);
  const isVatable = data.tax_type === "vatable" || data.taxType === "vatable";
  const rawVatable = Number(data.vatable_sales_snapshot ?? data.vatableSales ?? 0);
  const vatableSales = rawVatable > 0 ? rawVatable : isVatable ? Math.round((grossTotal / 1.12) * 100) / 100 : grossTotal;
  const rawVat = Number(data.vat_amount_snapshot ?? data.vatAmount ?? 0);
  const vatAmount = rawVat > 0 ? rawVat : isVatable ? Math.round((grossTotal - vatableSales) * 100) / 100 : 0;

  const includeEwt = Boolean(data.includeEwt || data.include_ewt || (data.ewtEnabled && (data.ewtAmount || data.ewt_amount_snapshot)));
  const rate = Number(data.ewtRate || data.ewt_rate || 0.02) || 0.02;
  const rawEwt = Number(data.ewtAmount ?? data.ewt_amount_snapshot ?? 0);
  const calculatedEwt = includeEwt ? rawEwt > 0 ? rawEwt : Math.round(vatableSales * rate * 100) / 100 : 0;
  const showEwt = includeEwt && calculatedEwt > 0;
  const finalAmountDue = showEwt ? Math.max(grossTotal - calculatedEwt, 0) : Number(data.amount_due_snapshot ?? data.amountDue ?? grossTotal);

  const step = config.totals.rowStepIn || 0.2;
  const totalSalesTop = config.totals.startTopIn;
  const lessVatTop = config.totals.startTopIn + step;
  const netOfVatTop = config.totals.startTopIn + step * 2;
  const addVatTop = config.totals.startTopIn + step * 4;
  const lessWithholdingTop = config.totals.startTopIn + step * 5;
  const totalAmountDueTop = config.totals.startTopIn + step * 6;

  if (isVatable) {
    drawText(fmtMoney(grossTotal), totalSalesTop, config.totals.columns.summaryRight.leftIn, { align: "right", size: 8.5 });
    drawText(fmtMoney(vatAmount), lessVatTop, config.totals.columns.summaryRight.leftIn, { align: "right", size: 8.5 });
    drawText(fmtMoney(vatableSales), netOfVatTop, config.totals.columns.summaryRight.leftIn, { align: "right", size: 8.5 });
    drawText(fmtMoney(vatAmount), addVatTop, config.totals.columns.summaryRight.leftIn, { align: "right", size: 8.5 });
    drawText(fmtMoney(vatableSales), totalSalesTop, config.totals.columns.summaryLeft.leftIn, { align: "right", size: 8.5 });
    drawText(fmtMoney(vatAmount), lessVatTop, config.totals.columns.summaryLeft.leftIn, { align: "right", size: 8.5 });
  } else {
    drawText(fmtMoney(grossTotal), totalSalesTop, config.totals.columns.summaryRight.leftIn, { align: "right", size: 8.5 });
    drawText(fmtMoney(grossTotal), netOfVatTop, config.totals.columns.summaryRight.leftIn, { align: "right", size: 8.5 });
    drawText(fmtMoney(grossTotal), config.totals.startTopIn + step * 3, config.totals.columns.summaryLeft.leftIn, { align: "right", size: 8.5 });
  }

  if (showEwt) {
    drawText(fmtMoney(calculatedEwt), lessWithholdingTop, config.totals.columns.summaryRight.leftIn, { align: "right", size: 8.5 });
  }

  drawText(fmtMoney(finalAmountDue), totalAmountDueTop, config.totals.columns.summaryRight.leftIn, {
    align: "right",
    size: 10,
    fontStyle: "bold",
  });

  return doc;
}

// =========================================================================
// 3. CHECK VOUCHER (Exact match to scripts/print-delivery-receipt.mjs)
// =========================================================================
export const CV_LAYOUT_CONFIG = {
  paper: {
    widthIn: 210 / 25.4, // ~8.2677" (A5 Landscape)
    heightIn: 148 / 25.4, // ~5.8268"
  },
  globalOffset: {
    topIn: 0.0,
    leftIn: 0.0,
  },
  fields: {
    date: { topIn: 1.45, leftIn: 6.85, maxWidthIn: 1.85, fontSize: 10, fontStyle: "bold" as const, align: "center" as const },
    payee: { topIn: 1.85, leftIn: 1.15, maxWidthIn: 3.95, fontSize: 10.5, fontStyle: "bold" as const, align: "left" as const },
    particulars: { topIn: 2.92, leftIn: 0.50, maxWidthIn: 5.10, fontSize: 9.5, fontStyle: "bold" as const, align: "left" as const },
    columns: {
      checkDate: {
        header: { topIn: 3.55, leftIn: 1.20, fontSize: 9, fontStyle: "bold" as const, align: "center" as const },
        value: { topIn: 3.75, leftIn: 1.20, fontSize: 9.5, fontStyle: "bold" as const, align: "center" as const },
      },
      documentNo: {
        header: { topIn: 3.55, leftIn: 2.90, fontSize: 9, fontStyle: "bold" as const, align: "center" as const },
        value: { topIn: 3.75, leftIn: 2.90, fontSize: 10, fontStyle: "bold" as const, align: "center" as const },
      },
      checkNo: {
        header: { topIn: 3.55, leftIn: 4.60, fontSize: 9, fontStyle: "bold" as const, align: "center" as const },
        value: { topIn: 3.75, leftIn: 4.60, fontSize: 10, fontStyle: "bold" as const, align: "center" as const },
      },
    },
    amount: {
      row1: { topIn: 3.10, leftIn: 7.45, fontSize: 10, fontStyle: "bold" as const, align: "right" as const },
      line1: { topIn: 3.16, left1In: 6.55, left2In: 7.45 },
      row2: { topIn: 3.32, leftIn: 7.45, fontSize: 10, fontStyle: "bold" as const, align: "right" as const },
      doubleUnderline: { topIn1: 3.37, topIn2: 3.40, left1In: 6.55, left2In: 7.45 },
    },
    signatures: {
      preparedBy: { topIn: 5.62, leftIn: 1.33, fontSize: 10, fontStyle: "bold" as const, align: "center" as const },
      certifiedCorrectBy: { topIn: 5.62, leftIn: 4.60, fontSize: 10, fontStyle: "bold" as const, align: "center" as const },
      receivedBy: { topIn: 5.62, leftIn: 7.20, fontSize: 10, fontStyle: "bold" as const, align: "center" as const },
    },
  },
};

export async function generateCheckVoucherPdf(
  data: any,
  config = CV_LAYOUT_CONFIG,
  _printerModel = "standard",
  templateUrl = "/templates/check-voucher-template.jpg",
  calibration?: { page?: { xMm?: number; yMm?: number } },
) {
  let effectiveConfig = config;
  if (calibration?.page) {
    const xIn = (Number(calibration.page.xMm) || 0) / 25.4;
    const yIn = (Number(calibration.page.yMm) || 0) / 25.4;
    effectiveConfig = {
      ...config,
      globalOffset: {
        topIn: (config.globalOffset?.topIn || 0) + yIn,
        leftIn: (config.globalOffset?.leftIn || 0) + xIn,
      },
    };
  }

  const widthPt = effectiveConfig.paper.widthIn * 72;
  const heightPt = effectiveConfig.paper.heightIn * 72;

  const doc = new jsPDF({
    unit: "pt",
    format: [widthPt, heightPt],
    orientation: "landscape",
  });
  (doc as any).__calibrated = true;

  if (templateUrl) {
    await addTemplateBackground(doc, templateUrl, widthPt, heightPt);
  }

  const drawText = (
    text: unknown,
    topIn: number,
    leftIn: number,
    { align = "left" as "left" | "right" | "center", size = 9.5, fontStyle = "normal" as "normal" | "bold", maxWidthIn = 0 } = {},
  ) => {
    if (!text && text !== 0) return;
    const finalTopPt = (topIn + effectiveConfig.globalOffset.topIn) * 72;
    const finalLeftPt = (leftIn + effectiveConfig.globalOffset.leftIn) * 72;

    doc.setFont("helvetica", fontStyle);
    doc.setTextColor(0, 0, 0);

    let currentSize = size;
    if (maxWidthIn > 0) {
      doc.setFontSize(currentSize);
      const maxPt = maxWidthIn * 72;
      while (doc.getTextWidth(String(text)) > maxPt && currentSize > 5.5) {
        currentSize -= 0.5;
        doc.setFontSize(currentSize);
      }
    } else {
      doc.setFontSize(currentSize);
    }

    doc.text(String(text), finalLeftPt, finalTopPt, { align, baseline: "alphabetic" });
  };

  const drawLine = (topIn: number, left1In: number, left2In: number, lineWidth = 0.65) => {
    const yPt = (topIn + effectiveConfig.globalOffset.topIn) * 72;
    const x1Pt = (left1In + effectiveConfig.globalOffset.leftIn) * 72;
    const x2Pt = (left2In + effectiveConfig.globalOffset.leftIn) * 72;
    doc.setLineWidth(lineWidth);
    doc.setDrawColor(0, 0, 0);
    doc.line(x1Pt, yPt, x2Pt, yPt);
  };

  const f = effectiveConfig.fields;
  const dateStr = fmtDate(data.check_date || data.paid_at || data.expense_date || data.date || new Date());
  drawText(dateStr, f.date.topIn, f.date.leftIn, { size: f.date.fontSize, fontStyle: f.date.fontStyle, align: f.date.align });

  const payee = String(data.supplier_name || data.payee || "").replace(/\*/g, "").trim();
  drawText(payee, f.payee.topIn, f.payee.leftIn, {
    size: f.payee.fontSize,
    fontStyle: f.payee.fontStyle,
    align: f.payee.align,
    maxWidthIn: f.payee.maxWidthIn,
  });

  const particulars = data.description || data.particulars || "";
  drawText(particulars, f.particulars.topIn, f.particulars.leftIn, {
    size: f.particulars.fontSize,
    fontStyle: f.particulars.fontStyle,
    align: f.particulars.align,
    maxWidthIn: f.particulars.maxWidthIn,
  });

  // Columns inside Particulars
  const checkDateVal = data.check_date ? fmtDate(data.check_date) : data.checkDate || "";
  const docNoVal = data.supplier_document_no || data.documentNo || "";
  const checkNoVal = data.check_number || data.checkNo || "";

  drawText("CHECK DATE", f.columns.checkDate.header.topIn, f.columns.checkDate.header.leftIn, {
    size: f.columns.checkDate.header.fontSize,
    fontStyle: f.columns.checkDate.header.fontStyle,
    align: f.columns.checkDate.header.align,
  });
  if (checkDateVal) {
    drawText(checkDateVal, f.columns.checkDate.value.topIn, f.columns.checkDate.value.leftIn, {
      size: f.columns.checkDate.value.fontSize,
      fontStyle: f.columns.checkDate.value.fontStyle,
      align: f.columns.checkDate.value.align,
    });
  }

  drawText("DR/INVOICE NUMBER", f.columns.documentNo.header.topIn, f.columns.documentNo.header.leftIn, {
    size: f.columns.documentNo.header.fontSize,
    fontStyle: f.columns.documentNo.header.fontStyle,
    align: f.columns.documentNo.header.align,
  });
  if (docNoVal && docNoVal !== "-") {
    drawText(docNoVal, f.columns.documentNo.value.topIn, f.columns.documentNo.value.leftIn, {
      size: f.columns.documentNo.value.fontSize,
      fontStyle: f.columns.documentNo.value.fontStyle,
      align: f.columns.documentNo.value.align,
    });
  }

  drawText("CHECK NUMBER", f.columns.checkNo.header.topIn, f.columns.checkNo.header.leftIn, {
    size: f.columns.checkNo.header.fontSize,
    fontStyle: f.columns.checkNo.header.fontStyle,
    align: f.columns.checkNo.header.align,
  });
  if (checkNoVal && checkNoVal !== "-") {
    drawText(checkNoVal, f.columns.checkNo.value.topIn, f.columns.checkNo.value.leftIn, {
      size: f.columns.checkNo.value.fontSize,
      fontStyle: f.columns.checkNo.value.fontStyle,
      align: f.columns.checkNo.value.align,
    });
  }

  // Amount & Underlines
  const amt = data.amount
    ? typeof data.amount === "number"
      ? fmtMoney(data.amount)
      : String(data.amount)
    : "";
  if (amt) {
    drawText(amt, f.amount.row1.topIn, f.amount.row1.leftIn, {
      size: f.amount.row1.fontSize,
      fontStyle: f.amount.row1.fontStyle,
      align: f.amount.row1.align,
    });
    drawLine(f.amount.line1.topIn, f.amount.line1.left1In, f.amount.line1.left2In);

    drawText(amt, f.amount.row2.topIn, f.amount.row2.leftIn, {
      size: f.amount.row2.fontSize,
      fontStyle: f.amount.row2.fontStyle,
      align: f.amount.row2.align,
    });
    drawLine(f.amount.doubleUnderline.topIn1, f.amount.doubleUnderline.left1In, f.amount.doubleUnderline.left2In);
    drawLine(f.amount.doubleUnderline.topIn2, f.amount.doubleUnderline.left1In, f.amount.doubleUnderline.left2In);
  }

  // Prepared By aligned at bottom line
  const preparedBy = data.prepared_by_name_snapshot || data.preparedBy || "";
  if (preparedBy) {
    drawText(preparedBy, f.signatures.preparedBy.topIn, f.signatures.preparedBy.leftIn, {
      size: f.signatures.preparedBy.fontSize,
      fontStyle: f.signatures.preparedBy.fontStyle,
      align: f.signatures.preparedBy.align,
    });
  }

  return doc;
}

// =========================================================================
// 4. BANK CHECK (Exact match to scripts/print-delivery-receipt.mjs)
// =========================================================================
export const CHECK_LAYOUT_CONFIG = {
  paper: {
    widthIn: 8.0,
    heightIn: 3.0,
    checkWidthIn: 3.0,
    checkHeightIn: 8.0,
  },
  globalOffset: {
    topIn: 0.0,
    leftIn: 0.0,
  },
  fields: {
    date: {
      topIn: 0.76,
      fontSize: 10,
      boxLefts: [
        5.945, 6.141, // MM boxes
        6.426, 6.621, // DD boxes
        6.906, 7.102, 7.301, 7.492, // YYYY boxes
      ],
    },
    payee: {
      topIn: 1.25,
      leftIn: 1.30,
      maxWidthIn: 4.20,
      fontSize: 11,
      fontStyle: "bold" as const,
    },
    amount: {
      topIn: 1.25,
      leftIn: 5.80,
      maxWidthIn: 1.65,
      fontSize: 11.5,
      fontStyle: "bold" as const,
    },
    amountWords: {
      topIn: 1.62,
      leftIn: 1.20,
      maxWidthIn: 5.5,
      fontSize: 10.5,
      fontStyle: "bold" as const,
    },
  },
};

export async function generateCheckPdf(
  data: any,
  config = CHECK_LAYOUT_CONFIG,
  _printerModel = "standard",
  templateUrl = "/templates/check-template.jpg",
  calibration?: { page?: { xMm?: number; yMm?: number } },
) {
  let effectiveConfig = config;
  if (calibration?.page) {
    const xIn = (Number(calibration.page.xMm) || 0) / 25.4;
    const yIn = (Number(calibration.page.yMm) || 0) / 25.4;
    effectiveConfig = {
      ...config,
      globalOffset: {
        topIn: (config.globalOffset?.topIn || 0) + yIn,
        leftIn: (config.globalOffset?.leftIn || 0) + xIn,
      },
    };
  }

  const widthPt = effectiveConfig.paper.widthIn * 72;
  const heightPt = effectiveConfig.paper.heightIn * 72;

  const doc = new jsPDF({
    unit: "pt",
    format: [widthPt, heightPt],
    orientation: "landscape",
  });
  (doc as any).__calibrated = true;

  if (templateUrl) {
    await addTemplateBackground(doc, templateUrl, widthPt, heightPt);
  }

  const drawText = (
    text: unknown,
    topIn: number,
    leftIn: number,
    { align = "left" as "left" | "right" | "center", size = 11, fontStyle = "bold" as "normal" | "bold", maxWidthIn = 0 } = {},
  ) => {
    if (!text && text !== 0) return;
    const finalTopPt = (topIn + effectiveConfig.globalOffset.topIn) * 72;
    const finalLeftPt = (leftIn + effectiveConfig.globalOffset.leftIn) * 72;

    doc.setFont("helvetica", fontStyle);
    doc.setTextColor(0, 0, 0);

    let currentSize = size;
    if (maxWidthIn > 0) {
      doc.setFontSize(currentSize);
      const maxPt = maxWidthIn * 72;
      while (doc.getTextWidth(String(text)) > maxPt && currentSize > 5.5) {
        currentSize -= 0.5;
        doc.setFontSize(currentSize);
      }
    } else {
      doc.setFontSize(currentSize);
    }

    doc.text(String(text), finalLeftPt, finalTopPt, { align, baseline: "alphabetic" });
  };

  const f = effectiveConfig.fields;

  let month = data.dateMonth || "";
  let day = data.dateDay || "";
  let year = data.dateYear || "";
  if (!month || !day || !year) {
    const rawDate = data.check_date || data.paid_at || data.expense_date || data.date;
    const d = rawDate ? new Date(rawDate) : new Date();
    if (!isNaN(d.getTime())) {
      month = String(d.getMonth() + 1).padStart(2, "0");
      day = String(d.getDate()).padStart(2, "0");
      year = String(d.getFullYear());
    }
  }

  const mStr = String(month || "").padStart(2, "0");
  const dStr = String(day || "").padStart(2, "0");
  const yStr = String(year || "").padStart(4, "2026");
  const boxLefts = f.date?.boxLefts || [5.945, 6.141, 6.426, 6.621, 6.906, 7.102, 7.301, 7.492];
  const dateDigits = [mStr[0], mStr[1], dStr[0], dStr[1], yStr[0], yStr[1], yStr[2], yStr[3]];

  dateDigits.forEach((digit, idx) => {
    if (digit && boxLefts[idx]) {
      drawText(digit, f.date.topIn, boxLefts[idx], {
        size: f.date.fontSize || 11,
        align: "center",
      });
    }
  });

  const rawPayee = String(data.payee || data.supplier_name || "").replace(/\*/g, "").trim();
  const payeeText = rawPayee ? rawPayee.toUpperCase() : "";
  drawText(payeeText, f.payee.topIn, f.payee.leftIn, {
    size: f.payee.fontSize,
    fontStyle: f.payee.fontStyle,
    maxWidthIn: f.payee.maxWidthIn,
  });

  const rawAmt = typeof data.amount === "string" ? data.amount.replace(/\*/g, "").trim() : data.amount ?? "";
  const numAmt = typeof rawAmt === "number" ? rawAmt : parseFloat(String(rawAmt).replace(/[^0-9.-]/g, ""));
  const formattedAmt = isNaN(numAmt) ? "" : fmtMoney(numAmt);
  const amtText = String(formattedAmt || "").replace(/\*/g, "").trim();
  drawText(amtText, f.amount.topIn, f.amount.leftIn, {
    size: f.amount.fontSize,
    fontStyle: f.amount.fontStyle,
    maxWidthIn: f.amount.maxWidthIn,
  });

  let words = String(data.amountWords || "").replace(/\*/g, "").trim();
  if (!words && !isNaN(numAmt) && numAmt > 0) {
    words = amountToPesoWords(numAmt);
  }
  const wordsText = String(words ? words.toUpperCase() : "").replace(/\*/g, "").trim();
  drawText(wordsText, f.amountWords.topIn, f.amountWords.leftIn, {
    size: f.amountWords.fontSize,
    fontStyle: f.amountWords.fontStyle,
    maxWidthIn: f.amountWords.maxWidthIn,
  });

  return doc;
}

