import "server-only";
import { loadSharp } from "./sharp";

/**
 * What a picture looks like, as sixteen hex characters — so the same picture
 * is recognised whatever has been done to its file.
 *
 * WHY NOT THE BYTES. One article's cover is the reference re-encoded to WebP,
 * perhaps upscaled; the next article finds the same picture at another CDN
 * size, or through another page of the same site. Every one of those is a
 * different file and the same picture, and a hash of the bytes calls them all
 * different. Two articles on the Hub opened with the same Adobe Firefly
 * banner that way (5 Oct 2026).
 *
 * A difference hash: the picture shrunk to 9×8 in grey, and one bit per pair
 * of neighbours saying which is brighter. Re-encoding, resizing and upscaling
 * move a bit or two; a different picture moves about half of them.
 */
export async function pictureHash(data: Buffer): Promise<string | null> {
  try {
    const sharp = await loadSharp();
    const { data: pixels, info } = await sharp(data)
      .rotate()
      .greyscale()
      .resize(9, 8, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => pixels[(y * 9 + x) * info.channels];
    let hex = "";
    for (let y = 0; y < 8; y += 1) {
      for (let half = 0; half < 2; half += 1) {
        let nibble = 0;
        for (let bit = 0; bit < 4; bit += 1) {
          const x = half * 4 + bit;
          nibble = (nibble << 1) | (at(x, y) < at(x + 1, y) ? 1 : 0);
        }
        hex += nibble.toString(16);
      }
    }
    return hex;
  } catch {
    // Without sharp there is no telling; the picture is not held against anything.
    return null;
  }
}

/**
 * Bits that may differ between two files of one picture, out of 64. Measured
 * on the Adobe Firefly banner: its copies — cropped from a screenshot,
 * upscaled to WebP, shrunk to a poor JPEG — came within 9 of one another, and
 * every other picture tried was 21 or more away from all of them.
 */
const SAME_PICTURE_DISTANCE = 12;

export function isSamePicture(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    let diff = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (diff) {
      distance += diff & 1;
      diff >>= 1;
    }
  }
  return distance <= SAME_PICTURE_DISTANCE;
}

/** The items whose picture is none of `avoid`, in their order. */
export async function withoutPictures<T>(
  items: T[],
  bytesOf: (item: T) => Buffer,
  avoid: string[],
): Promise<T[]> {
  if (avoid.length === 0 || items.length === 0) return items;
  const hashes = await Promise.all(items.map((item) => pictureHash(bytesOf(item))));
  return items.filter((_, index) => {
    const hash = hashes[index];
    return !hash || !avoid.some((used) => isSamePicture(hash, used));
  });
}
