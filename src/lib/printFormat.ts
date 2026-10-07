export function formatPrintMoney(value: number | string | null | undefined) {
  return Number(value ?? 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPrintQty(value: number | string | null | undefined) {
  return Number(value ?? 0).toLocaleString("en-PH", { maximumFractionDigits: 2 });
}
