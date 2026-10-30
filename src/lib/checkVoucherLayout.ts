export const CHECK_VOUCHER_PAGE_SIZE_IN = { width: 210 / 25.4, height: 148 / 25.4 } as const; // A5 Landscape (8.2677" x 5.8268")
export const CHECK_VOUCHER_PAGE_SIZE_PT = [CHECK_VOUCHER_PAGE_SIZE_IN.width * 72, CHECK_VOUCHER_PAGE_SIZE_IN.height * 72] as const;
// The physical voucher is the print canvas. Calibration must not add a lead
// to the production overlay because that shifts every field off the form.
export const CHECK_VOUCHER_CALIBRATION_LEAD_IN_IN = 0;
export const CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_IN = {
  width: CHECK_VOUCHER_PAGE_SIZE_IN.width,
  height: CHECK_VOUCHER_PAGE_SIZE_IN.height + CHECK_VOUCHER_CALIBRATION_LEAD_IN_IN,
} as const;
export const CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_PT = [
  CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_IN.width * 72,
  CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_IN.height * 72,
] as const;

export const CHECK_VOUCHER_PRINT_PROFILE = {
  mediaWidthIn: CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_IN.width,
  mediaHeightIn: CHECK_VOUCHER_CALIBRATION_PAGE_SIZE_IN.height,
  orientation: "landscape",
  scalePercent: 100,
  marginsIn: 0,
  fitToPage: false,
  centerOnPage: false,
} as const;

export const CHECK_VOUCHER_FIELDS = {
  date: { topIn: 1.45, leftIn: 6.85, widthIn: 1.25, fontSize: 10, align: "center" },
  payee: { topIn: 1.85, leftIn: 1.15, widthIn: 3.95, fontSize: 10.5, align: "left" },
  particulars: { topIn: 2.92, leftIn: 0.50, widthIn: 5.10, fontSize: 9.5, align: "left" },
  checkDateHeader: { topIn: 3.55, leftIn: 1.20, widthIn: 1.5, fontSize: 9, align: "center" },
  checkDateValue: { topIn: 3.75, leftIn: 1.20, widthIn: 1.5, fontSize: 9.5, align: "center" },
  documentNoHeader: { topIn: 3.55, leftIn: 2.90, widthIn: 1.6, fontSize: 9, align: "center" },
  documentNoValue: { topIn: 3.75, leftIn: 2.90, widthIn: 1.6, fontSize: 10, align: "center" },
  checkNoHeader: { topIn: 3.55, leftIn: 4.60, widthIn: 1.4, fontSize: 9, align: "center" },
  checkNoValue: { topIn: 3.75, leftIn: 4.60, widthIn: 1.4, fontSize: 10, align: "center" },
  amount1: { topIn: 3.10, leftIn: 6.6, widthIn: 0.85, fontSize: 10, align: "right" },
  amount2: { topIn: 3.32, leftIn: 6.6, widthIn: 0.85, fontSize: 10, align: "right" },
  documentNo: { topIn: 3.75, leftIn: 2.90, widthIn: 1.6, fontSize: 10, align: "center" },
  checkNo: { topIn: 3.75, leftIn: 4.60, widthIn: 1.4, fontSize: 10, align: "center" },
  preparedBy: { topIn: 5.62, leftIn: 1.33, widthIn: 1.4, fontSize: 10, align: "center" },
} as const;

export type CheckVoucherField = (typeof CHECK_VOUCHER_FIELDS)[keyof typeof CHECK_VOUCHER_FIELDS];

export function assertCheckVoucherLayout() {
  if (Math.round(CHECK_VOUCHER_PAGE_SIZE_PT[0]) !== Math.round(CHECK_VOUCHER_PAGE_SIZE_IN.width * 72)) {
    throw new Error("Check voucher PDF width must match A5 landscape width.");
  }
  if (Math.round(CHECK_VOUCHER_PAGE_SIZE_PT[1]) !== Math.round(CHECK_VOUCHER_PAGE_SIZE_IN.height * 72)) {
    throw new Error("Check voucher PDF height must match A5 landscape height.");
  }
  for (const [name, field] of Object.entries(CHECK_VOUCHER_FIELDS)) {
    if (field.topIn < 0 || field.leftIn < 0) throw new Error(`${name} starts outside the page.`);
    if (field.leftIn + field.widthIn > CHECK_VOUCHER_PAGE_SIZE_IN.width) {
      throw new Error(`${name} exceeds the page width.`);
    }
    if (field.topIn > CHECK_VOUCHER_PAGE_SIZE_IN.height) {
      throw new Error(`${name} starts below the page.`);
    }
  }
}
