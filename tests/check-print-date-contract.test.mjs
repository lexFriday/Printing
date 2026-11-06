import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/routes/expenses.$id.check.print.tsx", import.meta.url),
  "utf8"
);

// Verify Switch and Input are imported and used
assert.match(source, /import\s*\{[^}]*Switch[^}]*\}\s*from\s*["']@\/components\/ui\/switch["']/, "Must import Switch");
assert.match(source, /import\s*\{[^}]*Input[^}]*\}\s*from\s*["']@\/components\/ui\/input["']/, "Must import Input");

// Verify auto/manual date state exists
assert.match(source, /useAutoDate/, "Must manage auto date toggle state");
assert.match(source, /manualDate/, "Must manage manual date input state");

// Verify UI renders Switch and date input
assert.match(source, /type=["']date["']/, "Must render type='date' input when in manual mode");

console.log("✓ Check print date contract test passed");

