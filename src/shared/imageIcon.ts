// Turns a user-picked image file into a small square icon data URL for a custom
// creature. Uploaded images are downscaled and re-encoded so a creature's icon
// costs a few KB instead of megabytes - that is what lets many custom creatures
// (and their icons) live in localStorage without hitting the per-origin quota.

export const CUSTOM_ICON_MAX_PX = 128;
// Reject obviously-too-big source files before decoding them.
export const CUSTOM_ICON_SOURCE_MAX_BYTES = 12 * 1024 * 1024;
// Safety ceiling on the stored data URL. A 128px icon is well under this; the
// re-encode loop steps quality/size down until it fits.
export const CUSTOM_ICON_RESULT_MAX_BYTES = 96 * 1024;

export type CustomIconResult = { dataUrl: string; bytes: number };

export function isCustomIconDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/");
}

// The icon is stored verbatim as a string, so its character length (base64 is
// ASCII) is the storage cost we care about.
export function dataUrlByteLength(dataUrl: string): number {
  return dataUrl.length;
}

type DrawableImage = {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number) => void;
  release: () => void;
};

async function decodeImage(file: File): Promise<DrawableImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(bitmap, dx, dy, dw, dh),
        release: () => bitmap.close(),
      };
    } catch {
      // Fall through to the <img> path (e.g. browsers that can't bitmap a GIF).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Could not read that image file."));
      element.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(img, dx, dy, dw, dh),
      release: () => {},
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encodeCanvas(canvas: HTMLCanvasElement): CustomIconResult {
  // Prefer WebP (smaller, keeps transparency); browsers without WebP encoding
  // silently hand back a PNG, which is fine. Step quality/size down until the
  // result fits the storage ceiling so one big upload can't blow the budget.
  const attempts: Array<{ type: string; quality?: number }> = [
    { type: "image/webp", quality: 0.85 },
    { type: "image/webp", quality: 0.6 },
    { type: "image/png" },
  ];
  let best: CustomIconResult | null = null;
  for (const attempt of attempts) {
    const dataUrl = canvas.toDataURL(attempt.type, attempt.quality);
    const bytes = dataUrlByteLength(dataUrl);
    if (!best || bytes < best.bytes) best = { dataUrl, bytes };
    if (bytes <= CUSTOM_ICON_RESULT_MAX_BYTES) return { dataUrl, bytes };
  }
  return best ?? { dataUrl: canvas.toDataURL("image/png"), bytes: 0 };
}

export async function fileToCustomIconDataUrl(file: File): Promise<CustomIconResult> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file (PNG, JPG, WEBP, or GIF).");
  }
  if (file.size > CUSTOM_ICON_SOURCE_MAX_BYTES) {
    throw new Error("That image is too large. Pick a file under 12 MB.");
  }
  const source = await decodeImage(file);
  try {
    if (source.width <= 0 || source.height <= 0) {
      throw new Error("That image could not be read.");
    }
    // Fit the image inside a square box, centred on transparency, so the icon
    // never distorts in the square slots the rest of the app renders it in.
    const scale = Math.min(CUSTOM_ICON_MAX_PX / source.width, CUSTOM_ICON_MAX_PX / source.height);
    const drawW = Math.max(1, Math.round(source.width * scale));
    const drawH = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = CUSTOM_ICON_MAX_PX;
    canvas.height = CUSTOM_ICON_MAX_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser blocked image processing.");
    ctx.imageSmoothingQuality = "high";
    source.draw(ctx, (CUSTOM_ICON_MAX_PX - drawW) / 2, (CUSTOM_ICON_MAX_PX - drawH) / 2, drawW, drawH);
    const result = encodeCanvas(canvas);
    if (result.bytes > CUSTOM_ICON_RESULT_MAX_BYTES) {
      throw new Error("Could not compress that image small enough. Try a simpler picture.");
    }
    return result;
  } finally {
    source.release();
  }
}
