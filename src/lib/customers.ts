import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/phone";

const duplicateTinConstraint = "customers_tin_number_normalized_key";
const duplicateTinMessage = "This TIN is already assigned to another customer.";

export function normalizeTin(value?: string | null) {
  const normalized = value?.replace(/\D/g, "") ?? "";
  return normalized || null;
}

export function formatTin(value?: string | null) {
  const tin = normalizeTin(value);
  if (!tin) return "";
  return tin
    .slice(0, 12)
    .replace(/(\d{3})(?=\d)/g, "$1-")
    .replace(/-$/, "");
}

export function customerErrorMessage(error: Error) {
  if (error.message.includes(duplicateTinConstraint)) {
    return duplicateTinMessage;
  }

  return error.message;
}

export async function assertCustomerTinAvailable(
  tinNumber?: string | null,
  currentCustomerId?: string,
) {
  const tin = normalizeTin(tinNumber);
  if (!tin) return;

  const { data, error } = await supabase
    .from("customers")
    .select("id, tin_number")
    .not("tin_number", "is", null);
  if (error) throw error;

  const duplicate = data?.some(
    (customer) => customer.id !== currentCustomerId && normalizeTin(customer.tin_number) === tin,
  );
  if (duplicate) throw new Error(duplicateTinMessage);
}

export function cleanCustomer(f: {
  customer_name: string;
  contact_person: string;
  contact_number: string;
  email?: string;
  tin_number?: string;
  address?: string;
  notes?: string;
}) {
  return {
    customer_name: f.customer_name.trim(),
    contact_person: f.contact_person.trim(),
    contact_number: normalizePhone(f.contact_number),
    email: f.email?.trim() || null,
    tin_number: normalizeTin(f.tin_number),
    address: f.address?.trim() || null,
    notes: f.notes?.trim() || null,
  };
}
