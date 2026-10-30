import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import readline from "node:readline";
import { exec, execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";
import { createClient } from "@supabase/supabase-js";

// Ensure stdout/stderr writes never throw in Windows GUI subsystem (no console attached)
if (process.platform === "win32") {
  for (const stream of [process.stdout, process.stderr]) {
    if (stream) {
      stream.on?.("error", () => {});
      const origWrite = stream.write?.bind(stream);
      if (origWrite) {
        stream.write = (chunk, encoding, cb) => {
          try {
            return origWrite(chunk, encoding, cb);
          } catch {
            if (typeof cb === "function") cb();
            return true;
          }
        };
      }
    }
  }
}

const recentJobs = [];
function recordJob(job) {
  const entry = {
    id: String(Date.now()),
    time: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    documentType: job.documentType || "Document",
    documentNo: job.documentNo || "Print Job",
    printer: job.printer || "Default Printer",
    status: job.status || "Completed",
  };
  recentJobs.unshift(entry);
  if (recentJobs.length > 30) recentJobs.pop();
  return entry;
}

export function getLocalIps() {
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// --- 1. PHYSICAL LAYOUT CONFIG (all coordinates in inches from top/left) ---
// Form Paper: Statement / Half-Letter (5.5" wide x 8.5" high)
export const LAYOUT_CONFIG = {
  paper: {
    widthIn: 5.5,
    heightIn: 8.5,
  },
  // Global tuning offset if printer feed shifts paper
  // topIn: -0.08" shifts everything higher to align text baselines on the pre-printed lines
  globalOffset: {
    topIn: Number(process.env.OFFSET_TOP || -0.08),
    leftIn: Number(process.env.OFFSET_LEFT || 0.0),
  },
  header: {
    deliveredTo: { topIn: 2.42, leftIn: 1.5, maxWidthIn: 2.1 }, // rested on line
    date: { topIn: 2.39, leftIn: 4.25 }, // moved right to clear "Date:" label
    tin: { topIn: 2.61, leftIn: 0.65, maxWidthIn: 2.5 }, // aligned right after "TIN:" label
    terms: { topIn: 2.61, leftIn: 4.08 }, // shifted left to sit snugly after "Terms:" label
    address: { topIn: 2.79, leftIn: 1.15, maxWidthIn: 2.3 }, // shifted up to align on line
    poNo: { topIn: 2.83, leftIn: 4.25 }, // moved left to align with Date and clear gap
    businessStyle: { topIn: 3.05, leftIn: 1.55, maxWidthIn: 3.4 }, // shifted up to align on line
  },
  items: {
    headerTopIn: 3.7, // Top column titles: QTY, ITEM, UNITPRICE, TOTAL (Picture 2)
    startTopIn: 3.92, // First row
    rowStepIn: 0.32,
    maxRows: 7,
    columns: {
      qtyAndUnit: { leftIn: 0.45, align: "left" }, // e.g. "200 PCS"
      description: { leftIn: 1.2, align: "left", maxWidthIn: 2.15 }, // strictly wraps within 2.15"
      unitPrice: { leftIn: 4.05, align: "right" },
      amount: { leftIn: 4.68, align: "center" }, // moved 2 steps left to center under AMOUNT
    },
    total: {
      topIn: 6.85,
      leftIn: 4.68, // moved 2 steps left to center under AMOUNT
      align: "center",
    },
  },
};

// --- 1B. PHYSICAL LAYOUT CONFIG FOR SERVICE INVOICE (SI) ---
// Form Paper: 15 cm wide x 20 cm high (5.9055" x 7.8740")
export const SERVICE_INVOICE_LAYOUT_CONFIG = {
  paper: {
    widthIn: 15 / 2.54, // ~5.9055"
    heightIn: 20 / 2.54, // ~7.8740"
  },
  globalOffset: {
    topIn: Number(process.env.SI_OFFSET_TOP || -0.09), // Shifted up ~1.27mm to center vertically in boxes
    leftIn: Number(process.env.SI_OFFSET_LEFT || -0.05), // Shifted ~1.3mm to the left
  },
  header: {
    date: { topIn: 1.5625, rightIn: 0.55 }, // 1 9/16", right aligned inside date box
    soldTo: { topIn: 1.75, leftIn: 1.38, maxWidthIn: 4.1 }, // 1 3/4"
    registeredName: { topIn: 2.02, leftIn: 1.38, maxWidthIn: 2.05 }, // Row 2 Left: Project Name field (bounded to 2.05" so it doesn't overlap PO)
    poNo: { topIn: 2.02, leftIn: 3.55, maxWidthIn: 2.0 }, // Row 2 Right: CE/P.O NO: label at 3.55", red number at 4.38"
    tin: { topIn: 2.24, leftIn: 1.38, maxWidthIn: 2.2 }, // 2 1/4"
    businessAddress: { topIn: 2.47, leftIn: 1.38, maxWidthIn: 3.9 }, // 2 15/32", bounded within 5.30" to prevent outbound overflow
  },
  items: {
    startTopIn: 2.88, // Shifted up ~1.4mm (from 2.9375") so items sit centered inside the row box
    rowStepIn: Number(process.env.SI_ROW_STEP_IN || 0.2), // uniform ~5.08mm per row (5 lines per inch)
    maxRows: 12,
    columns: {
      description: { leftIn: 0.42, maxWidthIn: 2.70 }, // Bounded strictly within Description column (~6.85 cm)
      qty: { leftIn: 3.55, align: "right" },
      unitPrice: { leftIn: 4.40, align: "right" },
      amount: { leftIn: 5.52, align: "right" },
    },
  },
  totals: {
    startTopIn: 5.5, // 5 1/2"
    rowStepIn: Number(process.env.SI_ROW_STEP_IN || 0.2), // uniform ~5.08mm per row (5 lines per inch)
    columns: {
      summaryLeft: { leftIn: 1.95, align: "right" },
      summaryRight: { leftIn: 5.52, align: "right" },
    },
  },
};

export function getSiRowOffsetIn(rowIndex, stepIn = 0.2) {
  if (rowIndex <= 0) return 0;
  return rowIndex * stepIn;
}

export function getSiItemTopIn(rowIndex, config = SERVICE_INVOICE_LAYOUT_CONFIG) {
  const step = config.items.rowStepIn ?? 0.2;
  return config.items.startTopIn + rowIndex * step;
}

export function getSiTotalsTopIn(rowIndex, config = SERVICE_INVOICE_LAYOUT_CONFIG) {
  const step = config.totals.rowStepIn ?? 0.2;
  return config.totals.startTopIn + rowIndex * step;
}

// --- 1C. PHYSICAL LAYOUT CONFIG FOR CHECK VOUCHER (CV) ---
// Form Paper: A5 fed narrow-edge first (148 mm W x 210 mm H)
// Pre-printed artwork is landscape, fed narrow-edge first with Left edge entering first.
export const CHECK_VOUCHER_LAYOUT_CONFIG = {
  paper: {
    widthIn: 148 / 25.4, // ~5.8268" (narrow edge entering printer)
    heightIn: 210 / 25.4, // ~8.2677" (direction of feed)
  },
  globalOffset: {
    topIn: Number(process.env.CV_OFFSET_TOP || 0.0),
    leftIn: Number(process.env.CV_OFFSET_LEFT || 0.0),
  },
  fields: {
    date: { topIn: 1.45, leftIn: 6.85, maxWidthIn: 1.85, fontSize: 10, fontStyle: "bold", align: "center" },
    payee: { topIn: 1.85, leftIn: 1.15, maxWidthIn: 3.95, fontSize: 10.5, fontStyle: "bold", align: "left" },
    particulars: { topIn: 2.92, leftIn: 0.50, maxWidthIn: 5.10, fontSize: 9.5, fontStyle: "bold", align: "left" },
    columns: {
      checkDate: {
        header: { topIn: 3.55, leftIn: 1.20, fontSize: 9, fontStyle: "bold", align: "center" },
        value: { topIn: 3.75, leftIn: 1.20, fontSize: 9.5, fontStyle: "bold", align: "center" },
      },
      documentNo: {
        header: { topIn: 3.55, leftIn: 2.90, fontSize: 9, fontStyle: "bold", align: "center" },
        value: { topIn: 3.75, leftIn: 2.90, fontSize: 10, fontStyle: "bold", align: "center" },
      },
      checkNo: {
        header: { topIn: 3.55, leftIn: 4.60, fontSize: 9, fontStyle: "bold", align: "center" },
        value: { topIn: 3.75, leftIn: 4.60, fontSize: 10, fontStyle: "bold", align: "center" },
      },
    },
    amount: {
      row1: { topIn: 3.10, leftIn: 7.45, fontSize: 10, fontStyle: "bold", align: "right" },
      line1: { topIn: 3.16, left1In: 6.55, left2In: 7.45 },
      row2: { topIn: 3.32, leftIn: 7.45, fontSize: 10, fontStyle: "bold", align: "right" },
      doubleUnderline: { topIn1: 3.37, topIn2: 3.40, left1In: 6.55, left2In: 7.45 },
    },
    signatures: {
      preparedBy: { topIn: 5.62, leftIn: 1.33, fontSize: 10, fontStyle: "bold", align: "center" },
      certifiedCorrectBy: { topIn: 5.62, leftIn: 4.60, fontSize: 10, fontStyle: "bold", align: "center" },
      receivedBy: { topIn: 5.62, leftIn: 7.20, fontSize: 10, fontStyle: "bold", align: "center" },
    },
  },
};

// --- 1D. PHYSICAL LAYOUT CONFIG FOR BANK CHECKS ---
// Form Paper: Standard 8" W x 3" H check (PCHC standard across Philippine banks)
// Fed narrow-edge first in portrait (3" W x 8" H), with Account Number side entering first.
export const CHECK_LAYOUT_CONFIG = {
  paper: {
    widthIn: 8.27, // A4 carriage width in portrait feed
    heightIn: 11.69, // A4 length in portrait feed
    checkWidthIn: 3.0,
    checkHeightIn: 8.0,
  },
  trayOffsetLeftIn: Number(process.env.CHECK_TRAY_OFFSET_LEFT || 2.635), // (8.27 - 3.0) / 2 = 2.635" centers check between sliding guides
  globalOffset: {
    topIn: Number(process.env.CHECK_OFFSET_TOP || 0.0),
    leftIn: Number(process.env.CHECK_OFFSET_LEFT || 0.0),
  },
  fields: {
    date: {
      topIn: 0.58, // Centered vertically inside preprinted date boxes
      fontSize: 11,
      boxLefts: [
        5.945, 6.141, // MM boxes
        6.426, 6.621, // DD boxes
        6.906, 7.102, 7.301, 7.492, // YYYY boxes
      ],
      monthLeftIn: 5.945,
      dayLeftIn: 6.426,
      yearLeftIn: 6.906,
    },
    payee: {
      topIn: 0.95, // Onto PAY TO THE ORDER OF line
      leftIn: 1.30,
      maxWidthIn: 4.00, // Scales font down if long (no wrap, clear of ₱)
      fontSize: 11,
      fontStyle: "bold",
    },
    amount: {
      topIn: 0.95, // Aligned with amount line
      leftIn: 6.00, // Safely inside amount line after ₱
      maxWidthIn: 1.55,
      fontSize: 11.5,
      fontStyle: "bold",
    },
    amountWords: {
      topIn: 1.22, // Onto PESOS line
      leftIn: 1.20,
      maxWidthIn: 5.5,
      fontSize: 10.5,
      fontStyle: "bold",
    },
  },
};

// --- 1E. EPSON L121 RIGHT-EDGE FEED OFFSETS (INCHES) ---
// Epson L121/L120 feeds all paper along the fixed right edge guide of the A4/Letter carriage (8.2677" = 210mm).
// For top-feed paper against the right guide, Windows/driver aligns page origin (X = 0) with the paper's left edge.
// Delivery Receipt and Service Invoice require 0.0" offset to prevent artificial right-side shift.
export const EPSON_L121_TRAY_OFFSETS = {
  check: 8.2677 - 8.0, // 0.2677" (~6.8mm for top-feed against fixed right guide)
  deliveryReceipt: Number(process.env.L120_DR_OFFSET_IN || 0.0), // 0.0" (paper edge aligns at origin)
  serviceInvoice: Number(process.env.L120_SI_OFFSET_IN || 0.0), // 0.0" (paper edge aligns at origin)
  checkVoucher: 0.0, // Full A4 carriage width (210mm - 210mm = 0")
};

// Convert numeric amount to Philippine Peso words
const ONES = [
  "ZERO",
  "ONE",
  "TWO",
  "THREE",
  "FOUR",
  "FIVE",
  "SIX",
  "SEVEN",
  "EIGHT",
  "NINE",
  "TEN",
  "ELEVEN",
  "TWELVE",
  "THIRTEEN",
  "FOURTEEN",
  "FIFTEEN",
  "SIXTEEN",
  "SEVENTEEN",
  "EIGHTEEN",
  "NINETEEN",
];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];
function numberToWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100)
    return [TENS[Math.floor(n / 10)], n % 10 ? ONES[n % 10] : ""].filter(Boolean).join(" ");
  if (n < 1000) return joinScale(n, 100, "HUNDRED");
  if (n < 1000000) return joinScale(n, 1000, "THOUSAND");
  if (n < 1000000000) return joinScale(n, 1000000, "MILLION");
  return joinScale(n, 1000000000, "BILLION");
}
function joinScale(n, scale, label) {
  const head = Math.floor(n / scale);
  const tail = n % scale;
  return [numberToWords(head), label, tail ? numberToWords(tail) : ""].filter(Boolean).join(" ");
}
export function amountToPesoWords(value) {
  const amount = Math.max(0, Math.round(Number(value || 0) * 100));
  const pesos = Math.floor(amount / 100);
  const cents = amount % 100;
  const pesoLabel = pesos === 1 ? "PESO" : "PESOS";
  return cents
    ? `${numberToWords(pesos)} ${pesoLabel} AND ${String(cents).padStart(2, "0")}/100 ONLY`
    : `${numberToWords(pesos)} ${pesoLabel} ONLY`;
}

// --- 2. ENVIRONMENT & SUPABASE CLIENT ---
function loadEnv() {
  const exeDir = process.pkg ? path.dirname(process.execPath) : "";
  const possiblePaths = [
    exeDir ? path.join(exeDir, ".env") : "",
    path.join(__dirname, ".env"),
    path.join(projectRoot, ".env"),
    path.join(process.cwd(), ".env"),
  ].filter(Boolean);

  const envPath = possiblePaths.find((p) => fs.existsSync(p));
  if (!envPath) return {};
  const content = fs.readFileSync(envPath, "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const env = loadEnv();
const DEFAULT_SUPABASE_URL = "https://fqzjgdvkdlggiynculxd.supabase.co";
const DEFAULT_SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxempnZHZrZGxnZ2l5bmN1bHhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNzM1NTgsImV4cCI6MjA5Njc0OTU1OH0.K4BR3KGUIwzwKfkKDI6oBBXJh1baoJDamFDHhjFKxUo";

const supabaseUrl =
  env.SUPABASE_URL || env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseKey =
  env.SUPABASE_PUBLISHABLE_KEY ||
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_KEY ||
  DEFAULT_SUPABASE_KEY;

export function getOutputDir() {
  const candidates = [
    path.join(process.pkg ? path.dirname(process.execPath) : projectRoot, "output"),
    path.join(process.cwd(), "output"),
    path.join(os.tmpdir(), "printing-output"),
  ];

  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      // try next candidate
    }
  }
  return os.tmpdir();
}

// --- 3. FETCH JOB ORDER DATA ---
async function fetchJobOrder(identifier) {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase credentials in .env");
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Try matching by id (UUID) or by job_number / dr_number
  let query = supabase
    .from("job_orders")
    .select(
      "*, customer:customers(*), quotation:quotations(quote_number, terms), lines:job_order_line_items(*)",
    );

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
  if (isUuid) {
    query = query.eq("id", identifier);
  } else {
    query = query.or(`job_number.eq.${identifier},dr_number.eq.${identifier}`);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Job order not found for identifier: ${identifier}`);
  return data;
}

// Sample mock data for testing layout without database
export function getMockJobOrder() {
  return {
    job_number: "JO-2026-0153",
    dr_number: "17999",
    client_po_number: "JO-2026-0153",
    delivered_at: "2026-08-24T00:00:00.000Z",
    customer: {
      customer_name: "THERETAIL HIVE",
      tin_number: "010-050-306-000",
      address: "1251 EL Inventor Compound, Amang Rodriguez Ave, Pasig City",
      business_style: "",
    },
    quotation: {
      quote_number: "Q-2026-0153",
      terms: "30 days after invoice",
    },
    lines: [
      {
        quantity: 200,
        unit_of_measure: "PCS",
        description: "22.9 cm x 12.5 cm pf star cheese standee sticker on 3mm sintra",
        unit_price: 25.0,
        line_total: 6048.0,
      },
    ],
  };
}

// Fetch invoice data by id or invoice_number
async function fetchInvoice(identifier) {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase credentials in .env");
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
  let query = supabase
    .from("invoices")
    .select(
      "*, customer:customers(*), job:job_orders(client_po_number), lines:invoice_line_items(*)",
    );

  if (isUuid) {
    query = query.eq("id", identifier);
  } else {
    query = query.eq("invoice_number", identifier);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Invoice not found for identifier: ${identifier}`);
  return data;
}

// Sample mock Service Invoice data for layout calibration test
export function getMockInvoice() {
  return {
    documentType: "service-invoice",
    invoice_number: "SI-2026-0001",
    invoice_date: new Date().toISOString(),
    customer: {
      customer_name: "ACME CORPORATION",
      tin_number: "123-456-789-000",
      address: "123 Business Blvd., Quezon City",
    },
    client_po_number: "PO-2026-999",
    lines: [
      {
        description: "EMBODY GAMING CHAIR - PRINT ON STICKER 1.5MM SINTRA WITH MATTE LAMINATION SIZE: 120X80CM",
        quantity: 3,
        unit_price: 4800.0,
        line_total: 14400.0,
      },
      {
        description: "Color proofing and plate preparation",
        quantity: 2,
        unit_price: 1500.0,
        line_total: 3000.0,
      },
    ],
    vatable_sales_snapshot: 8000.0,
    vat_amount_snapshot: 960.0,
    gross_total_snapshot: 8960.0,
    amount_due_snapshot: 8960.0,
    tax_type: "vatable",
    includeEwt: true,
    ewtRate: 0.02,
  };
}

// Sample mock Check Voucher data for layout calibration test
export function getMockExpense() {
  return {
    documentType: "check-voucher",
    id: "EXP-2026-MOCK",
    date: fmtDate(new Date()),
    checkDate: fmtDate(new Date()),
    payee: "ACME SUPPLIES & INDUSTRIAL TRADING",
    particulars: "Full payment for materials and pre-press consumable items",
    amount: "16,500.00",
    documentNo: "DR-17999",
    checkNo: "CHK-023151",
    preparedBy: "SHAUN MISTULA",
  };
}

// Fetch expense data for check voucher by id or document/check number
async function fetchExpense(identifier) {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase credentials in .env");
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
  let query = supabase
    .from("job_expenses")
    .select("*, job_order:job_orders(id, job_number, project_name)");

  if (isUuid) {
    query = query.eq("id", identifier);
  } else {
    query = query.or(`supplier_document_no.eq.${identifier},check_number.eq.${identifier}`);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Expense not found for identifier: ${identifier}`);

  const job = data.job_order || null;
  const particulars = [data.description, job ? `${job.job_number} - ${job.project_name}` : ""]
    .filter(Boolean)
    .join(" / ");

  return {
    documentType: "check-voucher",
    id: data.id,
    date: fmtDate(data.check_date || data.paid_at || data.expense_date),
    checkDate: fmtDate(data.check_date || data.paid_at || data.expense_date),
    payee: data.supplier_name || "-",
    particulars,
    amount: fmtMoney(data.amount),
    documentNo: data.supplier_document_no || "-",
    checkNo: data.check_number || "-",
    preparedBy: data.prepared_by_name_snapshot || "",
  };
}

// --- 4. FORMATTING HELPERS ---
function fmtDate(d) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtMoney(num) {
  if (num === null || num === undefined || isNaN(num)) return "";
  return Number(num).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function addNodeTemplateBackground(doc, templateFileName, xPt, yPt, widthPt, heightPt) {
  try {
    const templatePath = path.join(process.cwd(), "public", "templates", templateFileName);
    if (fs.existsSync(templatePath)) {
      const bg = fs.readFileSync(templatePath).toString("base64");
      doc.addImage("data:image/jpeg;base64," + bg, "JPEG", xPt, yPt, widthPt, heightPt);
    }
  } catch (err) {
    console.warn(`[TemplateBG] Could not attach ${templateFileName}:`, err.message);
  }
}

// --- 5. GENERATE OVERLAY PDF ---
export function generateDeliveryReceiptPdf(data, config = LAYOUT_CONFIG, printerModel = "standard") {
  const isL121 = printerModel === "epson-l121" || config?.printerModel === "epson-l121";
  const a4WidthPt = Math.round(8.2677 * 72);
  const a4HeightPt = Math.round(11.69 * 72);
  const widthPt = isL121 ? a4WidthPt : config.paper.widthIn * 72;
  const heightPt = isL121 ? a4HeightPt : config.paper.heightIn * 72;

  const doc = new jsPDF({
    unit: "pt",
    format: [widthPt, heightPt],
    orientation: "portrait",
  });

  const xShiftIn = isL121
    ? (config.trayOffsetLeftIn ?? EPSON_L121_TRAY_OFFSETS.deliveryReceipt ?? 0)
    : 0;

  addNodeTemplateBackground(
    doc,
    "delivery-receipt-template.jpg",
    xShiftIn * 72,
    0,
    config.paper.widthIn * 72,
    config.paper.heightIn * 72,
  );

  // Helper to place text by inch coordinates
  const drawText = (
    text,
    topIn,
    leftIn,
    { align = "left", size = 9, fontStyle = "normal" } = {},
  ) => {
    if (!text && text !== 0) return;
    const finalTopPt = (topIn + config.globalOffset.topIn) * 72;
    const finalLeftPt = (leftIn + config.globalOffset.leftIn + xShiftIn) * 72;

    doc.setFontSize(size);
    doc.setFont("helvetica", fontStyle);
    doc.setTextColor(0, 0, 0);

    // baseline alignment so text sits on pre-printed lines
    doc.text(String(text), finalLeftPt, finalTopPt, { align, baseline: "alphabetic" });
  };

  const customer = data.customer || {};
  const quote = data.quotation || {};

  // Header Details (aligned to pre-printed lines)
  drawText(
    customer.customer_name,
    config.header.deliveredTo.topIn,
    config.header.deliveredTo.leftIn,
    {
      size: 9.5,
      fontStyle: "bold",
    },
  );
  drawText(
    fmtDate(data.delivered_at || new Date()),
    config.header.date.topIn,
    config.header.date.leftIn,
    {
      size: 9,
    },
  );
  drawText(customer.tin_number, config.header.tin.topIn, config.header.tin.leftIn, { size: 9 });
  drawText(quote.terms, config.header.terms.topIn, config.header.terms.leftIn, { size: 8.5 });

  // Address: wrap within 2.30" max width so it NEVER overlaps with P.O. No.
  if (customer.address) {
    const maxAddrWidthPt = (config.header.address.maxWidthIn || 2.3) * 72;
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    const addrLines = doc.splitTextToSize(String(customer.address), maxAddrWidthPt);
    if (addrLines.length <= 1) {
      drawText(customer.address, config.header.address.topIn, config.header.address.leftIn, {
        size: 8,
      });
    } else {
      drawText(addrLines[0], config.header.address.topIn - 0.03, config.header.address.leftIn, {
        size: 7.2,
      });
      drawText(addrLines[1], config.header.address.topIn + 0.08, config.header.address.leftIn, {
        size: 7.2,
      });
    }
  }

  const showPo = data.includePo !== false && data.showPo !== false && !data.hidePo;
  if (showPo) {
    drawText(
      data.client_po_number || quote.quote_number,
      config.header.poNo.topIn,
      config.header.poNo.leftIn,
      {
        size: 9,
      },
    );
  }
  drawText(
    customer.business_style || "",
    config.header.businessStyle.topIn,
    config.header.businessStyle.leftIn,
    {
      size: 8.5,
    },
  );

  // Particulars Section:
  // 1. Column Titles ("Top title" as in Excel / Picture 2)
  const isPriced =
    data.priced !== false &&
    String(data.priced).toLowerCase() !== "false" &&
    data.withPrices !== false;
  const headerTopIn = config.items.headerTopIn || 3.7;
  drawText("QTY", headerTopIn, config.items.columns.qtyAndUnit.leftIn, {
    size: 8,
    fontStyle: "bold",
  });
  drawText("ITEM", headerTopIn, config.items.columns.description.leftIn, {
    size: 8,
    fontStyle: "bold",
  });
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

  // 2. Project Name Title if available
  const projectName = data.project_name || data.projectName;
  if (projectName) {
    drawText(projectName.toUpperCase(), currentTopIn, config.items.columns.description.leftIn, {
      size: 8,
      fontStyle: "bold",
    });
    currentTopIn += 0.2;
  }

  // 3. Line items with text wrapping (cannot overlap into unit price or amount)
  const lines = (data.lines || []).slice(0, config.items.maxRows || 7);
  let grandTotal = 0;
  const maxDescWidthPt = (config.items.columns.description.maxWidthIn || 2.15) * 72;

  lines.forEach((line) => {
    const qtyUnit = `${line.quantity || ""} ${line.unit_of_measure || "PCS"}`.trim();
    const unitPrice = line.unit_price ? fmtMoney(line.unit_price) : "";
    const lineTotal = line.line_total ? fmtMoney(line.line_total) : "";
    grandTotal += Number(line.line_total || 0);

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    const descLines = doc.splitTextToSize(String(line.description || ""), maxDescWidthPt);

    drawText(qtyUnit, currentTopIn, config.items.columns.qtyAndUnit.leftIn, { size: 8 });
    if (isPriced && unitPrice) {
      drawText(unitPrice, currentTopIn, config.items.columns.unitPrice.leftIn, {
        align: "right",
        size: 8,
      });
    }
    if (isPriced && lineTotal) {
      drawText(lineTotal, currentTopIn, config.items.columns.amount.leftIn, {
        align: config.items.columns.amount.align || "center",
        size: 8.5,
        fontStyle: "bold",
      });
    }

    // Render wrapped description lines
    descLines.forEach((dLine, dIdx) => {
      drawText(dLine, currentTopIn + dIdx * 0.13, config.items.columns.description.leftIn, {
        size: 8,
      });
    });

    const rowHeight = Math.max(0.26, descLines.length * 0.13 + 0.08);
    currentTopIn += rowHeight;
  });

  // Grand Total at bottom of amount column
  if (isPriced && grandTotal > 0) {
    drawText(fmtMoney(grandTotal), config.items.total.topIn, config.items.total.leftIn, {
      align: config.items.total.align || "center",
      size: 9.5,
      fontStyle: "bold",
    });
  }

  return doc;
}

// --- 5B. GENERATE SERVICE INVOICE OVERLAY PDF ---
export function generateServiceInvoicePdf(data, config = SERVICE_INVOICE_LAYOUT_CONFIG, printerModel = "standard") {
  const isL121 = printerModel === "epson-l121" || config?.printerModel === "epson-l121";
  const a4WidthPt = Math.round(8.2677 * 72);
  const a4HeightPt = Math.round(11.69 * 72);
  const widthPt = isL121 ? a4WidthPt : config.paper.widthIn * 72;
  const heightPt = isL121 ? a4HeightPt : config.paper.heightIn * 72;

  const doc = new jsPDF({
    unit: "pt",
    format: [widthPt, heightPt],
    orientation: "portrait",
  });

  const xShiftIn = isL121
    ? (config.trayOffsetLeftIn ?? EPSON_L121_TRAY_OFFSETS.serviceInvoice ?? 0)
    : 0;

  addNodeTemplateBackground(
    doc,
    "service-invoice-template.jpg",
    xShiftIn * 72,
    0,
    config.paper.widthIn * 72,
    config.paper.heightIn * 72,
  );

  const drawText = (
    text,
    topIn,
    leftIn,
    { align = "left", size = 9, fontStyle = "normal" } = {},
  ) => {
    if (!text && text !== 0) return;
    const finalTopPt = (topIn + config.globalOffset.topIn) * 72;
    const finalLeftPt = (leftIn + config.globalOffset.leftIn + xShiftIn) * 72;

    doc.setFontSize(size);
    doc.setFont("helvetica", fontStyle);
    doc.setTextColor(0, 0, 0);
    doc.text(String(text), finalLeftPt, finalTopPt, { align, baseline: "alphabetic" });
  };

  const customer = data.customer || {};
  const dateStr = fmtDate(data.invoice_date || data.invoiceDate || new Date());
  const lines = (data.lines || []).slice(0, config.items.maxRows || 6);

  // 1. Header Details
  // Date: right aligned inside date box
  const dateLeftIn = config.paper.widthIn - (config.header.date.rightIn || 0.49);
  drawText(dateStr, config.header.date.topIn, dateLeftIn, { align: "right", size: 9 });

  // Customer Name / Sold To
  const custName = customer.customer_name || customer.customerName || "";
  drawText(custName, config.header.soldTo.topIn, config.header.soldTo.leftIn, {
    size: 9,
    fontStyle: "bold",
  });

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
    const projLines = doc.splitTextToSize(String(projectName), maxProjWidthPt) || [];
    if (projLines.length <= 1) {
      drawText(projectName, config.header.registeredName.topIn, config.header.registeredName.leftIn, {
        size: 8,
        fontStyle: "bold",
      });
    } else {
      drawText(projLines[0], config.header.registeredName.topIn - 0.045, config.header.registeredName.leftIn, {
        size: 7.2,
        fontStyle: "bold",
      });
      drawText(projLines[1], config.header.registeredName.topIn + 0.045, config.header.registeredName.leftIn, {
        size: 7.2,
        fontStyle: "bold",
      });
    }
  }

  // Row 2 Right: CE/P.O NO: (label black bold, number RED bold)
  const po = String(data.client_po_number || data.clientPoNumber || "").trim();
  if (po) {
    drawText("CE/P.O NO:", config.header.poNo.topIn, config.header.poNo.leftIn, { size: 8.5, fontStyle: "bold" });
    const finalTopPt = (config.header.poNo.topIn + config.globalOffset.topIn) * 72;
    const poNumLeftIn = 4.38;
    const finalLeftPt = (poNumLeftIn + config.globalOffset.leftIn + xShiftIn) * 72;
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(220, 38, 38);
    doc.text(po, finalLeftPt, finalTopPt, { align: "left", baseline: "alphabetic" });
    doc.setTextColor(0, 0, 0);
  }

  // TIN
  const tin = customer.tin_number || customer.tinNumber || "";
  drawText(tin, config.header.tin.topIn, config.header.tin.leftIn, { size: 9 });

  // Business Address with wrapping
  const addr = customer.address || "";
  if (addr) {
    const maxAddrWidthPt = (config.header.businessAddress.maxWidthIn || 3.9) * 72;
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    const addrLines = doc.splitTextToSize(String(addr), maxAddrWidthPt);
    if (addrLines.length <= 1) {
      drawText(addr, config.header.businessAddress.topIn, config.header.businessAddress.leftIn, {
        size: 7.5,
      });
    } else if (addrLines.length === 2) {
      drawText(
        addrLines[0],
        config.header.businessAddress.topIn - 0.05,
        config.header.businessAddress.leftIn,
        { size: 7.2 },
      );
      drawText(
        addrLines[1],
        config.header.businessAddress.topIn + 0.05,
        config.header.businessAddress.leftIn,
        { size: 7.2 },
      );
    } else {
      drawText(
        addrLines[0],
        config.header.businessAddress.topIn - 0.07,
        config.header.businessAddress.leftIn,
        { size: 6.8 },
      );
      drawText(
        addrLines[1],
        config.header.businessAddress.topIn + 0.03,
        config.header.businessAddress.leftIn,
        { size: 6.8 },
      );
      drawText(
        addrLines[2],
        config.header.businessAddress.topIn + 0.13,
        config.header.businessAddress.leftIn,
        { size: 6.8 },
      );
    }
  }

  // 2. Line Items (uniform row progression: ~5.08mm / 0.2" per row)
  const maxDescWidthPt = (config.items.columns.description.maxWidthIn || 2.70) * 72;

  lines.forEach((line, idx) => {
    const rowTopIn = getSiItemTopIn(idx, config);
    const desc = (line.description || "").trim();
    const qty = line.quantity !== undefined ? String(line.quantity) : "";
    const unitPrice =
      line.unit_price || line.unitPrice ? fmtMoney(line.unit_price || line.unitPrice) : "";
    const lineTotal =
      line.line_total || line.lineTotal ? fmtMoney(line.line_total || line.lineTotal) : "";

    // Align description cleanly inside the ~5.08mm row box without crossing horizontal divider rules
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    const singleLineWidth = doc.getTextWidth(desc);

    if (singleLineWidth <= maxDescWidthPt) {
      drawText(desc, rowTopIn, config.items.columns.description.leftIn, { size: 8.5 });
    } else if (doc.setFontSize(6.5), doc.getTextWidth(desc) <= maxDescWidthPt) {
      drawText(desc, rowTopIn, config.items.columns.description.leftIn, { size: 6.5 });
    } else {
      // 2 wrapped lines centered vertically inside the 0.20" row slot
      // Line 1 (-0.055") and Line 2 (+0.018") stay safely clear of top and bottom rules
      doc.setFontSize(6.0);
      const descLines = doc.splitTextToSize(desc, maxDescWidthPt);
      if (descLines.length <= 1) {
        drawText(desc, rowTopIn, config.items.columns.description.leftIn, { size: 6.0 });
      } else {
        const line1 = descLines[0];
        const remaining = descLines.slice(1).join(" ");
        const splitRemaining = doc.splitTextToSize(remaining, maxDescWidthPt);
        const line2 = splitRemaining[0] || remaining;

        drawText(line1, rowTopIn - 0.055, config.items.columns.description.leftIn, { size: 6.0 });
        drawText(line2, rowTopIn + 0.018, config.items.columns.description.leftIn, { size: 6.0 });
      }
    }

    if (qty)
      drawText(qty, rowTopIn, config.items.columns.qty.leftIn, { align: "right", size: 8.5 });
    if (unitPrice)
      drawText(unitPrice, rowTopIn, config.items.columns.unitPrice.leftIn, {
        align: "right",
        size: 8.5,
      });
    if (lineTotal)
      drawText(lineTotal, rowTopIn, config.items.columns.amount.leftIn, {
        align: "right",
        size: 8.5,
        fontStyle: "bold",
      });
  });

  // 3. Totals / Summary Table
  const grossTotal = Number(
    data.gross_total_snapshot ?? data.grossTotal ?? data.invoice_amount ?? data.invoiceAmount ?? 0,
  );
  const isVatable = data.tax_type === "vatable" || data.taxType === "vatable";
  const rawVatable = Number(data.vatable_sales_snapshot ?? data.vatableSales ?? 0);
  const vatableSales =
    rawVatable > 0
      ? rawVatable
      : isVatable
        ? Math.round((grossTotal / 1.12) * 100) / 100
        : grossTotal;
  const rawVat = Number(data.vat_amount_snapshot ?? data.vatAmount ?? 0);
  const vatAmount =
    rawVat > 0 ? rawVat : isVatable ? Math.round((grossTotal - vatableSales) * 100) / 100 : 0;

  // EWT Withholding Tax:
  const includeEwt = Boolean(
    data.includeEwt ||
    data.include_ewt ||
    (data.ewtEnabled && (data.ewtAmount || data.ewt_amount_snapshot)),
  );
  const rate = Number(data.ewtRate || data.ewt_rate || 0.02) || 0.02;
  const rawEwt = Number(data.ewtAmount ?? data.ewt_amount_snapshot ?? 0);
  const calculatedEwt = includeEwt
    ? rawEwt > 0
      ? rawEwt
      : Math.round(vatableSales * rate * 100) / 100
    : 0;
  const showEwt = includeEwt && calculatedEwt > 0;
  const finalAmountDue = showEwt
    ? Math.max(grossTotal - calculatedEwt, 0)
    : Number(data.amount_due_snapshot ?? data.amountDue ?? grossTotal);

  const totalSalesTop = getSiTotalsTopIn(0, config);
  const lessVatTop = getSiTotalsTopIn(1, config);
  const netOfVatTop = getSiTotalsTopIn(2, config);
  const addVatTop = getSiTotalsTopIn(4, config);
  const withholdingTaxTop = getSiTotalsTopIn(5, config);
  const totalDueTop = getSiTotalsTopIn(6, config);

  const rightColLeftIn = config.totals.columns.summaryRight.leftIn;

  // Right column: Total Sales, Less VAT, Net of VAT, Add VAT, Withholding Tax, Total Due
  drawText(fmtMoney(grossTotal), totalSalesTop, rightColLeftIn, { align: "right", size: 8.5 });
  if (isVatable && vatAmount) {
    drawText(fmtMoney(vatAmount), lessVatTop, rightColLeftIn, { align: "right", size: 8.5 });
  }
  drawText(fmtMoney(isVatable ? vatableSales : grossTotal), netOfVatTop, rightColLeftIn, {
    align: "right",
    size: 8.5,
  });
  if (isVatable && vatAmount) {
    drawText(fmtMoney(vatAmount), addVatTop, rightColLeftIn, { align: "right", size: 8.5 });
  }
  if (showEwt) {
    drawText(fmtMoney(calculatedEwt), withholdingTaxTop, rightColLeftIn, {
      align: "right",
      size: 8.5,
    });
  }
  drawText(fmtMoney(finalAmountDue), totalDueTop, rightColLeftIn, {
    align: "right",
    size: 10,
    fontStyle: "bold",
  });

  return doc;
}

// --- 5C. GENERATE CHECK VOUCHER OVERLAY PDF (A5 PORTRAIT FEED) ---
export function generateCheckVoucherPdf(data, config = CHECK_VOUCHER_LAYOUT_CONFIG, printerModel = "standard") {
  const isL121 = printerModel === "epson-l121" || config?.printerModel === "epson-l121";
  const a4WidthPt = Math.round(8.2677 * 72);
  const a4HeightPt = Math.round(11.69 * 72);
  const widthPt = isL121 ? a4WidthPt : config.paper.widthIn * 72;
  const heightPt = isL121 ? a4HeightPt : config.paper.heightIn * 72;

  const doc = new jsPDF({
    unit: "pt",
    format: [widthPt, heightPt],
    orientation: "portrait",
  });

  const carriageWidthIn = isL121 ? 8.2677 : config.paper.widthIn;

  if (data.testMode || config.showTemplate || data.includeTemplate) {
    if (isL121) {
      addNodeTemplateBackground(doc, "check-voucher-template.jpg", 0, 0, (210 / 25.4) * 72, (148 / 25.4) * 72);
    } else {
      addNodeTemplateBackground(doc, "check-voucher-template.jpg", 0, 0, config.paper.widthIn * 72, config.paper.heightIn * 72);
    }
  }

  const drawVoucherText = (
    text,
    topIn,
    leftIn,
    { align = "left", size = 9.5, fontStyle = "normal", maxWidthIn = 0 } = {},
  ) => {
    if (!text && text !== 0) return;
    const finalTopIn = topIn + config.globalOffset.topIn;
    const finalLeftIn = leftIn + config.globalOffset.leftIn;

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

    const textStr = String(text);
    const textWidthPt = doc.getTextWidth(textStr);

    if (isL121) {
      // Epson L120/L121: Top-Feed (A5 Landscape 210mm wide on A4 carriage, top edge enters first)
      const xpPt = finalLeftIn * 72;
      const ypPt = finalTopIn * 72;
      doc.text(textStr, xpPt, ypPt, { align, angle: 0, baseline: "alphabetic" });
    } else {
      // Standard Center-Feed: Narrow-edge feed with Left edge entering first (angle: 270)
      // Top of voucher corresponds to right edge of portrait sheet (carriageWidthIn - finalTopIn)
      const xpPt = (carriageWidthIn - finalTopIn) * 72;
      let ypPt = finalLeftIn * 72;
      if (align === "right") {
        ypPt -= textWidthPt;
      } else if (align === "center") {
        ypPt -= textWidthPt / 2;
      }
      doc.text(textStr, xpPt, ypPt, { align: "left", angle: 270, baseline: "alphabetic" });
    }
  };

  const drawVoucherLine = (topIn, left1In, left2In, lineWidth = 0.65) => {
    const finalTopIn = topIn + config.globalOffset.topIn;
    const finalLeft1In = left1In + config.globalOffset.leftIn;
    const finalLeft2In = left2In + config.globalOffset.leftIn;
    doc.setLineWidth(lineWidth);
    doc.setDrawColor(0, 0, 0);
    if (isL121) {
      const yPt = finalTopIn * 72;
      const x1Pt = finalLeft1In * 72;
      const x2Pt = finalLeft2In * 72;
      doc.line(x1Pt, yPt, x2Pt, yPt);
    } else {
      const xPt = (carriageWidthIn - finalTopIn) * 72;
      const y1Pt = finalLeft1In * 72;
      const y2Pt = finalLeft2In * 72;
      doc.line(xPt, y1Pt, xPt, y2Pt);
    }
  };

  const f = config.fields;
  const dateStr = fmtDate(
    data.check_date || data.paid_at || data.expense_date || data.date || new Date(),
  );
  drawVoucherText(dateStr, f.date.topIn, f.date.leftIn, {
    size: f.date.fontSize,
    fontStyle: f.date.fontStyle || "bold",
    align: f.date.align || "center",
  });

  const rawPayee = data.payee || data.supplier_name || "-";
  const payee = String(rawPayee).replace(/\*/g, "").trim();
  drawVoucherText(payee, f.payee.topIn, f.payee.leftIn, {
    size: f.payee.fontSize,
    fontStyle: f.payee.fontStyle || "bold",
    maxWidthIn: f.payee.maxWidthIn,
  });

  const particulars = data.particulars || data.description || "";
  drawVoucherText(particulars, f.particulars.topIn, f.particulars.leftIn, {
    size: f.particulars.fontSize,
    fontStyle: f.particulars.fontStyle || "bold",
    maxWidthIn: f.particulars.maxWidthIn,
  });

  // Columns inside Particulars
  const checkDateVal = data.check_date ? fmtDate(data.check_date) : data.checkDate || "";
  const docNoVal = data.supplier_document_no || data.documentNo || "";
  const checkNoVal = data.check_number || data.checkNo || "";

  if (f.columns?.checkDate) {
    drawVoucherText("CHECK DATE", f.columns.checkDate.header.topIn, f.columns.checkDate.header.leftIn, {
      size: f.columns.checkDate.header.fontSize,
      fontStyle: f.columns.checkDate.header.fontStyle || "bold",
      align: f.columns.checkDate.header.align || "center",
    });
    if (checkDateVal) {
      drawVoucherText(checkDateVal, f.columns.checkDate.value.topIn, f.columns.checkDate.value.leftIn, {
        size: f.columns.checkDate.value.fontSize,
        fontStyle: f.columns.checkDate.value.fontStyle || "bold",
        align: f.columns.checkDate.value.align || "center",
      });
    }
  }

  if (f.columns?.documentNo) {
    drawVoucherText("DR/INVOICE NUMBER", f.columns.documentNo.header.topIn, f.columns.documentNo.header.leftIn, {
      size: f.columns.documentNo.header.fontSize,
      fontStyle: f.columns.documentNo.header.fontStyle || "bold",
      align: f.columns.documentNo.header.align || "center",
    });
    if (docNoVal && docNoVal !== "-") {
      drawVoucherText(docNoVal, f.columns.documentNo.value.topIn, f.columns.documentNo.value.leftIn, {
        size: f.columns.documentNo.value.fontSize,
        fontStyle: f.columns.documentNo.value.fontStyle || "bold",
        align: f.columns.documentNo.value.align || "center",
      });
    }
  }

  if (f.columns?.checkNo) {
    drawVoucherText("CHECK NUMBER", f.columns.checkNo.header.topIn, f.columns.checkNo.header.leftIn, {
      size: f.columns.checkNo.header.fontSize,
      fontStyle: f.columns.checkNo.header.fontStyle || "bold",
      align: f.columns.checkNo.header.align || "center",
    });
    if (checkNoVal && checkNoVal !== "-") {
      drawVoucherText(checkNoVal, f.columns.checkNo.value.topIn, f.columns.checkNo.value.leftIn, {
        size: f.columns.checkNo.value.fontSize,
        fontStyle: f.columns.checkNo.value.fontStyle || "bold",
        align: f.columns.checkNo.value.align || "center",
      });
    }
  }

  // Amounts & Underlines
  const amt = data.amount
    ? typeof data.amount === "number"
      ? fmtMoney(data.amount)
      : String(data.amount)
    : "";
  if (amt && f.amount?.row1) {
    drawVoucherText(amt, f.amount.row1.topIn, f.amount.row1.leftIn, {
      size: f.amount.row1.fontSize,
      fontStyle: f.amount.row1.fontStyle || "bold",
      align: f.amount.row1.align || "right",
    });
    if (f.amount.line1) {
      drawVoucherLine(f.amount.line1.topIn, f.amount.line1.left1In, f.amount.line1.left2In);
    }
    if (f.amount.row2) {
      drawVoucherText(amt, f.amount.row2.topIn, f.amount.row2.leftIn, {
        size: f.amount.row2.fontSize,
        fontStyle: f.amount.row2.fontStyle || "bold",
        align: f.amount.row2.align || "right",
      });
    }
    if (f.amount.doubleUnderline) {
      drawVoucherLine(f.amount.doubleUnderline.topIn1, f.amount.doubleUnderline.left1In, f.amount.doubleUnderline.left2In);
      drawVoucherLine(f.amount.doubleUnderline.topIn2, f.amount.doubleUnderline.left1In, f.amount.doubleUnderline.left2In);
    }
  }

  const prepBy = data.preparedBy || data.prepared_by_name_snapshot || "";
  if (prepBy && f.signatures?.preparedBy) {
    drawVoucherText(prepBy, f.signatures.preparedBy.topIn, f.signatures.preparedBy.leftIn, {
      size: f.signatures.preparedBy.fontSize,
      fontStyle: f.signatures.preparedBy.fontStyle || "bold",
      align: f.signatures.preparedBy.align || "center",
    });
  }

  return doc;
}

// --- 5D. GENERATE BANK CHECK OVERLAY PDF (PORTRAIT FEED: 3" W x 8" H) ---
export function generateCheckPdf(data, config = CHECK_LAYOUT_CONFIG, printerModel = "standard") {
  const isL121 = printerModel === "epson-l121" || config?.printerModel === "epson-l121";
  const a4WidthPt = Math.round(8.2677 * 72);
  const a4HeightPt = Math.round(11.69 * 72);
  const widthPt = isL121 ? a4WidthPt : config.paper.widthIn * 72;
  const heightPt = isL121 ? a4HeightPt : config.paper.heightIn * 72;

  const doc = new jsPDF({
    unit: "pt",
    format: [widthPt, heightPt],
    orientation: "portrait",
  });

  const trayOffsetLeftIn =
    config.trayOffsetLeftIn ??
    (isL121
      ? 8.2677 - (config.paper.checkHeightIn || 8.0)
      : (config.paper.widthIn - (config.paper.checkWidthIn || 3.0)) / 2);

  const drawCheckText = (
    text,
    topIn,
    leftIn,
    { align = "left", size = 11, fontStyle = "normal", maxWidthIn = 0 } = {},
  ) => {
    if (!text && text !== 0) return;
    const finalTopIn = topIn + config.globalOffset.topIn;
    const finalLeftIn = leftIn + config.globalOffset.leftIn;

    doc.setFont("helvetica", fontStyle);
    doc.setTextColor(0, 0, 0);

    // Auto-scale font size if text exceeds maxWidth (do not wrap)
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

    if (isL121) {
      // Epson L120/L121: Top-Feed (8" wide check on A4 carriage, top edge enters first)
      // Carriage is 8.2677" wide, check is 8.0" wide against fixed right guide (offset: 0.2677")
      const checkTrayOffsetIn = 8.2677 - (config.paper.checkHeightIn || 8.0); // 0.2677" (~6.8mm)
      const xpPt = (checkTrayOffsetIn + finalLeftIn) * 72;
      const ypPt = finalTopIn * 72;
      doc.text(String(text), xpPt, ypPt, { align, angle: 0, baseline: "alphabetic" });
    } else {
      // Standard Center-Feed: Narrow-edge feed with Account Number (left edge) entering first (UNTOUCHED)
      // The 3" check is centered between tray guides at trayOffsetLeftIn (approx 2.635" on A4).
      // The pre-printed lines (Payee, Date, Amount) are on the right side of the check (checkWidthIn - finalTopIn).
      // Left edge of check enters first (Y = 0).
      const checkWidthIn = config.paper.checkWidthIn || 3.0;
      const xpPt = (trayOffsetLeftIn + checkWidthIn - finalTopIn) * 72;
      const ypPt = finalLeftIn * 72;
      doc.text(String(text), xpPt, ypPt, { align, angle: 270, baseline: "alphabetic" });
    }
  };

  if (data.testMode || config.showTemplate || data.includeTemplate) {
    if (isL121) {
      addNodeTemplateBackground(
        doc,
        "check-template.jpg",
        (8.2677 - (config.paper.checkHeightIn || 8.0)) * 72,
        0,
        8.0 * 72,
        3.0 * 72,
      );
    }
  }

  const f = config.fields;

  // 1. Date: Render each digit into its individual pre-printed box [M1][M2] - [D1][D2] - [Y1][Y2][Y3][Y4]
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
      drawCheckText(digit, f.date.topIn, boxLefts[idx], {
        size: f.date.fontSize || 11,
        align: "center",
      });
    }
  });

  // 2. Payee (clean text, strictly stripped of any asterisks, no wrap, auto-scaled to fit field)
  const rawPayee = String(data.payee || data.supplier_name || "").replace(/\*/g, "").trim();
  const payeeText = rawPayee ? rawPayee.toUpperCase() : "";
  drawCheckText(payeeText, f.payee.topIn, f.payee.leftIn, {
    size: f.payee.fontSize,
    fontStyle: f.payee.fontStyle,
    maxWidthIn: f.payee.maxWidthIn,
  });

  // 3. Amount in numbers (clean currency, strictly stripped of any asterisks)
  const rawAmt = typeof data.amount === "string" ? data.amount.replace(/\*/g, "").trim() : data.amount ?? "";
  const numAmt =
    typeof rawAmt === "number" ? rawAmt : parseFloat(String(rawAmt).replace(/[^0-9.-]/g, ""));
  const formattedAmt = isNaN(numAmt) ? "" : fmtMoney(numAmt);
  const amtText = String(formattedAmt || "").replace(/\*/g, "").trim();
  drawCheckText(amtText, f.amount.topIn, f.amount.leftIn, {
    size: f.amount.fontSize,
    fontStyle: f.amount.fontStyle,
    maxWidthIn: f.amount.maxWidthIn,
  });

  // 4. Amount in words (clean text, strictly stripped of any asterisks)
  let words = String(data.amountWords || "").replace(/\*/g, "").trim();
  if (!words && !isNaN(numAmt) && numAmt > 0) {
    words = amountToPesoWords(numAmt);
  }
  const wordsText = String(words ? words.toUpperCase() : "").replace(/\*/g, "").trim();
  drawCheckText(wordsText, f.amountWords.topIn, f.amountWords.leftIn, {
    size: f.amountWords.fontSize,
    fontStyle: f.amountWords.fontStyle,
    maxWidthIn: f.amountWords.maxWidthIn,
  });

  return doc;
}

// Ensure native spooler engine is extracted from embedded assets on Windows
let memoizedSpoolerExe = null;
function getOrExtractSpoolerExe() {
  const isWindows = process.platform === "win32";
  if (!isWindows) return null;
  if (memoizedSpoolerExe && fs.existsSync(memoizedSpoolerExe)) return memoizedSpoolerExe;

  const tempSpooler = path.join(os.tmpdir(), "dr-print-spooler.exe");
  try {
    if (fs.existsSync(tempSpooler) && fs.statSync(tempSpooler).size > 1000000) {
      memoizedSpoolerExe = tempSpooler;
      return tempSpooler;
    }
  } catch {}

  const candidateDirs = [
    __dirname,
    path.join(__dirname, "bin"),
    path.dirname(process.execPath),
    process.cwd(),
  ];

  for (const dir of candidateDirs) {
    try {
      const p = path.join(dir, "SumatraPDF.exe");
      if (fs.existsSync(p)) {
        const bin = fs.readFileSync(p);
        fs.writeFileSync(tempSpooler, bin);
        memoizedSpoolerExe = tempSpooler;
        return tempSpooler;
      }
    } catch {}
  }

  return null;
}

function getCupsPrinters() {
  if (process.platform !== "darwin") return { defaultPrinter: null, printers: [] };
  try {
    const rawPrinters = execSync("lpstat -e 2>/dev/null", { encoding: "utf-8" }).trim();
    const printers = rawPrinters
      ? rawPrinters
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    let defaultPrinter = null;
    try {
      const rawDef = execSync("lpstat -d 2>/dev/null", { encoding: "utf-8" }).trim();
      const match = rawDef.match(/destination:\s*(.+)$/i);
      if (match) defaultPrinter = match[1].trim();
    } catch {}
    return { defaultPrinter: defaultPrinter || printers[0] || null, printers };
  } catch {
    return { defaultPrinter: null, printers: [] };
  }
}

function getWindowsPrinters() {
  if (process.platform !== "win32") return { defaultPrinter: null, printers: [] };
  try {
    const script = `Get-CimInstance Win32_Printer | ForEach-Object { [PSCustomObject]@{ name = $_.Name; isDefault = [bool]$_.Default } } | ConvertTo-Json -Compress`;
    const out = execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, {
      encoding: "utf-8",
      timeout: 3500,
      windowsHide: true,
    }).trim();
    if (!out) return { defaultPrinter: null, printers: [] };
    const parsed = JSON.parse(out);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const printers = list.map((p) => p.name).filter(Boolean);
    const defaultPrinter = list.find((p) => p.isDefault)?.name || printers[0] || null;
    return { defaultPrinter, printers };
  } catch {
    return { defaultPrinter: null, printers: [] };
  }
}

function getSystemPrinters() {
  if (process.platform === "win32") return getWindowsPrinters();
  if (process.platform === "darwin") return getCupsPrinters();
  return { defaultPrinter: null, printers: [] };
}

let cachedSystemPrinters = { defaultPrinter: null, printers: [] };
let lastPrintersFetchTime = 0;
let isPrintersFetching = false;

function refreshPrintersInBackground() {
  if (isPrintersFetching) return;
  isPrintersFetching = true;
  setTimeout(() => {
    try {
      cachedSystemPrinters = getSystemPrinters();
      lastPrintersFetchTime = Date.now();
    } catch {}
    isPrintersFetching = false;
  }, 10);
}

function getFastSystemPrinters(forceSync = false) {
  if (forceSync || (!cachedSystemPrinters.printers.length && Date.now() - lastPrintersFetchTime > 60000)) {
    try {
      cachedSystemPrinters = getSystemPrinters();
      lastPrintersFetchTime = Date.now();
      return cachedSystemPrinters;
    } catch {
      return cachedSystemPrinters;
    }
  }
  if (Date.now() - lastPrintersFetchTime > 30000) {
    refreshPrintersInBackground();
  }
  return cachedSystemPrinters;
}

function openAgentGui(port = DAEMON_PORT) {
  const url = `http://127.0.0.1:${port}?gui=1`;
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (isWin) {
    const edgeCandidates = [
      process.env["ProgramFiles(x86)"] &&
        path.join(process.env["ProgramFiles(x86)"], "Microsoft/Edge/Application/msedge.exe"),
      process.env["ProgramFiles"] &&
        path.join(process.env["ProgramFiles"], "Microsoft/Edge/Application/msedge.exe"),
      process.env["LOCALAPPDATA"] &&
        path.join(process.env["LOCALAPPDATA"], "Microsoft/Edge/Application/msedge.exe"),
      process.env["ProgramFiles"] &&
        path.join(process.env["ProgramFiles"], "Google/Chrome/Application/chrome.exe"),
      process.env["ProgramFiles(x86)"] &&
        path.join(process.env["ProgramFiles(x86)"], "Google/Chrome/Application/chrome.exe"),
    ].filter(Boolean);

    for (const p of edgeCandidates) {
      if (fs.existsSync(p)) {
        try {
          const child = spawn(p, [`--app=${url}`, "--window-size=560,780"], {
            detached: true,
            stdio: "ignore",
            windowsHide: false,
          });
          child.unref();
          return;
        } catch {}
      }
    }

    try {
      exec(`start "" "${url}"`, { windowsHide: true });
    } catch {}
    return;
  }

  if (isMac) {
    const chromeApp = "/Applications/Google Chrome.app";
    const edgeApp = "/Applications/Microsoft Edge.app";
    if (fs.existsSync(chromeApp)) {
      try {
        const child = spawn("open", ["-na", "Google Chrome", "--args", `--app=${url}`], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        return;
      } catch {}
    } else if (fs.existsSync(edgeApp)) {
      try {
        const child = spawn("open", ["-na", "Microsoft Edge", "--args", `--app=${url}`], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        return;
      } catch {}
    }

    try {
      const child = spawn("open", [url], { detached: true, stdio: "ignore" });
      child.unref();
    } catch {}
  }
}

function renderGuiHtml() {
  const localIps = getLocalIps();
  const isMac = process.platform === "darwin";
  const platformName = isMac
    ? "macOS (Apple Silicon)"
    : process.platform === "win32"
      ? "Windows (x64)"
      : process.platform;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Automate DirectPrint — Control Panel</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(17, 24, 39, 0.85);
      --card-border: rgba(255, 255, 255, 0.08);
      --card-hover: rgba(30, 41, 59, 0.6);
      --primary: #4f46e5;
      --primary-hover: #4338ca;
      --emerald: #10b981;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      user-select: none;
      -webkit-font-smoothing: antialiased;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 1.25rem;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--card-border);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .logo-icon {
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 0.5rem;
      background: linear-gradient(135deg, #4f46e5, #06b6d4);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(79, 70, 229, 0.35);
    }
    .brand-title {
      font-size: 1.05rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .brand-sub {
      font-size: 0.72rem;
      color: var(--text-muted);
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 0.3rem 0.65rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      color: #34d399;
    }
    .status-dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 9999px;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(0.85); }
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 0.75rem;
      padding: 0.9rem;
      backdrop-filter: blur(16px);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
    }
    .card-title {
      font-size: 0.73rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.6rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.5rem;
    }
    .stat-box {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--card-border);
      border-radius: 0.5rem;
      padding: 0.45rem 0.6rem;
      text-align: center;
    }
    .stat-label {
      font-size: 0.68rem;
      color: var(--text-dim);
      margin-bottom: 0.12rem;
    }
    .stat-val {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .printer-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--card-border);
      padding: 0.65rem 0.85rem;
      border-radius: 0.5rem;
    }
    .printer-info {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      min-width: 0;
    }
    .printer-name {
      font-size: 0.88rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .select-printer {
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: var(--text);
      font-size: 0.8rem;
      padding: 0.4rem 0.65rem;
      border-radius: 0.4rem;
      outline: none;
      max-width: 200px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      border: none;
      border-radius: 0.45rem;
      padding: 0.45rem 0.75rem;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      color: #fff;
    }
    .btn-outline {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--card-border);
      color: var(--text);
    }
    .btn-outline:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.15);
    }
    .btn-sm {
      padding: 0.22rem 0.5rem;
      font-size: 0.72rem;
    }
    .btn-profile {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--card-border);
      color: var(--text-dim);
      border-radius: 0.35rem;
      padding: 0.22rem 0.6rem;
      font-size: 0.72rem;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-profile:hover {
      background: rgba(255, 255, 255, 0.1);
      color: var(--text);
    }
    .btn-profile.active {
      background: #4f46e5;
      border-color: #6366f1;
      color: #fff;
      font-weight: 600;
    }
    .btn-danger {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #f87171;
    }
    .btn-danger:hover {
      background: rgba(239, 68, 68, 0.25);
    }
    .ip-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.78rem;
      padding: 0.35rem 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }
    .ip-row:last-child { border-bottom: none; }
    .ip-label { color: var(--text-dim); }
    .ip-val {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--text);
      font-size: 0.75rem;
    }
    .test-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.5rem;
    }
    .test-btn {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--card-border);
      border-radius: 0.5rem;
      padding: 0.6rem 0.75rem;
      text-align: left;
      cursor: pointer;
      color: var(--text);
      transition: all 0.15s ease;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .test-btn:hover {
      background: rgba(79, 70, 229, 0.12);
      border-color: rgba(79, 70, 229, 0.35);
    }
    .test-btn-title {
      font-size: 0.8rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .test-btn-sub {
      font-size: 0.68rem;
      color: var(--text-dim);
    }
    .activity-list {
      max-height: 120px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .activity-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid var(--card-border);
      border-radius: 0.4rem;
      padding: 0.35rem 0.65rem;
      font-size: 0.75rem;
    }
    .activity-left {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .activity-badge {
      font-size: 0.65rem;
      font-weight: 600;
      padding: 0.1rem 0.35rem;
      border-radius: 0.2rem;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.25);
    }
    .activity-time {
      font-size: 0.68rem;
      color: var(--text-dim);
      font-family: ui-monospace, monospace;
    }
    .toast {
      padding: 0.5rem 0.75rem;
      border-radius: 0.45rem;
      font-size: 0.75rem;
      display: none;
      animation: fadeIn 0.2s ease;
    }
    .toast-success {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #6ee7b7;
    }
    .toast-error {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
    }
    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 0.25rem;
      font-size: 0.72rem;
      color: var(--text-dim);
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <div class="brand">
        <div class="logo-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <polyline points="6 9 6 2 18 2 18 9"></polyline>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
            <rect x="6" y="14" width="12" height="8"></rect>
          </svg>
        </div>
        <div>
          <h1 class="brand-title">Automate DirectPrint</h1>
          <p class="brand-sub">Hardware Print Spooler Service</p>
        </div>
      </div>
      <div class="status-pill" id="statusPill">
        <span class="status-dot"></span>
        <span id="statusText">Active & Ready</span>
      </div>
    </header>

    <div class="card">
      <div class="card-title">
        <span>Hardware Printer</span>
        <button class="btn btn-outline btn-sm" id="btnRefreshPrinters">Refresh</button>
      </div>
      <div class="printer-row">
        <div class="printer-info">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2">
            <polyline points="6 9 6 2 18 2 18 9"></polyline>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
            <rect x="6" y="14" width="12" height="8"></rect>
          </svg>
          <div>
            <div class="printer-name" id="currentPrinterName">Detecting...</div>
            <div style="font-size:0.68rem; color:var(--text-dim);" id="spoolerEngineText">Hardware Spooler</div>
          </div>
        </div>
        <select class="select-printer" id="printerSelect">
          <option value="">Default Printer</option>
        </select>
      </div>
      <div style="margin-top:0.65rem; padding-top:0.6rem; border-top:1px solid rgba(255,255,255,0.06); display:flex; align-items:center; justify-content:space-between;">
        <span style="font-size:0.72rem; color:var(--text-dim);">Feeder Profile:</span>
        <div style="display:flex; gap:0.4rem;">
          <button type="button" class="btn-profile active" id="btnProfileStandard" onclick="setProfile('standard')">Standard (Center)</button>
          <button type="button" class="btn-profile" id="btnProfileL121" onclick="setProfile('epson-l121')">Epson L120 / L121 (Right)</button>
        </div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-box">
        <div class="stat-label">PORT</div>
        <div class="stat-val">18890</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">PLATFORM</div>
        <div class="stat-val">${platformName}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">AGENT</div>
        <div class="stat-val">2.3 GUI</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Network & Tailscale Access</div>
      <div class="ip-row">
        <span class="ip-label">Local Computer</span>
        <div style="display:flex; align-items:center; gap:0.4rem;">
          <span class="ip-val">http://127.0.0.1:18890</span>
          <button class="btn btn-outline btn-sm" onclick="copyText('http://127.0.0.1:18890')">Copy</button>
        </div>
      </div>
      ${localIps
        .map(
          (ip) => `
      <div class="ip-row">
        <span class="ip-label">Network / Tailscale</span>
        <div style="display:flex; align-items:center; gap:0.4rem;">
          <span class="ip-val">${ip}</span>
          <button class="btn btn-outline btn-sm" onclick="copyText('${ip}')">Copy</button>
        </div>
      </div>`,
        )
        .join("")}
    </div>

    <div class="card">
      <div class="card-title">Test Direct Printing</div>
      <div class="test-grid">
        <button class="test-btn" onclick="triggerTest('dr')">
          <div class="test-btn-title">📄 Delivery Receipt</div>
          <div class="test-btn-sub">A5 Statement</div>
        </button>
        <button class="test-btn" onclick="triggerTest('check')">
          <div class="test-btn-title">💳 Check Print</div>
          <div class="test-btn-sub">Portrait Feed</div>
        </button>
        <button class="test-btn" onclick="triggerTest('si')">
          <div class="test-btn-title">🧾 Service Invoice</div>
          <div class="test-btn-sub">15cm × 20cm</div>
        </button>
        <button class="test-btn" onclick="triggerTest('cv')">
          <div class="test-btn-title">📑 Check Voucher</div>
          <div class="test-btn-sub">A5 Voucher</div>
        </button>
      </div>
      <div id="toast" class="toast" style="margin-top: 0.65rem;"></div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>Recent Activity</span>
        <span style="font-size:0.65rem; font-weight:normal;" id="activityCount">0 print jobs</span>
      </div>
      <div class="activity-list" id="activityList">
        <div style="font-size:0.75rem; color:var(--text-dim); text-align:center; padding:0.75rem;">
          Waiting for print jobs from web browser...
        </div>
      </div>
    </div>

    <footer class="footer">
      <span>Keep this window open or minimized in background.</span>
      <button class="btn btn-danger btn-sm" id="btnShutdown">Quit Agent</button>
    </footer>
  </div>

  <script>
    let selectedPrinter = '';
    let selectedProfile = 'standard';

    function setProfile(profile) {
      selectedProfile = profile;
      const btnStd = document.getElementById('btnProfileStandard');
      const btnL121 = document.getElementById('btnProfileL121');
      if (btnStd) btnStd.classList.toggle('active', profile === 'standard');
      if (btnL121) btnL121.classList.toggle('active', profile === 'epson-l121');
    }

    function autoDetectProfile(name) {
      if (/l121|l120/i.test(name || '')) {
        setProfile('epson-l121');
      }
    }

    function showToast(msg, isError) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'toast ' + (isError ? 'toast-error' : 'toast-success');
      el.style.display = 'block';
      setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    function copyText(txt) {
      navigator.clipboard.writeText(txt).then(() => {
        showToast('Copied ' + txt + ' to clipboard!');
      });
    }

    async function fetchStatus() {
      try {
        const res = await fetch('/status');
        const data = await res.json();
        document.getElementById('statusPill').style.display = 'inline-flex';
        document.getElementById('statusText').textContent = 'Active & Ready';
        if (data.spoolerEngine) {
          document.getElementById('spoolerEngineText').textContent = data.spoolerEngine;
        }
        if (data.defaultPrinter && !selectedPrinter) {
          document.getElementById('currentPrinterName').textContent = data.defaultPrinter;
          autoDetectProfile(data.defaultPrinter);
        }
      } catch {
        document.getElementById('statusText').textContent = 'Connecting...';
      }
    }

    async function fetchPrinters() {
      try {
        const res = await fetch('/printers');
        const data = await res.json();
        const sel = document.getElementById('printerSelect');
        const printers = data.printers || [];
        const def = data.defaultPrinter || printers[0] || 'Default Printer';
        document.getElementById('currentPrinterName').textContent = selectedPrinter || def;
        autoDetectProfile(selectedPrinter || def);

        sel.innerHTML = '<option value="">Default (' + def + ')</option>';
        printers.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p;
          opt.textContent = p;
          if (p === selectedPrinter) opt.selected = true;
          sel.appendChild(opt);
        });
      } catch {}
    }

    async function fetchJobs() {
      try {
        const res = await fetch('/api/jobs');
        const data = await res.json();
        const list = document.getElementById('activityList');
        const jobs = data.jobs || [];
        document.getElementById('activityCount').textContent = jobs.length + ' print job' + (jobs.length === 1 ? '' : 's');
        if (jobs.length === 0) {
          list.innerHTML = '<div style="font-size:0.75rem; color:var(--text-dim); text-align:center; padding:0.75rem;">Waiting for print jobs from web browser...</div>';
          return;
        }
        list.innerHTML = jobs.map(j => \`
          <div class="activity-item">
            <div class="activity-left">
              <span class="activity-badge">\${j.status || 'Printed'}</span>
              <span style="font-weight:600;">\${j.documentType}</span>
              <span style="color:var(--text-dim);">\${j.documentNo}</span>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span style="color:var(--text-muted); font-size:0.7rem;">\${j.printer}</span>
              <span class="activity-time">\${j.time}</span>
            </div>
          </div>
        \`).join('');
      } catch {}
    }

    async function triggerTest(type) {
      try {
        const profLabel = selectedProfile === 'epson-l121' ? ' (Epson L121 Profile)' : ' (Standard Profile)';
        showToast('Sending test print to ' + (selectedPrinter || 'default printer') + profLabel + '...', false);
        const res = await fetch('/api/test-print', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type,
            printer: selectedPrinter || undefined,
            printerModel: selectedProfile,
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message, false);
          fetchJobs();
        } else {
          showToast(data.error || 'Test print failed', true);
        }
      } catch (err) {
        showToast(err.message, true);
      }
    }

    document.getElementById('printerSelect').addEventListener('change', (e) => {
      selectedPrinter = e.target.value;
      document.getElementById('currentPrinterName').textContent = selectedPrinter || 'Default Printer';
      autoDetectProfile(selectedPrinter);
    });

    document.getElementById('btnRefreshPrinters').addEventListener('click', () => {
      fetchPrinters();
      showToast('Printers refreshed', false);
    });

    document.getElementById('btnShutdown').addEventListener('click', async () => {
      if (confirm('Are you sure you want to stop the DirectPrint agent?')) {
        try {
          await fetch('/api/shutdown', { method: 'POST' });
          document.body.innerHTML = '<div style="display:flex; align-items:center; justify-content:center; height:100vh; flex-direction:column; gap:1rem; font-family:sans-serif; color:#94a3b8;"><h2 style="color:#fff;">Print Agent Stopped</h2><p>Agent and terminal closed.</p></div>';
          setTimeout(() => window.close(), 300);
        } catch {
          window.close();
        }
      }
    });

    // When the dedicated GUI window is closed with 'X', shut down agent and underlying terminal
    const isGuiWindow = new URLSearchParams(window.location.search).get('gui') === '1' || window.location.search.includes('gui=1');
    if (isGuiWindow) {
      window.addEventListener('pagehide', () => {
        try {
          navigator.sendBeacon('/api/shutdown');
        } catch {}
      });
      window.addEventListener('beforeunload', () => {
        try {
          navigator.sendBeacon('/api/shutdown');
        } catch {}
      });
    }

    fetchStatus();
    fetchPrinters();
    fetchJobs();
    setInterval(fetchStatus, 3000);
    setInterval(fetchJobs, 3000);
  </script>
</body>
</html>`;
}

// --- 6. PRINT DISPATCHER ---
function printPdf(pdfFilePath, printerName, settings = "paper=A5,paperkind=11,noscale,center") {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (isMac) {
    const targetPrinter = printerName && printerName !== "default" ? printerName : undefined;
    const destArg = targetPrinter ? `-d "${targetPrinter.replace(/"/g, '\\"')}"` : "";

    const cupsOptions = ["-o fit-to-page=false"];
    if (settings.includes("paper=A5") || settings.includes("paperkind=11")) {
      cupsOptions.push("-o media=A5");
    } else if (settings.includes("paper=A4") || settings.includes("paperkind=9")) {
      cupsOptions.push("-o media=A4");
    }

    const cmd =
      `lp ${destArg} ${cupsOptions.join(" ")} "${pdfFilePath.replace(/"/g, '\\"')}"`.trim();
    console.log(`[macOS CUPS] Dispatching print command: ${cmd}`);
    try {
      execSync(cmd, { stdio: "inherit" });
      console.log("Print job successfully spooled via macOS CUPS.");
      return;
    } catch (err) {
      console.error("macOS CUPS print failed:", err.message);
      throw new Error(`macOS print spooling failed: ${err.message}`);
    }
  }

  if (!isWindows) {
    throw new Error(
      `Direct print spooling is not supported on ${process.platform}. Only Windows and macOS are supported.`,
    );
  }

  console.log(`Sending to printer ${printerName ? `"${printerName}"` : "Default"}...`);
  const escapedPath = pdfFilePath.replace(/'/g, "''");

  const spoolerExe = getOrExtractSpoolerExe();
  const escapedSpooler = spoolerExe ? spoolerExe.replace(/'/g, "''") : null;

  const psScript = `
    $file = '${escapedPath}'
    $printer = ${printerName ? `'${printerName}'` : "$null"}
    $spooler = ${escapedSpooler ? `'${escapedSpooler}'` : "$null"}
    $settings = '${settings}'

    # 1. Primary Engine: Embedded Silent Print Spooler (Direct Windows Print Spooler)
    if ($spooler -and (Test-Path $spooler)) {
      Write-Host "Spooling silently to Windows Print Spooler ($settings)..."
      if ($printer) {
        & $spooler -print-to $printer -print-settings $settings -silent $file
      } else {
        & $spooler -print-to-default -print-settings $settings -silent $file
      }
      Write-Host "Print job successfully sent to spooler."
      exit 0
    }

    # 2. System Fallback: Windows Shell Print Verb
    Write-Host "Spooler engine not found. Falling back to Windows Shell Print..."
    if ($printer) {
      Start-Process -FilePath $file -Verb PrintTo -ArgumentList ('"' + $printer + '"') -PassThru | ForEach-Object { Start-Sleep -Seconds 6; $_.Kill() }
    } else {
      Start-Process -FilePath $file -Verb Print -PassThru | ForEach-Object { Start-Sleep -Seconds 6; $_.Kill() }
    }
  `;

  try {
    const encodedCommand = Buffer.from(psScript, "utf16le").toString("base64");
    execSync(`powershell -NoProfile -EncodedCommand ${encodedCommand}`, { stdio: "inherit" });
    console.log("Print job dispatched successfully.");
  } catch (err) {
    console.error("Print command failed:", err.message);
    throw new Error(`Windows print command failed: ${err.message}`);
  }
}

// --- 7. PROCESS TERMINATION & LOCAL PRINT DAEMON ---
function closeParentTerminal() {
  // Never close IDE terminals during development
  if (
    process.env.VSCODE_PID ||
    process.env.ANTIGRAVITY_IDE ||
    process.env.TERM_PROGRAM === "vscode" ||
    process.env.ELECTRON_RUN_AS_NODE
  ) {
    return;
  }

  const ppid = process.ppid;
  if (!ppid || ppid <= 4) return;

  if (process.platform === "win32") {
    try {
      let parentName = "";
      try {
        const ppidCmd = `powershell -NoProfile -NonInteractive -Command "$p = Get-Process -Id ${ppid} -ErrorAction SilentlyContinue; if ($p) { $p.ProcessName }"`;
        parentName = execSync(ppidCmd, {
          encoding: "utf-8",
          timeout: 2500,
          windowsHide: true,
        }).trim().toLowerCase();
      } catch {
        try {
          const wmicOut = execSync(`wmic process where processid=${ppid} get name`, {
            encoding: "utf-8",
            timeout: 2500,
            windowsHide: true,
          });
          parentName = wmicOut.replace(/name/i, "").trim().toLowerCase();
        } catch {}
      }

      const terminalShells = [
        "cmd",
        "cmd.exe",
        "powershell",
        "powershell.exe",
        "pwsh",
        "pwsh.exe",
        "conhost",
        "conhost.exe",
        "windowsterminal",
        "windowsterminal.exe",
        "wt",
        "wt.exe",
        "bash",
        "bash.exe",
        "zsh",
        "zsh.exe",
        "sh",
        "sh.exe",
        "mintty",
        "mintty.exe",
      ];

      const isTerminal = terminalShells.some(
        (t) => parentName === t || parentName.startsWith(t.replace(".exe", "")),
      );

      if (isTerminal) {
        try {
          execSync(`taskkill /F /PID ${ppid}`, { windowsHide: true, timeout: 2000 });
        } catch {
          exec(`taskkill /F /PID ${ppid}`, { windowsHide: true });
        }
      }
    } catch {}
    return;
  }

  if (process.platform === "darwin") {
    try {
      let parentCmd = "";
      try {
        parentCmd = execSync(`ps -o comm= -p ${ppid} 2>/dev/null`, {
          encoding: "utf-8",
          timeout: 2000,
        }).trim().toLowerCase();
      } catch {}

      const isTerminal = ["zsh", "bash", "sh", "terminal", "iterm"].some((t) =>
        parentCmd.includes(t),
      );

      if (isTerminal) {
        try {
          exec(
            `osascript -e 'tell application "Terminal" to close (every window whose name contains "DirectPrint" or name contains "run-agent")' 2>/dev/null`,
          );
        } catch {}
        try {
          process.kill(ppid, "SIGTERM");
        } catch {}
      }
    } catch {}
    return;
  }

  if (process.platform === "linux") {
    try {
      let parentCmd = "";
      try {
        parentCmd = execSync(`ps -o comm= -p ${ppid} 2>/dev/null`, {
          encoding: "utf-8",
          timeout: 2000,
        }).trim().toLowerCase();
      } catch {}

      const isTerminal = ["bash", "sh", "zsh", "gnome-terminal", "xterm"].some((t) =>
        parentCmd.includes(t),
      );

      if (isTerminal) {
        try {
          process.kill(ppid, "SIGTERM");
        } catch {}
      }
    } catch {}
  }
}

function logAgentEvent(level, message, err = null) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}${err ? " - " + (err.stack || err.message || err) : ""}\n`;
  try {
    fs.appendFileSync(path.join(process.cwd(), "direct-print.log"), line);
  } catch {}
  try {
    fs.appendFileSync(path.join(os.tmpdir(), "direct-print.log"), line);
  } catch {}
}

function shutdownAgent(code = 0) {
  if (code === 0) {
    try {
      closeParentTerminal();
    } catch {}
  }
  process.exit(code);
}

function pauseAndExit(code = 0) {
  shutdownAgent(code);
}

// Global exception guards so Windows console window NEVER silently vanishes
process.on("uncaughtException", (err) => {
  logAgentEvent("FATAL", "Uncaught exception", err);
  console.error("\n======================================================");
  console.error("  CRITICAL ERROR:");
  console.error(err.stack || err.message || err);
  console.error("======================================================\n");
  pauseAndExit(1);
});

process.on("unhandledRejection", (reason) => {
  logAgentEvent("FATAL", "Unhandled rejection", reason);
  console.error("\n======================================================");
  console.error("  UNHANDLED REJECTION:");
  console.error(reason);
  console.error("======================================================\n");
  pauseAndExit(1);
});

// --- 7. LOCAL PRINT DAEMON (for direct printing from web browser) ---
export const DAEMON_PORT = 18890;

function startPrintDaemon(defaultPrinter) {
  // Prime printer cache in background on daemon start so initial requests never block
  refreshPrintersInBackground();

  if (process.platform === "win32") {
    try {
      exec(
        `netsh advfirewall firewall add rule name="Automate DirectPrint Helper" dir=in action=allow protocol=TCP localport=${DAEMON_PORT} profile=any`,
        { windowsHide: true },
        () => {},
      );
    } catch {
      // Ignored if non-elevated
    }
  }

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || "*";
    const reqHeaders =
      req.headers["access-control-request-headers"] ||
      "Content-Type, Access-Control-Request-Private-Network";

    // Full CORS and Chrome Private Network Access (PNA) compliance
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", reqHeaders);
    res.setHeader("Access-Control-Allow-Private-Network", "true");

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": reqHeaders,
        "Access-Control-Allow-Private-Network": "true",
      });
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${DAEMON_PORT}`);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderGuiHtml());
      return;
    }

    if (url.pathname === "/health" || url.pathname === "/status") {
      const isWin = process.platform === "win32";
      const isMac = process.platform === "darwin";
      const spooler = isWin ? getOrExtractSpoolerExe() : null;
      const systemPrinters = getFastSystemPrinters(false);
      const spoolerEngine = isWin
        ? spooler
          ? "Direct Windows Spooler"
          : "Shell Verb Fallback"
        : isMac
          ? "macOS CUPS (/usr/bin/lp)"
          : "Unsupported";

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "running",
          port: DAEMON_PORT,
          version: "2.5-clean-check",
          platform: process.platform,
          supported: isWin || isMac,
          spoolerEngine,
          defaultPrinter: defaultPrinter || systemPrinters.defaultPrinter,
          printers: systemPrinters.printers,
        }),
      );
      return;
    }

    if (url.pathname === "/printers" && req.method === "GET") {
      const systemPrinters = getFastSystemPrinters(true);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(systemPrinters));
      return;
    }

    if (url.pathname === "/api/jobs" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jobs: recentJobs }));
      return;
    }

    if (url.pathname === "/api/shutdown") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, message: "Shutting down Automate DirectPrint..." }));
      setTimeout(() => {
        shutdownAgent(0);
      }, 300);
      return;
    }

    if (url.pathname === "/api/test-print" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body || "{}");
          const type = payload.type || "dr";
          const printer = payload.printer || defaultPrinter;
          const printerModel =
            payload.printerModel ||
            (/l121|l120/i.test(printer || "") ? "epson-l121" : "standard");
          const isL121 = printerModel === "epson-l121";
          const outputDir = getOutputDir();

          if (type === "dr") {
            const jobData = getMockJobOrder();
            const fileName = `test-dr-${Date.now()}.pdf`;
            const outputPath = path.join(outputDir, fileName);
            const doc = generateDeliveryReceiptPdf(jobData, LAYOUT_CONFIG, printerModel);
            fs.writeFileSync(outputPath, Buffer.from(doc.output("arraybuffer")));
            const drSettings = isL121
              ? "paper=A4,paperkind=9,noscale"
              : "paper=A5,paperkind=11,noscale,center";
            printPdf(outputPath, printer, drSettings);
            recordJob({
              documentType: `Delivery Receipt (${isL121 ? "Epson L121" : "Center"})`,
              documentNo: jobData.job_number || "TEST-DR",
              printer: printer || "Default",
              status: "Sent to printer",
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                message: `Delivery Receipt test (${isL121 ? "Epson L121" : "Standard"}) sent to ${printer || "default printer"}`,
              }),
            );
            return;
          }

          if (type === "check") {
            const checkData = getMockExpense();
            const fileName = `test-check-${Date.now()}.pdf`;
            const outputPath = path.join(outputDir, fileName);
            const doc = generateCheckPdf(checkData, CHECK_LAYOUT_CONFIG, printerModel);
            fs.writeFileSync(outputPath, Buffer.from(doc.output("arraybuffer")));
            const checkSettings =
              process.env.CHECK_PRINT_SETTINGS || "paper=A4,paperkind=9,noscale";
            printPdf(outputPath, printer, checkSettings);
            recordJob({
              documentType: `Check (${isL121 ? "Epson L121" : "Center"})`,
              documentNo: checkData.checkNo || "TEST-CHK",
              printer: printer || "Default",
              status: "Sent to printer",
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                message: `Check test (${isL121 ? "Epson L121" : "Standard"}) sent to ${printer || "default printer"}`,
              }),
            );
            return;
          }

          if (type === "si") {
            const invoiceData = getMockInvoice();
            const fileName = `test-si-${Date.now()}.pdf`;
            const outputPath = path.join(outputDir, fileName);
            const doc = generateServiceInvoicePdf(invoiceData, SERVICE_INVOICE_LAYOUT_CONFIG, printerModel);
            fs.writeFileSync(outputPath, Buffer.from(doc.output("arraybuffer")));
            const siSettings = isL121
              ? "paper=A4,paperkind=9,noscale"
              : "paper=A5,paperkind=11,noscale,center";
            printPdf(outputPath, printer, siSettings);
            recordJob({
              documentType: `Service Invoice (${isL121 ? "Epson L121" : "Center"})`,
              documentNo: invoiceData.invoice_number || "TEST-SI",
              printer: printer || "Default",
              status: "Sent to printer",
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                message: `Service Invoice test (${isL121 ? "Epson L121" : "Standard"}) sent to ${printer || "default printer"}`,
              }),
            );
            return;
          }

          if (type === "cv") {
            const cvData = getMockExpense();
            const fileName = `test-cv-${Date.now()}.pdf`;
            const outputPath = path.join(outputDir, fileName);
            const doc = generateCheckVoucherPdf(cvData, CHECK_VOUCHER_LAYOUT_CONFIG, printerModel);
            fs.writeFileSync(outputPath, Buffer.from(doc.output("arraybuffer")));
            const cvSettings = isL121
              ? "paper=A4,paperkind=9,noscale"
              : "paper=A5,paperkind=11,noscale,center";
            printPdf(outputPath, printer, cvSettings);
            recordJob({
              documentType: `Check Voucher (${isL121 ? "Epson L121" : "Center"})`,
              documentNo: cvData.documentNo || "TEST-CV",
              printer: printer || "Default",
              status: "Sent to printer",
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                message: `Check Voucher test (${isL121 ? "Epson L121" : "Standard"}) sent to ${printer || "default printer"}`,
              }),
            );
            return;
          }

          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Unknown test type: ${type}` }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (url.pathname === "/print" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body || "{}");
          const targetPrinter = payload.printer || defaultPrinter;
          const printerModel =
            payload.printerModel ||
            payload.jobData?.printerModel ||
            (/l121|l120/i.test(targetPrinter || "") ? "epson-l121" : "standard");
          const isL121 = printerModel === "epson-l121";
          const isTestMode = Boolean(
            payload.testMode ||
            payload.jobData?.testMode ||
            process.env.TEST_PRINT ||
            process.env.NODE_ENV === "test"
          );

          const isServiceInvoice =
            payload.documentType === "service-invoice" ||
            payload.jobData?.documentType === "service-invoice" ||
            Boolean(payload.jobData?.invoiceNumber || payload.jobData?.invoice_number);

          const isCheck =
            payload.documentType === "check" || payload.jobData?.documentType === "check";

          if (isCheck) {
            let checkData = payload.jobData || payload.checkData;
            if (!checkData && payload.identifier) {
              checkData = await fetchExpense(payload.identifier);
            }
            if (!checkData) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "No checkData or identifier provided for Check" }));
              return;
            }

            const outputDir = getOutputDir();
            const fileName = `check-${checkData.checkNo || checkData.check_number || checkData.id || Date.now()}.pdf`;
            const outputPath = path.join(outputDir, fileName);

            // Bank checks adhere to strict physical PCHC standards centered in the feeder.
            // Direct Print from web executes with the verified CHECK_LAYOUT_CONFIG baseline, identical to test-check.
            const checkConfig = CHECK_LAYOUT_CONFIG;

            const doc = generateCheckPdf(checkData, checkConfig, printerModel);
            fs.writeFileSync(outputPath, Buffer.from(doc.output("arraybuffer")));

            const checkSettings =
              payload.settings ||
              payload.printSettings ||
              process.env.CHECK_PRINT_SETTINGS ||
              "paper=A4,paperkind=9,noscale";
            printPdf(outputPath, targetPrinter, checkSettings);
            recordJob({
              documentType: `Check (${isL121 ? "Epson L121" : "Center"})`,
              documentNo: checkData.checkNo || checkData.check_number || "Check",
              printer: targetPrinter || "Default",
              status: "Printed",
            });

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                file: fileName,
                documentType: "check",
                printer: targetPrinter || "default",
                printerModel,
              }),
            );
            return;
          }

          const isCheckVoucher =
            payload.documentType === "check-voucher" ||
            payload.jobData?.documentType === "check-voucher" ||
            payload.documentType === "voucher";

          if (isCheckVoucher) {
            let cvData = payload.jobData || payload.cvData;
            if (!cvData && payload.identifier) {
              cvData = await fetchExpense(payload.identifier);
            }
            if (!cvData) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({ error: "No cvData or identifier provided for Check Voucher" }),
              );
              return;
            }

            const outputDir = getOutputDir();
            const fileName = `cv-${cvData.documentNo || cvData.id || Date.now()}.pdf`;
            const outputPath = path.join(outputDir, fileName);

            const doc = generateCheckVoucherPdf(
              cvData,
              payload.config || CHECK_VOUCHER_LAYOUT_CONFIG,
              printerModel,
            );
            fs.writeFileSync(outputPath, Buffer.from(doc.output("arraybuffer")));

            const cvSettings = isL121
              ? "paper=A4,paperkind=9,noscale"
              : "paper=A5,paperkind=11,noscale,center";
            if (!isTestMode) {
              printPdf(
                outputPath,
                targetPrinter,
                payload.settings || payload.printSettings || cvSettings,
              );
            } else {
              console.log(`[TEST MODE] Check voucher PDF saved with template background: ${outputPath}`);
            }
            recordJob({
              documentType: `Check Voucher (${isL121 ? "Epson L121" : "Center"})`,
              documentNo: cvData.documentNo || cvData.id || "Voucher",
              printer: targetPrinter || "Default",
              status: "Printed",
            });

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                file: fileName,
                documentType: "check-voucher",
                printer: targetPrinter || "default",
                printerModel,
              }),
            );
            return;
          }

          const applyCalibration = (baseConfig) => {
            if (!payload.calibration?.page) return baseConfig;
            const xIn = (Number(payload.calibration.page.xMm) || 0) / 25.4;
            const yIn = (Number(payload.calibration.page.yMm) || 0) / 25.4;
            return {
              ...baseConfig,
              globalOffset: {
                topIn: (baseConfig.globalOffset?.topIn || 0) + yIn,
                leftIn: (baseConfig.globalOffset?.leftIn || 0) + xIn,
              },
            };
          };

          if (isServiceInvoice) {
            const invoiceData =
              payload.jobData ||
              (payload.identifier ? await fetchInvoice(payload.identifier) : null);
            if (!invoiceData) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  error: "No invoiceData or identifier provided for Service Invoice",
                }),
              );
              return;
            }

            const outputDir = getOutputDir();
            const fileName = `si-${invoiceData.invoice_number || invoiceData.invoiceNumber || Date.now()}.pdf`;
            const outputPath = path.join(outputDir, fileName);

            const doc = generateServiceInvoicePdf(
              invoiceData,
              applyCalibration(payload.config || SERVICE_INVOICE_LAYOUT_CONFIG),
              printerModel,
            );
            fs.writeFileSync(outputPath, Buffer.from(doc.output("arraybuffer")));

            const siSettings = isL121
              ? "paper=A4,paperkind=9,noscale"
              : "paper=A5,paperkind=11,noscale,center";
            if (!isTestMode) {
              printPdf(
                outputPath,
                targetPrinter,
                payload.settings || payload.printSettings || siSettings,
              );
            } else {
              console.log(`[TEST MODE] Service invoice PDF saved with template background: ${outputPath}`);
            }
            recordJob({
              documentType: `Service Invoice (${isL121 ? "Epson L121" : "Center"})`,
              documentNo: invoiceData.invoice_number || invoiceData.invoiceNumber || "Invoice",
              printer: targetPrinter || "Default",
              status: "Printed",
            });

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                file: fileName,
                documentType: "service-invoice",
                printer: targetPrinter || "default",
                printerModel,
              }),
            );
            return;
          }

          // Otherwise: Delivery Receipt (100% untouched)
          const jobData =
            payload.jobData ||
            (payload.identifier ? await fetchJobOrder(payload.identifier) : null);
          if (!jobData) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "No jobData or identifier provided" }));
            return;
          }

          if (payload.priced !== undefined && jobData.priced === undefined) {
            jobData.priced = payload.priced;
          }

          const outputDir = getOutputDir();
          const fileName = `dr-${jobData.dr_number || jobData.job_number || Date.now()}.pdf`;
          const outputPath = path.join(outputDir, fileName);

          const doc = generateDeliveryReceiptPdf(
            jobData,
            applyCalibration(payload.config || LAYOUT_CONFIG),
            printerModel,
          );
          fs.writeFileSync(outputPath, Buffer.from(doc.output("arraybuffer")));

          const drSettings = isL121
            ? "paper=A4,paperkind=9,noscale"
            : "paper=A5,paperkind=11,noscale,center";
          if (!isTestMode) {
            printPdf(
              outputPath,
              targetPrinter,
              payload.settings || payload.printSettings || drSettings,
            );
          } else {
            console.log(`[TEST MODE] Delivery receipt PDF saved with template background: ${outputPath}`);
          }
          const isPriced =
            jobData.priced !== false && String(jobData.priced).toLowerCase() !== "false";
          recordJob({
            documentType: `Delivery Receipt (${isL121 ? "Epson L121" : "Center"}${isPriced ? "" : ", Unpriced"})`,
            documentNo: jobData.dr_number || jobData.job_number || "DR",
            printer: targetPrinter || "Default",
            status: "Printed",
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              file: fileName,
              printer: targetPrinter || "default",
              printerModel,
            }),
          );
        } catch (err) {
          console.error("Print request failed:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  // Handle port conflicts gracefully
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(`\n======================================================`);
      console.log(`  PORT ${DAEMON_PORT} IS ALREADY ACTIVE`);
      console.log(`======================================================`);
      console.log(`  Checking connection to existing print agent...`);

      const probeReq = http.get(`http://127.0.0.1:${DAEMON_PORT}/health`, (probeRes) => {
        let data = "";
        probeRes.on("data", (c) => (data += c));
        probeRes.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.status === "running") {
              console.log(`\n  GOOD NEWS: The Print Agent is ALREADY RUNNING and active!`);
              console.log(`  Opening DirectPrint GUI...`);
              if (!process.argv.includes("--no-gui") && !process.env.DIRECT_PRINT_NO_GUI) {
                openAgentGui(DAEMON_PORT);
              }
              setTimeout(() => {
                closeParentTerminal();
                process.exit(0);
              }, 1000);
              return;
            }
          } catch {
            console.log(`  Port ${DAEMON_PORT} is used by another application.`);
          }
          pauseAndExit(0);
        });
      });

      probeReq.on("error", () => {
        console.log(`  Port ${DAEMON_PORT} is occupied by another process.`);
        console.log(`  Please check Task Manager and close previous print or node processes.`);
        pauseAndExit(1);
      });
      return;
    }

    console.error(`\n[Server Error]:`, err);
    pauseAndExit(1);
  });

  const nets = os.networkInterfaces();
  const localIps = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        localIps.push(net.address);
      }
    }
  }

  server.listen(DAEMON_PORT, "0.0.0.0", () => {
    const isWin = process.platform === "win32";
    const isMac = process.platform === "darwin";
    const spooler = isWin ? getOrExtractSpoolerExe() : null;
    const cups = isMac ? getCupsPrinters() : null;
    const spoolerEngine = isWin
      ? spooler
        ? "Ready (Direct Windows Spooler)"
        : "Shell Verb Fallback"
      : isMac
        ? `Ready (macOS CUPS / lp - Default: ${cups?.defaultPrinter || "System Default"})`
        : "Non-Windows / Unsupported";

    console.log(`\n======================================================`);
    console.log(`  Automate DirectPrint Agent is RUNNING on port ${DAEMON_PORT}`);
    console.log(`  Local URL:      http://127.0.0.1:${DAEMON_PORT}`);
    if (localIps.length > 0) {
      console.log(`  ------------------------------------------------------`);
      console.log(`  >>> PC IP ADDRESS FOR WEB BROWSER: <<<`);
      localIps.forEach((ip) => {
        console.log(`      ${ip}`);
      });
      console.log(`  Enter this IP into the web app's Print Helper settings`);
      console.log(`  if you are printing from a Mac, phone, or tablet.`);
      console.log(`  ------------------------------------------------------`);
    }
    console.log(`  Platform:       ${process.platform === "darwin" ? "macOS" : process.platform}`);
    console.log(`  Spooler Engine: ${spoolerEngine}`);
    if (isMac && cups?.printers?.length) {
      console.log(`  CUPS Printers:  ${cups.printers.join(", ")}`);
    }
    console.log(`  Calibrated A5:  Offset +${LAYOUT_CONFIG.globalOffset.leftIn}" applied`);
    console.log(`------------------------------------------------------`);
    console.log(`  Ready! Keep this window open in the background.`);
    console.log(`  (Press 'q' and Enter at any time to quit).`);
    console.log(`======================================================\n`);

    // Launch GUI desktop window if not explicitly disabled
    const shouldOpenGui = !process.argv.includes("--no-gui") && !process.env.DIRECT_PRINT_NO_GUI;
    if (shouldOpenGui) {
      openAgentGui(DAEMON_PORT);
    }

    // Keep console responsive if attached to TTY
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.on("line", (line) => {
        if (line.trim().toLowerCase() === "q") {
          console.log("Stopping print agent...");
          shutdownAgent(0);
        }
      });
    }

    process.on("SIGINT", () => {
      console.log("\nStopping print agent...");
      shutdownAgent(0);
    });
    process.on("SIGTERM", () => {
      console.log("\nStopping print agent...");
      shutdownAgent(0);
    });
  });
}

// --- 8. MAIN ENTRY POINT ---
async function main() {
  const args = process.argv.slice(2);
  const printerArg = args.find((a) => a.startsWith("--printer="));
  const printerName = printerArg ? printerArg.split("=")[1] : undefined;

  // Filter out flags to check if an identifier was provided
  const nonFlagArgs = args.filter((a) => !a.startsWith("--") && !a.startsWith("-"));
  const isExplicitDaemon = args.includes("--daemon") || args.includes("-d");

  // When double-clicked in Windows Explorer (no arguments) or run with --daemon,
  // automatically launch the print daemon and keep listening!
  if (nonFlagArgs.length === 0 || isExplicitDaemon) {
    startPrintDaemon(printerName);
    return;
  }

  const identifier = nonFlagArgs[0];
  const isTest = identifier === "test" || identifier === "test-dr";
  const isTestSi = identifier === "test-si";
  const isTestCv = identifier === "test-cv" || identifier === "test-voucher";
  const isTestCheck = identifier === "test-check";
  const isPdfOnly = args.includes("--pdf-only");

  if (
    isTestCheck ||
    identifier === "check" ||
    identifier.startsWith("chk-") ||
    identifier.startsWith("CHK-")
  ) {
    const expenseId = identifier === "check" ? nonFlagArgs[1] : identifier;
    let checkData;
    if (isTestCheck || !expenseId || expenseId === "test-check") {
      console.log("Using mock Check data for testing...");
      checkData = getMockExpense();
    } else {
      console.log(`Fetching Check for: ${expenseId}...`);
      checkData = await fetchExpense(expenseId);
    }

    const outputDir = getOutputDir();
    const fileName = `check-${checkData.checkNo || checkData.check_number || checkData.id || "test"}.pdf`;
    const outputPath = path.join(outputDir, fileName);

    console.log("Generating pre-printed alignment PDF for Check (portrait feed)...");
    const doc = generateCheckPdf(checkData);
    const pdfBytes = doc.output("arraybuffer");
    fs.writeFileSync(outputPath, Buffer.from(pdfBytes));
    console.log(`PDF created: ${outputPath}`);

    if (!isPdfOnly) {
      const checkSettings = process.env.CHECK_PRINT_SETTINGS || "paper=A4,paperkind=9,noscale";
      printPdf(outputPath, printerName, checkSettings);
    } else {
      console.log("Run with --pdf-only: printing step skipped.");
    }
    return;
  }

  if (
    isTestCv ||
    identifier === "cv" ||
    identifier.startsWith("cv-") ||
    identifier.startsWith("CV-")
  ) {
    const expenseId = identifier === "cv" ? nonFlagArgs[1] : identifier;
    let cvData;
    if (isTestCv || !expenseId || expenseId === "test-cv") {
      console.log("Using mock Check Voucher data for testing...");
      cvData = getMockExpense();
    } else {
      console.log(`Fetching Check Voucher for: ${expenseId}...`);
      cvData = await fetchExpense(expenseId);
    }

    const outputDir = getOutputDir();
    const fileName = `cv-${cvData.documentNo || cvData.id || "test"}.pdf`;
    const outputPath = path.join(outputDir, fileName);

    console.log("Generating pre-printed alignment PDF for Check Voucher (A5 portrait feed)...");
    const doc = generateCheckVoucherPdf(cvData);
    const pdfBytes = doc.output("arraybuffer");
    fs.writeFileSync(outputPath, Buffer.from(pdfBytes));
    console.log(`PDF created: ${outputPath}`);

    if (!isPdfOnly) {
      printPdf(outputPath, printerName, "paper=A5,paperkind=11,noscale,center");
    } else {
      console.log("Run with --pdf-only: printing step skipped.");
    }
    return;
  }

  if (isTestSi || identifier.startsWith("si-") || identifier.startsWith("SI-")) {
    let invoiceData;
    if (isTestSi) {
      console.log("Using mock Service Invoice data for testing...");
      invoiceData = getMockInvoice();
    } else {
      console.log(`Fetching Service Invoice for: ${identifier}...`);
      invoiceData = await fetchInvoice(identifier);
    }

    const outputDir = getOutputDir();
    const fileName = `si-${invoiceData.invoice_number || invoiceData.invoiceNumber || "test"}.pdf`;
    const outputPath = path.join(outputDir, fileName);

    console.log("Generating pre-printed alignment PDF for Service Invoice...");
    const doc = generateServiceInvoicePdf(invoiceData);
    const pdfBytes = doc.output("arraybuffer");
    fs.writeFileSync(outputPath, Buffer.from(pdfBytes));
    console.log(`PDF created: ${outputPath}`);

    if (!isPdfOnly) {
      printPdf(outputPath, printerName, "paper=A5,paperkind=11,noscale,center");
    } else {
      console.log("Run with --pdf-only: printing step skipped.");
    }
    return;
  }

  let jobData;
  if (isTest) {
    console.log("Using mock job order data for testing...");
    jobData = getMockJobOrder();
  } else {
    console.log(`Fetching job order for: ${identifier}...`);
    jobData = await fetchJobOrder(identifier);
  }

  const withoutPrices = args.includes("--without-prices") || args.includes("--unpriced");
  if (withoutPrices && jobData) {
    jobData.priced = false;
  }

  const outputDir = getOutputDir();
  const fileName = `dr-${jobData.dr_number || jobData.job_number || "test"}.pdf`;
  const outputPath = path.join(outputDir, fileName);

  console.log("Generating pre-printed alignment PDF...");
  const doc = generateDeliveryReceiptPdf(jobData);
  const pdfBytes = doc.output("arraybuffer");
  fs.writeFileSync(outputPath, Buffer.from(pdfBytes));
  console.log(`PDF created: ${outputPath}`);

  if (!isPdfOnly) {
    printPdf(outputPath, printerName);
  } else {
    console.log("Run with --pdf-only: printing step skipped.");
  }
}

// Execute if run directly or as a packaged executable
const isDirectRun =
  Boolean(process.pkg) ||
  Boolean(
    process.argv[1] &&
    (fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename) ||
      path.resolve(process.argv[1]) === path.resolve(__filename)),
  );

if (isDirectRun) {
  main().catch((err) => {
    console.error("Error:", err.message);
    pauseAndExit(1);
  });
}
