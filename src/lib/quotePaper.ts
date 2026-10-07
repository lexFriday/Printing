export type QuotePaper = {
  format: "letter";
  letterhead: string;
  topInset: string;
  bottomInset: string;
};

export function quotePaperForCompany(companyName: string): QuotePaper | null {
  // Arlechino documents use the shared generated header and logo. Do not
  // apply the legacy NJL preprinted letterhead to quotations.
  void companyName;
  return null;
}
