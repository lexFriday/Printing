import { supabase } from "../integrations/supabase/client.ts";
import {
  clearSignatureBackground,
  findSignatureBounds,
  signatureFileError,
  signatureObjectPath,
} from "./signatureRules";

export const SIGNATURE_BUCKET = "user-signatures";

export async function normalizeSignatureImage(file: File) {
  const validationError = signatureFileError(file);
  if (validationError) throw new Error(validationError);

  const bitmap = await createImageBitmap(file);
  try {
    const source = document.createElement("canvas");
    source.width = bitmap.width;
    source.height = bitmap.height;
    const sourceContext = source.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) throw new Error("This browser cannot process the signature image.");
    sourceContext.drawImage(bitmap, 0, 0);
    const pixels = sourceContext.getImageData(0, 0, bitmap.width, bitmap.height);
    const bounds = findSignatureBounds(pixels.data, bitmap.width, bitmap.height);
    if (!bounds) throw new Error("No visible signature was found in this image.");

    const inkWidth = bounds.right - bounds.left + 1;
    const inkHeight = bounds.bottom - bounds.top + 1;
    const margin = Math.max(8, Math.round(Math.max(inkWidth, inkHeight) * 0.06));
    const left = Math.max(0, bounds.left - margin);
    const top = Math.max(0, bounds.top - margin);
    const right = Math.min(bitmap.width - 1, bounds.right + margin);
    const bottom = Math.min(bitmap.height - 1, bounds.bottom + margin);

    const output = document.createElement("canvas");
    output.width = right - left + 1;
    output.height = bottom - top + 1;
    const outputContext = output.getContext("2d");
    if (!outputContext) throw new Error("This browser cannot process the signature image.");
    outputContext.drawImage(
      source,
      left,
      top,
      output.width,
      output.height,
      0,
      0,
      output.width,
      output.height,
    );
    const normalizedPixels = outputContext.getImageData(0, 0, output.width, output.height);
    clearSignatureBackground(normalizedPixels.data);
    outputContext.putImageData(normalizedPixels, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      output.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error("Could not prepare the signature image.")),
        "image/png",
      ),
    );
    const normalized = new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "signature"}.png`, {
      type: "image/png",
    });
    const normalizedError = signatureFileError(normalized);
    if (normalizedError) throw new Error(normalizedError);
    return normalized;
  } finally {
    bitmap.close();
  }
}

export async function uploadUserSignature(userId: string, file: File) {
  const validationError = signatureFileError(file);
  if (validationError) throw new Error(validationError);
  const path = signatureObjectPath(userId, file.type);
  const { error: uploadError } = await supabase.storage
    .from(SIGNATURE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;
  const { error } = await supabase.rpc("set_user_signature", {
    p_target_user_id: userId,
    p_object_path: path,
  });
  if (error) throw error;
  return path;
}

export async function removeUserSignature(userId: string) {
  const { error } = await supabase.rpc("set_user_signature", {
    p_target_user_id: userId,
    p_object_path: null,
  });
  if (error) throw error;
}

export async function signedSignatureUrl(path: string | null | undefined) {
  if (!path) return null;
  if (/^(?:data:|https?:)/.test(path)) return path;
  const { data, error } = await supabase.storage.from(SIGNATURE_BUCKET).createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}
