export function productionStatusLabel(value: string | null | undefined) {
  if (!value) return "Not prepared";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
