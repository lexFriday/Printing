import {
  getVoucherChanges,
  requiresVoucherCorrectionReason,
  voucherStatus,
  type VoucherFields,
} from "./checkVoucherRevision.ts";

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const printed: VoucherFields = {
  supplier_name: "ABC SUPPLIER",
  amount: 1500,
  description: "DIRECT MATERIALS",
  check_date: "2026-08-13",
  supplier_document_no: "INV-1",
  check_number: "000123",
  voucher_printed_at: "2026-08-13T01:00:00Z",
  voucher_print_count: 1,
};

check(voucherStatus({ voucher_printed_at: null, voucher_print_count: 0 }, false) === "Not printed", "not printed");
check(voucherStatus(printed, false) === "Printed", "printed");
check(voucherStatus({ ...printed, voucher_print_count: 2 }, false) === "Reprinted", "reprinted");
check(voucherStatus(printed, true) === "Revised after print", "revised");

const changes = getVoucherChanges(printed, { ...printed, check_number: "000124", amount: 1500 });
check(changes.length === 1, "one changed voucher field");
check(changes[0].field === "check_number", "check number changed");
check(requiresVoucherCorrectionReason(printed, { ...printed, check_number: "000124" }), "printed change requires reason");
check(!requiresVoucherCorrectionReason({ ...printed, voucher_printed_at: null }, { ...printed, check_number: "000124" }), "unprinted change does not require reason");
