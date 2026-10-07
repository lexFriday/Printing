export type VoucherFields = {
  supplier_name: string | null;
  amount: number;
  description: string;
  check_date: string | null;
  supplier_document_no: string | null;
  check_number: string | null;
  voucher_printed_at: string | null;
  voucher_print_count: number;
};

export type VoucherChange = {
  field: keyof Pick<
    VoucherFields,
    "supplier_name" | "amount" | "description" | "check_date" | "supplier_document_no" | "check_number"
  >;
  previous: string | number | null;
  next: string | number | null;
};

const VOUCHER_FIELDS = [
  "supplier_name",
  "amount",
  "description",
  "check_date",
  "supplier_document_no",
  "check_number",
] as const;

export function getVoucherChanges(previous: VoucherFields, next: VoucherFields): VoucherChange[] {
  return VOUCHER_FIELDS.flatMap((field) =>
    previous[field] === next[field]
      ? []
      : [{ field, previous: previous[field], next: next[field] }],
  );
}

export function requiresVoucherCorrectionReason(previous: VoucherFields, next: VoucherFields) {
  return Boolean(previous.voucher_printed_at && getVoucherChanges(previous, next).length > 0);
}

export function voucherStatus(
  voucher: Pick<VoucherFields, "voucher_printed_at" | "voucher_print_count">,
  hasRevision: boolean,
) {
  if (hasRevision) return "Revised after print";
  if (!voucher.voucher_printed_at) return "Not printed";
  return voucher.voucher_print_count > 1 ? "Reprinted" : "Printed";
}
