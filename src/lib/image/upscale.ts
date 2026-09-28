import "server-only";
import { getApiKey } from "@/lib/secrets";
import { loadSharp } from "./sharp";
import { imageSize } from "./dimensions";
import { COVER_MIN_WIDTH } from "./reference-policy";

/**
 * A real photograph that is too narrow for the cover, made wide enough.
 *
 * WHY. Most cited pages lead with a ~1200px share card. Generating a new
 * picture from it gives a plausible stand-in that reads as stock; the editor
 * would rather run the photograph itself (28 Sep 2026). So the photograph is
 * enlarged to the delivery width instead of being refused.
 *
 * HOW. A restoration upscaler on Fal (SeedVR2) first: it is trained to add the
 * detail a larger copy of the SAME photograph would have, not to reinterpret
 * it, which is the difference between "sharper" and "AI-looking". A creative
 * upscaler would redraw texture and faces, and is deliberately not used.
 *
 * Where there is no Fal key, or the call fails or runs out of time, sharp
 * enlarges it with Lanczos and a light sharpen. Softer than the model, but the
 * editor still gets their photograph rather than an error.
 */

const UPSCALE_ENDPOINT = "fal-ai/seedvr/upscale/image";

/*
 * Inside the 60s `maxDuration` of the pipeline page, after the Unsplash ping
 * and download that may come before it, with room left to store the result.
 */
const UPSCALE_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 12_000;

export type Upscaled = {
  data: Buffer;
  mimeType: string;
  /** Which path produced the bytes, recorded on the image row. */
  method: "fal" | "resize";
};

/** The whole-number factor that takes `width` past the cover width, 2 to 4. */
function factorFor(width: number): number {
  return Math.min(4, Math.max(2, Math.ceil(COVER_MIN_WIDTH / Math.max(1, width))));
}

async function upscaleWithFal(data: Buffer, mimeType: string, width: number): Promise<Upscaled | null> {
  const key = await getApiKey("fal");
  if (!key) return null;
  const response = await fetch(`https://fal.run/${UPSCALE_ENDPOINT}`, {
    method: "POST",
    headers: { authorization: `Key ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      image_url: `data:${mimeType};base64,${data.toString("base64")}`,
      upscale_factor: factorFor(width),
    }),
    signal: AbortSignal.timeout(UPSCALE_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    image?: { url?: string; content_type?: string };
    images?: { url?: string; content_type?: string }[];
  };
  const image = payload.image ?? payload.images?.[0];
  if (!image?.url) return null;

  if (image.url.startsWith("data:image/")) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/.exec(image.url);
    if (!match) return null;
    return { data: Buffer.from(match[2], "base64"), mimeType: match[1], method: "fal" };
  }
  const url = new URL(image.url);
  if (url.protocol !== "https:") return null;
  const download = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!download.ok) return null;
  const bytes = Buffer.from(await download.arrayBuffer());
  // The model must actually have returned something wider, or it is no gain.
  const size = imageSize(bytes);
  if (size && size.width <= width) return null;
  return {
    data: bytes,
    mimeType: download.headers.get("content-type") ?? image.content_type ?? "image/png",
    method: "fal",
  };
}

async function upscaleWithSharp(data: Buffer): Promise<Upscaled> {
  const sharp = await loadSharp();
  const out = await sharp(data)
    .rotate()
    .resize({ width: COVER_MIN_WIDTH, kernel: "lanczos3" })
    .sharpen({ sigma: 0.6 })
    .png()
    .toBuffer();
  return { data: out, mimeType: "image/png", method: "resize" };
}

/** Enlarge a photograph to at least the cover width. Never throws for a Fal failure. */
export async function upscaleForCover(data: Buffer, mimeType: string, width: number): Promise<Upscaled> {
  try {
    const result = await upscaleWithFal(data, mimeType, width);
    if (result) return result;
  } catch {
    // Timed out or unreachable: the resize below still gives a usable cover.
  }
  return upscaleWithSharp(data);
}
