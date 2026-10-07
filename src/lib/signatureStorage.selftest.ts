import assert from "node:assert/strict";
import {
  clearSignatureBackground,
  findSignatureBounds,
  signatureFileError,
  signatureObjectPath,
} from "./signatureRules.ts";

assert.equal(signatureFileError({ type: "image/png", size: 400_000 }), null);
assert.equal(
  signatureFileError({ type: "image/svg+xml", size: 1_000 }),
  "Upload a PNG, JPG, or WEBP image.",
);
assert.equal(
  signatureFileError({ type: "image/jpeg", size: 600_000 }),
  "Signature image must be 512 KB or smaller.",
);
assert.match(signatureObjectPath("user-123", "image/webp"), /^user-123\/[0-9a-f-]+\.webp$/);

const rgba = new Uint8ClampedArray(6 * 4 * 4).fill(255);
for (let y = 1; y <= 2; y += 1) {
  for (let x = 2; x <= 4; x += 1) {
    const offset = (y * 6 + x) * 4;
    rgba[offset] = 10;
    rgba[offset + 1] = 20;
    rgba[offset + 2] = 30;
    rgba[offset + 3] = 255;
  }
}
assert.deepEqual(findSignatureBounds(rgba, 6, 4), { left: 2, top: 1, right: 4, bottom: 2 });
assert.equal(findSignatureBounds(new Uint8ClampedArray(4 * 4 * 4), 4, 4), null);

const backgroundPixels = new Uint8ClampedArray([255, 255, 255, 255, 20, 30, 40, 255]);
clearSignatureBackground(backgroundPixels);
assert.equal(backgroundPixels[3], 0);
assert.equal(backgroundPixels[7], 255);

console.log("signature storage self-test passed");
