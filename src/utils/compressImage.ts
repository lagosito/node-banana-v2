/**
 * Client-side image compression utility.
 *
 * Reduces base64 data-URL payload sizes before sending to Vercel serverless
 * functions (which have a ~4.5 MB request-body limit).
 *
 * Strategy:
 *  1. If the input is already an HTTP URL → pass through (no compression needed).
 *  2. If the input is a small data URL (< MAX_SIZE_BYTES) → pass through.
 *  3. Otherwise → decode → resize (max MAX_DIMENSION on longest side) → JPEG quality
 *     → return compressed data URL.
 *
 * This runs in the browser using the Canvas API — zero server cost.
 */

const MAX_DIMENSION = 2048; // px on longest side
const JPEG_QUALITY = 0.85;
const MAX_SIZE_BYTES = 500_000; // 500 KB — skip compression if already small

/**
 * Check if a string is an HTTP/HTTPS URL (not a data URL).
 */
function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

/**
 * Compress a single image string (data URL or HTTP URL).
 *
 * @returns The original string if it's an HTTP URL or already small,
 *          otherwise a compressed JPEG data URL.
 */
export async function compressImage(input: string): Promise<string> {
  // Pass through HTTP URLs — they're already hosted externally
  if (isHttpUrl(input)) {
    return input;
  }

  // Pass through non-data-URL strings (shouldn't happen, but be safe)
  if (!input.startsWith("data:")) {
    return input;
  }

  // Quick size check: if the raw data URL string is already small, skip
  if (input.length < MAX_SIZE_BYTES) {
    return input;
  }

  return compressDataUrl(input);
}

/**
 * Compress an array of images in parallel.
 */
export async function compressImages(images: string[]): Promise<string[]> {
  return Promise.all(images.map(compressImage));
}

/**
 * Compress values in a dynamicInputs record.
 * Only compresses values that look like base64 data URLs.
 */
export async function compressDynamicInputs(
  dynamicInputs: Record<string, string | string[]> | undefined
): Promise<Record<string, string | string[]> | undefined> {
  if (!dynamicInputs) return undefined;

  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(dynamicInputs)) {
    if (Array.isArray(value)) {
      result[key] = await Promise.all(value.map(compressImage));
    } else if (typeof value === "string") {
      result[key] = await compressImage(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Decode a base64 data URL into an HTMLImageElement.
 */
function imageDataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image from data URL"));
    img.src = dataUrl;
  });
}

/**
 * Compress a data URL using Canvas resize + JPEG encoding.
 */
async function compressDataUrl(dataUrl: string): Promise<string> {
  try {
    const img = await imageDataUrlToImage(dataUrl);

    // Calculate new dimensions (preserve aspect ratio, cap at MAX_DIMENSION)
    let { width, height } = img;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    // Draw to canvas and export as JPEG
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas 2d context");

    ctx.drawImage(img, 0, 0, width, height);

    const compressed: string = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("Canvas toBlob returned null"));
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("FileReader failed"));
          reader.readAsDataURL(blob);
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    });

    const origKB = Math.round(dataUrl.length / 1024);
    const compKB = Math.round(compressed.length / 1024);
    console.log(
      `[compressImage] ${origKB}KB → ${compKB}KB (${Math.round((1 - compressed.length / dataUrl.length) * 100)}% reduction)`
    );

    return compressed;
  } catch (err) {
    console.warn("[compressImage] Compression failed, returning original:", err);
    return dataUrl;
  }
}
