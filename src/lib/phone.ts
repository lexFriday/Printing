export function normalizePhone(value?: string | null) {
  const raw = value?.trim() ?? "";
  if (!raw) return "";

  // Keep non-Philippine and landline formats intact; only normalize the local
  // 11-digit mobile format used by the customer contact workflow.
  const digits = raw.replace(/\D/g, "");
  return /^09\d{9}$/.test(digits) ? digits : raw;
}

export function formatPhoneInput(value?: string | null) {
  const raw = value ?? "";
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (!/^09/.test(digits)) return raw;

  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
}
