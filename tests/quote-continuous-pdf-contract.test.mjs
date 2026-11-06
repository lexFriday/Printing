import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/routes/quotes.$id.print.tsx", import.meta.url),
  "utf8"
);

// Verify jsPDF creates a continuous height PDF
assert.match(
  source,
  /const\s+contentHeightPt\s*=\s*\(canvas\.height\s*\*\s*pageWidthPt\)\s*\/\s*canvas\.width/,
  "Must calculate exact continuous content height in points"
);

assert.match(
  source,
  /new\s+jsPDF\(["']p["'],\s*["']pt["'],\s*\[pageWidthPt,\s*pageHeightPt\]\)/,
  "Must initialize jsPDF with dynamic continuous page size [pageWidthPt, pageHeightPt]"
);

// Verify multi-page canvas slicing has been removed
assert.doesNotMatch(
  source,
  /function\s+addCanvasToPdf/,
  "Must not contain addCanvasToPdf slicing function"
);

// Verify single unbroken image placement
assert.match(
  source,
  /pdf\.addImage\(canvas\.toDataURL\(["']image\/png["']\),\s*["']PNG["'],\s*0,\s*0,\s*pageWidthPt,\s*contentHeightPt\)/,
  "Must place canvas directly onto continuous single-page PDF"
);

console.log("✓ Quote continuous PDF contract test passed");

