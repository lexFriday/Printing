import type { Uom } from "@/lib/calc";

export interface QuoteDraftLine {
  id?: string | null;
  template_id: string;
  description: string;
  pricing_mode: "sqft" | "fixed";
  unit_of_measure: Uom;
  width: string;
  height: string;
  depth?: string;
  quantity: string;
  rate_per_sqft: string;
  unit_price: string;
  adjustment_label?: string;
  adjustment_amount?: string;
  show_adjustment?: boolean;
}

export interface QuoteDraftState {
  serverDraftId?: string;
  customerId: string | null;
  customerContactId?: string | null;
  customerContactName?: string | null;
  customerContactPhone?: string | null;
  customerContactEmail?: string | null;
  projectName: string;
  quoteDate: string;
  taxType: "vatable" | "non_vat";
  salesAgent: string;
  salesAgentUserId: string | null;
  adjustmentLabel: string;
  adjustmentAmount: string;
  terms: string;
  remarks: string;
  isNoCharge?: boolean;
  noChargeReason?: string;
  lines: QuoteDraftLine[];
  savedAt: number;
}

export function buildQuoteDraftKey(scope: "new" | "edit", id = "active") {
  return `automate-ph:quote-draft:${scope}:${id}`;
}

export function loadQuoteDraft(key: string): QuoteDraftState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as QuoteDraftState;
  } catch {
    return null;
  }
}

export function saveQuoteDraft(key: string, draft: Omit<QuoteDraftState, "savedAt">) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Local recovery should never interrupt quotation editing.
  }
}

export function clearQuoteDraft(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function isQuoteDraftValidForSystemSave(draft: QuoteDraftState, quoteTotal: number) {
  if (!draft.customerId) return false;
  if (!draft.projectName.trim()) return false;
  if (!draft.lines.length) return false;
  if (quoteTotal <= 0) return false;

  return draft.lines.every((line) => {
    if (!line.description.trim()) return false;
    if (Number(line.quantity) <= 0) return false;
    if (line.pricing_mode === "fixed") return Number(line.unit_price) > 0;
    return Number(line.width) > 0 && Number(line.height) > 0 && Number(line.rate_per_sqft) > 0;
  });
}
