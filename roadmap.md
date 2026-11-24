# Current request

- [x] Apply the two pending Drizzle migrations after reviewing live schema and history; both database changes verified.
- [x] Clear the existing reports export preview error and verify the preview; build OK and sign-in opens without runtime errors.
- [x] Check security; publish request is the final delivery action.

## Verification notes

- Account approval contract passes. The existing reports contract fails on a missing receipt-validation message unrelated to the type-only fix.
- The history inspection found six older applied records without matching repository entries; no history was rewritten.
- Security scan completed with two warnings (supplier write permissions and leaked-password protection); no critical findings returned.