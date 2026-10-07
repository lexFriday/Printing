import assert from "node:assert/strict";
import { resolveDocumentSignature, supportsUserSignatures } from "./documentSignatures.ts";

assert.equal(supportsUserSignatures("quotation"), true);
assert.equal(supportsUserSignatures("job-order"), true);
assert.equal(supportsUserSignatures("check"), false);
assert.equal(supportsUserSignatures("check-voucher"), false);
assert.equal(supportsUserSignatures("sales-invoice"), false);
assert.equal(supportsUserSignatures("delivery-receipt"), false);

assert.equal(
  resolveDocumentSignature({ finalized: false, profileUrl: "profile.png", snapshotUrl: null }),
  "profile.png",
);
assert.equal(
  resolveDocumentSignature({
    finalized: true,
    profileUrl: "changed.png",
    snapshotUrl: "original.png",
  }),
  "original.png",
);
assert.equal(
  resolveDocumentSignature({ finalized: true, profileUrl: "changed.png", snapshotUrl: null }),
  null,
);

assert.equal(
  resolveDocumentSignature({ finalized: false, profileUrl: "profile.png", snapshotUrl: null }),
  "profile.png",
  "drafts use the selected signer's current signature",
);

console.log("document signature self-test passed");
