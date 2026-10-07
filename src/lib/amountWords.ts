const ONES = [
  "ZERO",
  "ONE",
  "TWO",
  "THREE",
  "FOUR",
  "FIVE",
  "SIX",
  "SEVEN",
  "EIGHT",
  "NINE",
  "TEN",
  "ELEVEN",
  "TWELVE",
  "THIRTEEN",
  "FOURTEEN",
  "FIFTEEN",
  "SIXTEEN",
  "SEVENTEEN",
  "EIGHTEEN",
  "NINETEEN",
];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

export function amountToPesoWords(value: number | string) {
  const amount = Math.max(0, Math.round(Number(value || 0) * 100));
  const pesos = Math.floor(amount / 100);
  const cents = amount % 100;
  const pesoLabel = pesos === 1 ? "PESO" : "PESOS";
  return cents
    ? `${numberToWords(pesos)} ${pesoLabel} AND ${String(cents).padStart(2, "0")}/100 ONLY`
    : `${numberToWords(pesos)} ${pesoLabel} ONLY`;
}

function numberToWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100)
    return [TENS[Math.floor(n / 10)], n % 10 ? ONES[n % 10] : ""].filter(Boolean).join(" ");
  if (n < 1000) return joinScale(n, 100, "HUNDRED");
  if (n < 1_000_000) return joinScale(n, 1000, "THOUSAND");
  if (n < 1_000_000_000) return joinScale(n, 1_000_000, "MILLION");
  return joinScale(n, 1_000_000_000, "BILLION");
}

function joinScale(n: number, scale: number, label: string) {
  const head = Math.floor(n / scale);
  const tail = n % scale;
  return [numberToWords(head), label, tail ? numberToWords(tail) : ""].filter(Boolean).join(" ");
}
