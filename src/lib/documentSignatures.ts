export type SignedDocumentKind =
  "quotation" | "job-order" | "check" | "check-voucher" | "sales-invoice" | "delivery-receipt";

export function supportsUserSignatures(kind: SignedDocumentKind) {
  return kind === "quotation" || kind === "job-order";
}

export function resolveDocumentSignature({
  finalized,
  profileUrl,
  snapshotUrl,
}: {
  finalized: boolean;
  profileUrl: string | null;
  snapshotUrl: string | null;
}) {
  return finalized ? snapshotUrl : profileUrl;
}
