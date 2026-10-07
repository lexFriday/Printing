import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { materialNameSchema } from "../src/lib/materialName.ts";

describe("materialNameSchema", () => {
  it("trims a valid material name", () => {
    assert.equal(materialNameSchema.parse("  Glossy Vinyl  "), "Glossy Vinyl");
  });

  it("rejects a blank material name", () => {
    assert.throws(() => materialNameSchema.parse("   "), /Material name is required/);
  });
});
