import type { Database } from "@/integrations/supabase/types";

export type DisbursementCategory = Database["public"]["Enums"]["disbursement_category"];
export type DisbursementSubcategory = Database["public"]["Enums"]["disbursement_subcategory"];

export const DISBURSEMENT_CATEGORIES = [
  { value: "direct_materials", label: "Direct Materials" },
  { value: "petty_cash", label: "Petty Cash" },
  { value: "communication", label: "Communication" },
  { value: "representation", label: "Representation" },
  { value: "commission", label: "Commission" },
  { value: "utilities", label: "Utilities" },
  { value: "salary_and_wages", label: "Salary and Wages" },
  { value: "security_expenses", label: "Security Expenses" },
  { value: "efps", label: "EFPS" },
  { value: "egov", label: "EGOV" },
  { value: "other", label: "Other" },
] as const satisfies ReadonlyArray<{ value: DisbursementCategory; label: string }>;

export const DISBURSEMENT_SUBCATEGORIES = {
  direct_materials: [{ value: "direct_materials", label: "Direct Materials" }],
  petty_cash: [
    { value: "direct_materials", label: "Direct Materials" },
    { value: "transportation", label: "Transportation" },
    { value: "gas", label: "Gas" },
    { value: "meals", label: "Meals" },
    { value: "load", label: "Load" },
    { value: "garbage_collection", label: "Garbage Collection" },
    { value: "extra_salary", label: "Extra Salary" },
    { value: "parking", label: "Parking" },
    { value: "other", label: "Other" },
  ],
  communication: [
    { value: "globe", label: "Globe" },
    { value: "smart", label: "Smart" },
    { value: "other", label: "Other" },
  ],
  representation: [{ value: "other", label: "Other" }],
  commission: [{ value: "other", label: "Other" }],
  utilities: [
    { value: "meralco", label: "Meralco" },
    { value: "manila_water", label: "Manila Water Company" },
    { value: "other", label: "Other" },
  ],
  salary_and_wages: [{ value: "other", label: "Other" }],
  security_expenses: [
    { value: "apeiros", label: "Apeiros" },
    { value: "other", label: "Other" },
  ],
  efps: [
    { value: "1601c", label: "1601-C" },
    { value: "2550q", label: "2550Q" },
    { value: "other", label: "Other" },
  ],
  egov: [
    { value: "sss", label: "SSS" },
    { value: "phic", label: "PHIC" },
    { value: "hdmf", label: "HDMF" },
    { value: "other", label: "Other" },
  ],
  other: [{ value: "other", label: "Other" }],
} as const satisfies Record<
  DisbursementCategory,
  ReadonlyArray<{ value: DisbursementSubcategory; label: string }>
>;

const CATEGORY_LABELS = new Map(
  DISBURSEMENT_CATEGORIES.map((category) => [category.value, category.label]),
);

const SUBCATEGORY_LABELS = new Map(
  Object.values(DISBURSEMENT_SUBCATEGORIES)
    .flat()
    .map((subcategory) => [subcategory.value, subcategory.label]),
);

export function categoryLabel(value: DisbursementCategory | null | undefined) {
  return value ? (CATEGORY_LABELS.get(value) ?? value) : "Uncategorized";
}

export function subcategoryLabel(value: DisbursementSubcategory | null | undefined) {
  return value ? (SUBCATEGORY_LABELS.get(value) ?? value) : "";
}
