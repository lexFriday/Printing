export function normalizeMoneyInput(value: string) {
  const normalized = value.replaceAll(",", "");
  return /^\d*(?:\.\d*)?$/.test(normalized) ? normalized : null;
}

export function formatMoneyInput(value: string) {
  if (!value) return "";
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return value.includes(".") ? `${grouped}.${fraction ?? ""}` : grouped;
}
