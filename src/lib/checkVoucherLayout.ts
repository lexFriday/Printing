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
  date: { topIn: 1.4375, leftIn: 6.25, widthIn: 1.85, fontSize: 13, align: "center" }, // 1 7/16"
  payee: { topIn: 2.0000, leftIn: 1.78, widthIn: 3.95, fontSize: 13, align: "left" }, // 2"
  particulars: { topIn: 3.175, leftIn: 0.82, widthIn: 5.45, fontSize: 11, align: "left" }, // 3 3/16" (aligned with amount)
  amount1: { topIn: 3.175, leftIn: 6.6, widthIn: 1.1, fontSize: 13, align: "right" }, // 3 3/16" (aligned with particulars)
  amount2: { topIn: 3.40, leftIn: 6.6, widthIn: 1.1, fontSize: 13, align: "right" },
  documentNo: { topIn: 5.0862, leftIn: 3.1456, widthIn: 1.9, fontSize: 12, align: "center" },
  checkNo: { topIn: 5.0862, leftIn: 6.3056, widthIn: 1.45, fontSize: 12, align: "center" },
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
