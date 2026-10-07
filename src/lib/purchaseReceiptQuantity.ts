export function displayReceiptQuantity(input: string | null, remaining: number) {
  return input ?? String(remaining);
}

export function parseReceiptQuantity(input: string | null, remaining: number) {
  return Number(input === null ? remaining : input);
}
