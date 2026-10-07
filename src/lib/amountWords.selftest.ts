import { amountToPesoWords } from "./amountWords.ts";

function check(actual: string, expected: string) {
  if (actual !== expected) throw new Error(`${actual} !== ${expected}`);
}

check(amountToPesoWords(5000), "FIVE THOUSAND PESOS ONLY");
check(amountToPesoWords(560), "FIVE HUNDRED SIXTY PESOS ONLY");
check(amountToPesoWords(100.5), "ONE HUNDRED PESOS AND 50/100 ONLY");
check(amountToPesoWords(0), "ZERO PESOS ONLY");
