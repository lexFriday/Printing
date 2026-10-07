import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routes = [
  ["src/routes/invoices.$id.print.tsx", "invoice"],
  ["src/routes/jobs.$id.delivery-receipt.print.tsx", "delivery-receipt"],
  ["src/routes/expenses.$id.check-voucher.print.tsx", "check-voucher"],
  ["src/routes/expenses.$id.check.print.tsx", "check"],
];
for (const [file, type] of routes) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  assert.match(source, /resolveFieldOffset/, `${file} must resolve field offsets`);
  assert.match(source, new RegExp(`calibrationDocument=["']${type}["']`), `${file} must use ${type}`);
}
console.log("Print calibration route contract passed");
