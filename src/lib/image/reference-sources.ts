import "server-only";
import { createHash } from "node:crypto";
import type { ReferenceOrigin } from "@/db/schema";
import { publicFetch, readCapped } from "@/lib/net/public-fetch";
import { imageSize } from "./dimensions";

/**
 * Where reference photographs come from, and how one is fetched.
 *
 * A cover made from words alone reads as synthetic: the model was given a
 * description and never a surface. The correction is a real photograph from the
 * world the article describes, which the finished image is then made to
 * resemble in kind.
 *
 * Unsplash is where those come from, because it is a library of photographs of
 * people doing things and its licence permits commercial use and modification.
 * Openverse is the fallback where no Unsplash key is set: no key required, but
 * it leans towards archive and museum material.
 *
 * This file only talks to the libraries. Deciding WHAT to search for, and which
 * results belong to the article, is `reference-search.ts` — searches here return
 * metadata and small previews, and nothing full-size is downloaded until a
 * result has been judged worth keeping.
 */

export type ReferenceCandidate = {
  data: Buffer;
  mimeType: string;
  ext: "png" | "jpg";
  width: number;
  height: number;
  originalName: string;
  origin: ReferenceOrigin;
  sourceUrl: string;
  sourceName: string;
  license: string | null;
  attribution: string | null;
};

/**
 * A search result before anything is downloaded: enough to judge it by and to
 * credit it, and the address of the file to fetch if it is kept.
 */
export type ReferenceHit = {
  /** Stable across searches, so a photograph two queries both return is judged once. */
  key: string;
  /** A small rendition, shown to the judge. */
  previewUrl: string;
  /** The rendition that is downloaded and attached if this result is kept. */
  imageUrl: string;
  /** The library's own description. Often wrong; context, not evidence. */
  caption: string;
  sourceUrl: string;
  sourceName: string;
  license: string | null;
  attribution: string | null;
};

/** 4 MB — larger than the 2 MB upload cap, because nobody chose these by hand. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** A preview is a few tens of kilobytes; anything near this is not a preview. */
const MAX_PREVIEW_BYTES = 1.5 * 1024 * 1024;

/**
 * Below this on the short edge it is furniture, not a photograph: a logo, an
 * avatar, a social icon, a tracking pixel. Every one of those makes the
 * generation worse.
 */
const MIN_EDGE_PX = 320;

/*
 * Timeouts sized against the 60s `maxDuration` every action on the pipeline
 * page gets: a plan, a few searches, a pool of previews, a judgement, and a
 * download per photograph kept.
 */
const IMAGE_TIMEOUT_MS = 10_000;
const PREVIEW_TIMEOUT_MS = 6_000;
const SEARCH_TIMEOUT_MS = 8_000;

export const USER_AGENT =
  "Mozilla/5.0 (compatible; DesignallyContentStudio/1.0; +https://designally.co)";

const ALLOWED_TYPES: Record<string, "png" | "jpg"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "png",
};

/** The formats the Messages API reads. A preview in any other is left out. */
const PREVIEW_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Reject anything that is not a public https address.
 *
 * These URLs come from a third-party search API — not a trusted source of
 * hostnames — and the fetch runs on the server with whatever network position
 * the server has. Literal private addresses and loopback names are refused
 * outright. This does not resolve DNS, so it is not a complete SSRF defence; it
 * is the cheap half that catches the obvious cases, and it is paired with a hard
 * cap on what is read back.
 */
function isPublicHttpsUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
  if (host === "metadata.google.internal" || host.endsWith(".internal")) return null;

  // IPv4 literals in private, loopback, link-local or unspecified ranges.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return null;
    if (a === 169 && b === 254) return null;
    if (a === 172 && b >= 16 && b <= 31) return null;
    if (a === 192 && b === 168) return null;
    if (a === 100 && b >= 64 && b <= 127) return null;
  }
  // IPv6 literals: loopback, unique-local and link-local.
  if (host.startsWith("[")) {
    const inner = host.slice(1, -1);
    if (inner === "::1" || inner === "::") return null;
    if (/^f[cd]/.test(inner) || /^fe80/.test(inner)) return null;
  }
  return url;
}

/**
 * Download one image, refusing anything that is not a usable photograph.
 *
 * Exported because a cover can now come from a page the article cites
 * (`article-sources.ts`), and that path must refuse the same things.
 *
 * THROUGH `publicFetch`, which resolves the name and re-checks every redirect.
 * This used `redirect: "follow"`, which took a public URL's 302 to wherever it
 * pointed, private addresses included — the gap the string check above says it
 * does not cover.
 */
export async function downloadImage(rawUrl: string): Promise<{
  data: Buffer;
  mimeType: string;
  ext: "png" | "jpg";
  width: number;
  height: number;
} | null> {
  if (!isPublicHttpsUrl(rawUrl)) return null;

  const response = await publicFetch(rawUrl, {
    accept: "image/*",
    userAgent: USER_AGENT,
    timeoutMs: IMAGE_TIMEOUT_MS,
  });
  if (!response?.ok) return null;

  // The declared type first — it is free, and it rejects an HTML error page
  // served with a 200 before any bytes are read.
  const declared = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = ALLOWED_TYPES[declared];
  if (!ext) return null;

  // Read against the cap as a stream: content-length is a claim, not a guarantee.
  const data = await readCapped(response, MAX_IMAGE_BYTES);
  if (!data || data.length === 0) return null;

  // The bytes must actually be an image this app can read, whatever the header
  // said. This is also what filters out an SVG or a GIF wearing another type.
  const size = imageSize(data);
  if (!size) return null;
  if (Math.min(size.width, size.height) < MIN_EDGE_PX) return null;

  return { data, mimeType: declared === "image/jpg" ? "image/jpeg" : declared, ext, ...size };
}

/**
 * A small rendition, to show the judge.
 *
 * Fetched here and sent as bytes rather than handed to the API as an address:
 * one URL the API cannot fetch fails the whole call, while a preview that
 * cannot be fetched here is simply left out of the pool.
 */
export async function downloadPreview(rawUrl: string): Promise<{ base64: string; mediaType: string } | null> {
  if (!isPublicHttpsUrl(rawUrl)) return null;
  // Named formats, not `image/*`: an image CDN that negotiates will answer
  // `image/*` with AVIF, which the Messages API does not read.
  const response = await publicFetch(rawUrl, {
    accept: "image/jpeg,image/png,image/webp;q=0.9",
    userAgent: USER_AGENT,
    timeoutMs: PREVIEW_TIMEOUT_MS,
  });
  if (!response?.ok) return null;
  const mediaType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!PREVIEW_TYPES.has(mediaType)) return null;
  const data = await readCapped(response, MAX_PREVIEW_BYTES);
  if (!data || data.length === 0) return null;
  return { base64: data.toString("base64"), mediaType };
}

/** Fetch a kept result full-size and make it something that can be attached. */
export async function downloadHit(hit: ReferenceHit): Promise<ReferenceCandidate | null> {
  const image = await downloadImage(hit.imageUrl);
  if (!image) return null;
  return {
    ...image,
    originalName: `${(hit.caption || "reference").slice(0, 100)}${image.ext === "png" ? ".png" : ".jpg"}`,
    origin: "open_license",
    sourceUrl: hit.sourceUrl,
    sourceName: hit.sourceName,
    license: hit.license,
    attribution: hit.attribution,
  };
}

/**
 * A hash of the actual bytes, not a size-and-dimensions fingerprint. The cheap
 * version collapsed two different photographs that happened to share a byte
 * length and a shape — which is exactly what a set of images from one CDN, all
 * resized by the same pipeline, tends to look like.
 */
export function fingerprint(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hasUnsplashKey(): boolean {
  return Boolean(process.env.UNSPLASH_ACCESS_KEY);
}

type UnsplashResult = {
  id?: string;
  urls?: { small?: string; thumb?: string; regular?: string; full?: string };
  alt_description?: string | null;
  description?: string | null;
  links?: { html?: string };
  user?: { name?: string; username?: string };
};

/**
 * Photographs from Unsplash, as results to judge.
 *
 * The Unsplash License permits commercial use and modification without
 * permission, which is what makes it safe to generate from. Attribution is not
 * legally required by that licence but Unsplash's API terms require crediting
 * the photographer — so it is recorded on the row like any other licence, and
 * travels with the image.
 *
 * Needs UNSPLASH_ACCESS_KEY. Without one this returns nothing.
 */
export async function searchUnsplash(query: string, perPage: number): Promise<ReferenceHit[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  const terms = query.trim().slice(0, 120);
  if (!key || !terms || perPage <= 0) return [];

  const endpoint = new URL("https://api.unsplash.com/search/photos");
  endpoint.searchParams.set("query", terms);
  endpoint.searchParams.set("per_page", String(Math.min(perPage, 30)));
  // Landscape: these become article covers, and a portrait reference pushes the
  // generated frame the wrong way.
  endpoint.searchParams.set("orientation", "landscape");
  endpoint.searchParams.set("content_filter", "high");

  let results: UnsplashResult[];
  try {
    const response = await fetch(endpoint, {
      headers: {
        authorization: `Client-ID ${key}`,
        "accept-version": "v1",
        "user-agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { results?: UnsplashResult[] };
    results = Array.isArray(payload?.results) ? payload.results : [];
  } catch {
    return [];
  }

  return results.flatMap((result): ReferenceHit[] => {
    // `regular` is ~1080px wide — plenty for a reference, and a fraction of
    // `full`, which would spend the byte cap for nothing. `small` is ~400px,
    // which is what the judge needs to see what is in the frame.
    const imageUrl = result.urls?.regular ?? result.urls?.full;
    const previewUrl = result.urls?.small ?? result.urls?.thumb ?? imageUrl;
    if (!imageUrl || !previewUrl) return [];
    const photographer = result.user?.name?.slice(0, 180) ?? "";
    return [
      {
        key: `unsplash:${result.id ?? imageUrl}`,
        previewUrl,
        imageUrl,
        caption: (result.alt_description ?? result.description ?? terms).slice(0, 200),
        sourceUrl: result.links?.html ?? imageUrl,
        sourceName: photographer || "Unsplash",
        license: "Unsplash License",
        attribution: `Photo by ${photographer || "an Unsplash photographer"} on Unsplash`,
      },
    ];
  });
}

type OpenverseResult = {
  id?: string;
  title?: string;
  url?: string;
  thumbnail?: string;
  creator?: string;
  license?: string;
  license_version?: string;
  foreign_landing_url?: string;
  attribution?: string;
};

/**
 * Openly licensed images from Openverse, as results to judge.
 *
 * It needs no API key, and it states a licence per result. The filter asks for
 * work cleared for commercial use and for modification, since a reference image
 * feeds a derivative work. Anonymous requests are rate limited; a refusal
 * returns nothing rather than failing the search.
 */
export async function searchOpenverse(query: string, perPage: number): Promise<ReferenceHit[]> {
  const terms = query.trim().slice(0, 120);
  if (!terms || perPage <= 0) return [];

  const endpoint = new URL("https://api.openverse.org/v1/images/");
  endpoint.searchParams.set("q", terms);
  endpoint.searchParams.set("license_type", "commercial,modification");
  endpoint.searchParams.set("page_size", String(Math.min(perPage, 20)));

  let results: OpenverseResult[];
  try {
    const response = await fetch(endpoint, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { results?: OpenverseResult[] };
    results = Array.isArray(payload?.results) ? payload.results : [];
  } catch {
    return [];
  }

  return results.flatMap((result): ReferenceHit[] => {
    if (!result.url) return [];
    const license = result.license
      ? `${result.license.toUpperCase()}${result.license_version ? ` ${result.license_version}` : ""}`
      : null;
    const creator = result.creator?.slice(0, 180) ?? "";
    return [
      {
        key: `openverse:${result.id ?? result.url}`,
        previewUrl: result.thumbnail ?? result.url,
        imageUrl: result.url,
        caption: (result.title ?? "").slice(0, 200),
        sourceUrl: result.foreign_landing_url ?? result.url,
        sourceName: creator || "Openverse",
        license,
        attribution:
          result.attribution?.slice(0, 500) ??
          (license ? `${result.title ?? "Untitled"} by ${creator || "unknown"} (${license})` : null),
      },
    ];
  });
}
