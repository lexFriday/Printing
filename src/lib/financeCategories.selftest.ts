import {
  DISBURSEMENT_CATEGORIES,
  DISBURSEMENT_SUBCATEGORIES,
  categoryLabel,
  subcategoryLabel,
  type DisbursementCategory,
} from "./financeCategories.ts";

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

check(categoryLabel("direct_materials") === "Direct Materials", "direct materials label");
check(categoryLabel("salary_and_wages") === "Salary and Wages", "salary label");
check(subcategoryLabel("1601c") === "1601-C", "EFPS 1601-C label");
check(subcategoryLabel("hdmf") === "HDMF", "HDMF label");

const categoryValues = new Set(DISBURSEMENT_CATEGORIES.map((category) => category.value));
for (const category of DISBURSEMENT_CATEGORIES) {
  check(category.label.trim().length > 0, `missing label for ${category.value}`);
}

for (const [category, subcategories] of Object.entries(DISBURSEMENT_SUBCATEGORIES) as Array<
  [DisbursementCategory, (typeof DISBURSEMENT_SUBCATEGORIES)[DisbursementCategory]]
>) {
  check(categoryValues.has(category), `unknown category ${category}`);
  for (const subcategory of subcategories) {
    check(subcategory.label.trim().length > 0, `missing label for ${subcategory.value}`);
  }
}
