import { supabase } from "@/integrations/supabase/client";

export const quoteReferenceImageTypes = ["image/jpeg", "image/png", "image/webp"];
export const quoteReferenceImageMaxSize = 10 * 1024 * 1024;

export function validateQuoteReferenceImage(file: File) {
  if (!quoteReferenceImageTypes.includes(file.type)) {
    return "Upload JPG, PNG, or WEBP images only.";
  }
  if (file.size > quoteReferenceImageMaxSize) {
    return "Image must be 10MB or smaller.";
  }
  return null;
}

export async function uploadQuoteReferenceImage({
  quotationId,
  quoteLineItemId,
  file,
  uploadedBy,
}: {
  quotationId: string;
  quoteLineItemId: string | null;
  file: File;
  uploadedBy?: string | null;
}) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const storagePath = `${quotationId}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("quote-attachments")
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { error: insertError } = await supabase.from("quote_attachments").insert({
    quotation_id: quotationId,
    quote_line_item_id: quoteLineItemId,
    storage_path: storagePath,
    file_name: file.name,
    file_type: file.type,
    file_size: file.size,
    uploaded_by: uploadedBy ?? null,
  });
  if (insertError) throw insertError;
}
