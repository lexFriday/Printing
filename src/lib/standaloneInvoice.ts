import { computeInclusiveVat } from "./calc";

export type StandaloneInvoiceTaxType = "vatable" | "non_vat";

export function computeStandaloneInvoiceTotals(
  subtotal: number,
  taxType: StandaloneInvoiceTaxType,
  ewtEnabled: boolean,
  ewtRate: number,
) {
  const vat = computeInclusiveVat(subtotal);
  const grossTotal = taxType === "vatable" ? vat.grossTotal : subtotal;
  const ewt = ewtEnabled ? vat.vatableSales * ewtRate : 0;
  return {
    subtotal,
    vatableSales: taxType === "vatable" ? vat.vatableSales : subtotal,
    vat: taxType === "vatable" ? vat.vat : 0,
    ewt,
    grossTotal,
    amountDue: grossTotal - ewt,
  };
}

export function validateStandaloneInvoiceDraft(input: {
  customerId: string | null;
  invoiceDate: string;
  dueDate: string;
  lines: Array<{ description: string; quantity: number; lineTotal: number }>;
}) {
  const errors: string[] = [];
  if (!input.customerId) errors.push("Pick a customer.");
  if (!input.invoiceDate) errors.push("Invoice date is required.");
  if (input.dueDate && input.dueDate < input.invoiceDate) {
    errors.push("Due date cannot be before invoice date.");
  }
  if (input.lines.length === 0) errors.push("Add at least one invoice line.");
  for (const line of input.lines) {
    if (!line.description.trim()) errors.push("Each line needs a description.");
    if (line.quantity <= 0) errors.push("Quantity must be greater than zero.");
    if (line.lineTotal <= 0) errors.push("Line total must be greater than zero.");
  }
  if (input.lines.reduce((sum, line) => sum + line.lineTotal, 0) <= 0) {
    errors.push("Invoice total must be greater than zero.");
  }
  return [...new Set(errors)];
}
