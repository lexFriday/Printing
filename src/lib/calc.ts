// PRD §11.10 — derived calculations. Single source of truth for client-side previews.
// Server triggers recompute quote totals; this mirrors them for live UI.

export type Uom = "inches" | "feet" | "millimeters" | "centimeters" | "meters";

const TO_FEET: Record<Uom, number> = {
  inches: 1 / 12,
  feet: 1,
  millimeters: 1 / 304.8,
  centimeters: 1 / 30.48,
  meters: 3.28084,
};

export function toFeet(value: number, uom: Uom): number {
  return value * TO_FEET[uom];
}

export function computeSqft(width: number, height: number, uom: Uom): number {
  return toFeet(width, uom) * toFeet(height, uom);
}

export interface SqftInput {
  pricing_mode: "sqft";
  width: number;
  height: number;
  unit_of_measure: Uom;
  rate_per_sqft: number;
  quantity: number;
  adjustment_amount?: number;
}
export interface FixedInput {
  pricing_mode: "fixed";
  unit_price: number;
  quantity: number;
  adjustment_amount?: number;
}

export function computeLine(input: SqftInput | FixedInput) {
  const adjustment = input.adjustment_amount || 0;
  if (input.pricing_mode === "sqft") {
    const sqft = computeSqft(input.width || 0, input.height || 0, input.unit_of_measure);
    const unitPrice = sqft * (input.rate_per_sqft || 0);
    const lineTotal = unitPrice * (input.quantity || 0) + adjustment;
    return { computed_sqft: sqft, unit_price: unitPrice, line_total: lineTotal };
  }
  const lineTotal = (input.unit_price || 0) * (input.quantity || 0) + adjustment;
  return { computed_sqft: null, unit_price: input.unit_price || 0, line_total: lineTotal };
}

export function receivableStatus(
  invoiceAmount: number,
  amountPaid: number,
  dueDate?: string | null,
) {
  const balance = Math.max(invoiceAmount - amountPaid, 0);
  const today = new Date().toISOString().slice(0, 10);
  if (balance <= 0) return "paid";
  if (dueDate && dueDate < today) return "overdue";
  return amountPaid > 0 ? "partially_paid" : "unpaid";
}

export function daysOutstanding(dueDate?: string | null) {
  if (!dueDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate >= today) return null;
  return Math.floor((Date.parse(today) - Date.parse(dueDate)) / 86_400_000);
}

export function computeMaterialAmount(quantity: number | string, unitCost: number | string) {
  return Number(quantity || 0) * Number(unitCost || 0);
}

export function computeInclusiveVat(total: number | string) {
  const vatableSales = Number(total || 0);
  const vat = vatableSales * 0.12;
  return {
    vatableSales,
    vat,
    grossTotal: vatableSales + vat,
  };
}

export function computeQuoteDisplayTotal(quote: {
  subtotal?: number | string | null;
  adjustment_amount?: number | string | null;
  total_amount?: number | string | null;
  tax_type?: string | null;
}) {
  const baseTotal = Number(quote.subtotal || 0) + Number(quote.adjustment_amount || 0);
  if (quote.tax_type === "vatable" && baseTotal > 0)
    return computeInclusiveVat(baseTotal).grossTotal;
  return baseTotal || Number(quote.total_amount || 0);
}
