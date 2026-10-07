export type CashSalesExportRow = {
  or_number: string | number | null;
  date: string;
  company: string | null;
  amount_paid: number;
  invoice: string | number | null;
  input_vat: number;
  ewt: number;
  tin: string | null;
  address: string | null;
};

const HEADERS = ["OR", "DATE", "COMPANY", "AMOUNT PAID", "INVOICE", "INPUT VAT", "EWT", "TIN", "ADDRESS"];

export function buildCashSalesCsv(rows: CashSalesExportRow[]) {
  return [
    HEADERS.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.or_number,
        row.date,
        row.company,
        money(row.amount_paid),
        row.invoice,
        money(row.input_vat),
        money(row.ewt),
        row.tin,
        row.address,
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\r\n");
}

function money(value: number) {
  return value.toFixed(2);
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
