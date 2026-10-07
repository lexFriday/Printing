import { expect, test } from "bun:test";
import { quotePaperForCompany } from "../src/lib/quotePaper";

test("NJL quotations use the approved US Letter letterhead", () => {
  expect(quotePaperForCompany("NJL Advertising Solutions Inc.")).toEqual({
    format: "letter",
    letterhead: "/brand/njl-2026-letterhead.png",
    topInset: "1.72in",
    bottomInset: "1.45in",
  });
});
