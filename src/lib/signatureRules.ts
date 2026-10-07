const signatureTypes = ["image/png", "image/jpeg", "image/webp"];
const maxSignatureSize = 512 * 1024;

export type SignatureBounds = { left: number; top: number; right: number; bottom: number };

export function signatureFileError(file: { type: string; size: number }) {
  if (!signatureTypes.includes(file.type)) return "Upload a PNG, JPG, or WEBP image.";
  if (file.size > maxSignatureSize) return "Signature image must be 512 KB or smaller.";
  return null;
}

export function signatureObjectPath(userId: string, mimeType: string) {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  return `${userId}/${crypto.randomUUID()}.${extension}`;
}

export function findSignatureBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): SignatureBounds | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = pixels[offset + 3];
      const isVisibleInk =
        alpha > 20 &&
        (pixels[offset] < 245 || pixels[offset + 1] < 245 || pixels[offset + 2] < 245);
      if (!isVisibleInk) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  return right < left ? null : { left, top, right, bottom };
}

export function clearSignatureBackground(pixels: Uint8ClampedArray) {
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset] >= 245 && pixels[offset + 1] >= 245 && pixels[offset + 2] >= 245) {
      pixels[offset + 3] = 0;
    }
  }
  return pixels;
}
