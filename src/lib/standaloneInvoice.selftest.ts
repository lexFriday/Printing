import { computeStandaloneInvoiceTotals, validateStandaloneInvoiceDraft } from "./standaloneInvoice.ts";

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const vatTotals = computeStandaloneInvoiceTotals(1000, "vatable", true, 0.02);
check(vatTotals.subtotal === 1000, "subtotal");
check(vatTotals.vat === 120, "VAT");
check(vatTotals.ewt === 20, "EWT");
check(vatTotals.amountDue === 1100, "amount due after EWT");

const nonVatTotals = computeStandaloneInvoiceTotals(1000, "non_vat", false, 0.02);
check(nonVatTotals.amountDue === 1000, "non-VAT amount due");

const errors = validateStandaloneInvoiceDraft({
  customerId: null,
  invoiceDate: "",
  dueDate: "2026-01-01",
  lines: [{ description: "", quantity: 0, lineTotal: 0 }],
});
check(errors.includes("Pick a customer."), "customer validation");
check(errors.includes("Invoice date is required."), "date validation");
check(errors.includes("Each line needs a description."), "line validation");
