import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { imageReferences, images, projects, type CoverCredit } from "@/db/schema";
import { loadStoredImage, saveGeneratedImage, saveImage } from "@/lib/image/storage";
import { imageSize } from "@/lib/image/dimensions";
import { downloadImage, USER_AGENT } from "@/lib/image/reference-sources";
import type { GeneratedImageView } from "./views";

/**
 * A real photograph as the article's cover, instead of a generated one.
 *
 * WHY. The design publications worth imitating open an article with the work
 * itself — the identity on its packaging, the building in its street — lent by
 * the studio that made it. A generated image of "a rebrand" is at best a
 * plausible stand-in for a picture that already exists. So a reference the
 * search found (or the editor uploaded) can become the cover as it is.
 *
 * WHAT MAKES IT ALLOWED. A credit is not a licence. An open-licence photograph
 * (Unsplash, or Openverse filtered to commercial use and modification) carries
 * its permission with it. Anything else — a studio's press image, an upload —
 * needs a person to say the press-kit terms allow it or that permission was
 * given, and `rightsConfirmed` is that person saying so. Nothing is inserted
 * without it, so every sourced cover that exists has been cleared by someone.
 *
 * WHAT IT BECOMES. An `images` row like any generated variation — provider
 * `source` — so choosing, previewing, deleting and publishing it are the paths
 * that already exist. The bytes are COPIED rather than shared: a reference's
 * file is swept once the article publishes, and the cover must outlive that.
 * The credit sits in `inputs.coverCredits` and is added to the article's
 * References when it publishes.
 */

export const SOURCE_PROVIDER = "source";

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The line a reader sees under References, drafted from what is known. */
export function draftCreditLabel(reference: {
  origin: string;
  sourceName: string | null;
  sourceUrl: string | null;
  license: string | null;
  attribution: string | null;
}): string {
  const name = reference.sourceName?.trim() || hostOf(reference.sourceUrl) || "";
  if (reference.origin === "open_license") {
    // Unsplash's own line is short and is the form its terms ask for. An
    // Openverse attribution is a paragraph about how to view the licence.
    if (reference.attribution && reference.attribution.length <= 120) {
      return `Cover image: ${reference.attribution}`;
    }
    return `Cover image: ${name || "Photographer"}${reference.license ? `, ${reference.license}` : ""}`;
  }
  return name ? `Cover image courtesy of ${name}` : "Cover image courtesy of ";
}

/**
 * Unsplash asks that a photograph's download endpoint be called when it is
 * actually used — that is how its photographers see their work being used.
 *
 * The same call answers with the address of the ORIGINAL file, which is the
 * one worth having: the reference was fetched at Unsplash's ~1080px web size,
 * enough to guide a generation and small for a cover. So this returns that
 * address at the delivery width, or null.
 *
 * Best effort: a failed ping must not cost the editor their cover.
 */
async function pingUnsplashDownload(sourceUrl: string | null): Promise<string | null> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key || !sourceUrl) return null;
  let id: string | undefined;
  try {
    const url = new URL(sourceUrl);
    if (url.hostname !== "unsplash.com") return null;
    // `/photos/{slug}-{id}` or `/photos/{id}`; an id is eleven characters and
    // may itself contain a hyphen, so it is read from the end.
    const segment = url.pathname.split("/").filter(Boolean)[1];
    id = segment ? segment.slice(-11) : undefined;
  } catch {
    return null;
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  try {
    const response = await fetch(`https://api.unsplash.com/photos/${id}/download`, {
      headers: { authorization: `Client-ID ${key}`, "accept-version": "v1", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(4_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { url?: unknown };
    if (typeof payload?.url !== "string") return null;
    // Unsplash serves through imgix, which sizes on request: the delivery
    // width as a JPEG, rather than a 6000px original read only to be shrunk.
    const original = new URL(payload.url);
    if (original.hostname !== "images.unsplash.com") return null;
    original.searchParams.set("w", String(COVER_FETCH_WIDTH));
    original.searchParams.set("fm", "jpg");
    original.searchParams.set("q", "85");
    return original.toString();
  } catch {
    // Recorded nowhere: the cover stands either way.
    return null;
  }
}

/** Matches the width a generated cover is delivered at (see `saveGeneratedImage`). */
const COVER_FETCH_WIDTH = 1600;

function ratioOf(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(width, height) || 1;
  return `${width / d}:${height / d}`;
}

export async function coverFromReferenceCore(
  projectId: string,
  referenceId: string,
  confirmation: { rightsConfirmed: boolean; confirmedBy: string },
): Promise<{ image: GeneratedImageView; credit: CoverCredit }> {
  const db = await getDb();
  const [reference] = await db
    .select()
    .from(imageReferences)
    .where(eq(imageReferences.id, referenceId))
    .limit(1);
  if (!reference || reference.projectId !== projectId) throw new Error("That reference is no longer on this article.");
  if (reference.sweptAt) throw new Error("That photograph's file was cleared after publishing. Find it again to use it.");

  const cleared = reference.origin === "open_license" && !!reference.license;
  if (!cleared && !confirmation.rightsConfirmed) {
    throw new Error("Confirm you have permission to use this image before making it the cover.");
  }

  /* The full-size photograph where the library offers one — Unsplash, whose
     reference copy is its web size — and the reference's own bytes otherwise,
     or if that fetch fails. Pinging is part of the same call, and Unsplash's
     terms ask for it whenever a photograph is used. */
  const original =
    reference.origin === "open_license" ? await pingUnsplashDownload(reference.sourceUrl) : null;
  const fullSize = original ? await downloadImage(original) : null;
  const stored = fullSize
    ? { data: fullSize.data, mimeType: fullSize.mimeType }
    : await loadStoredImage(reference.storagePath);
  if (!stored) throw new Error("That photograph could not be read. Find it again, or upload it.");

  /* Stored the way a generated cover is — WebP, at most the delivery width —
     so the Hub receives the same kind of file either way. Where sharp cannot
     load, the reference's own bytes are a valid image and are kept as they are. */
  let saved: { storagePath: string; width: number; height: number };
  try {
    const result = await saveGeneratedImage({
      data: stored.data,
      mimeType: stored.mimeType,
      ext: stored.mimeType.includes("png") ? "png" : "jpg",
    });
    saved = { storagePath: result.storagePath, width: result.width, height: result.height };
  } catch {
    const ext = stored.mimeType.includes("png") ? "png" : stored.mimeType.includes("webp") ? "webp" : "jpg";
    const { storagePath } = await saveImage({ data: stored.data, mimeType: stored.mimeType, ext });
    const size = imageSize(stored.data);
    saved = { storagePath, width: size?.width ?? reference.width, height: size?.height ?? reference.height };
  }

  const [row] = await db
    .insert(images)
    .values({
      projectId,
      provider: SOURCE_PROVIDER,
      model: reference.origin,
      // The column is the record of where an image came from; for a photograph
      // that is its page, not a prompt.
      prompt: `Photograph from ${reference.sourceUrl ?? reference.originalName}`,
      aspectRatio: ratioOf(saved.width, saved.height),
      width: saved.width,
      height: saved.height,
      referenceIds: [reference.id],
      storagePath: saved.storagePath,
    })
    .returning();

  const credit: CoverCredit = {
    label: draftCreditLabel(reference),
    url: reference.sourceUrl ?? "",
    referenceId: reference.id,
    origin: reference.origin,
    license: reference.license,
    ...(cleared
      ? {}
      : { rightsConfirmedAt: new Date().toISOString(), rightsConfirmedBy: confirmation.confirmedBy }),
  };

  /* A JSON merge, not a rewrite of `inputs`: a search or a generation may be
     writing to the same row while the editor chooses. */
  await db
    .update(projects)
    .set({
      inputs: sql`jsonb_set(
        coalesce(${projects.inputs}, '{}'::jsonb) || ${JSON.stringify({ coverImageId: row.id })}::jsonb,
        '{coverCredits}',
        coalesce(${projects.inputs} -> 'coverCredits', '{}'::jsonb) || ${JSON.stringify({ [row.id]: credit })}::jsonb
      )`,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  return {
    image: {
      id: row.id,
      url: `/api/images/${row.id}`,
      provider: row.provider,
      model: row.model,
      aspectRatio: row.aspectRatio,
      variationNo: row.variationNo,
    },
    credit,
  };
}

/** The editor's wording of a sourced cover's credit. */
export async function updateCoverCreditCore(
  projectId: string,
  imageId: string,
  edit: { label: string; url: string },
): Promise<CoverCredit> {
  const label = typeof edit.label === "string" ? edit.label.trim().slice(0, 240) : "";
  const url = typeof edit.url === "string" ? edit.url.trim().slice(0, 2000) : "";
  if (!label) throw new Error("The credit needs some words.");
  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("The credit's link is not a web address.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("The credit's link is not a web address.");
    }
  }

  const db = await getDb();
  const [project] = await db
    .select({ inputs: projects.inputs })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const current = project?.inputs?.coverCredits?.[imageId];
  if (!current) throw new Error("That cover has no credit to edit.");

  const next: CoverCredit = { ...current, label, url };
  await db
    .update(projects)
    .set({
      inputs: sql`jsonb_set(
        coalesce(${projects.inputs}, '{}'::jsonb),
        '{coverCredits}',
        coalesce(${projects.inputs} -> 'coverCredits', '{}'::jsonb) || ${JSON.stringify({ [imageId]: next })}::jsonb
      )`,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));
  return next;
}
