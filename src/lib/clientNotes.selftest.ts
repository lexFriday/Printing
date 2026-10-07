import { computeInclusiveVat, computeMaterialAmount } from "./calc.ts";

function check(actual: number, expected: number) {
  if (Math.abs(actual - expected) > 0.01) throw new Error(`${actual} !== ${expected}`);
}

check(computeMaterialAmount(3, 1340), 4020);
check(computeInclusiveVat(1000).vatableSales, 1000);
check(computeInclusiveVat(1000).vat, 120);
check(computeInclusiveVat(1000).grossTotal, 1120);
