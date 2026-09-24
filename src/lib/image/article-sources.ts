import "server-only";
import { splitSourcesSection } from "@/lib/outline";
import { publicFetch, readCapped } from "@/lib/net/public-fetch";
import { downloadImage, fingerprint, USER_AGENT, type ReferenceCandidate } from "./reference-sources";

/**
 * The lead image of each page the article cites — the studio's own picture of
 * its own work.
 *
 * WHY THIS IS THE FIRST PLACE TO LOOK. An article about Pentagram's new
 * identity cites Pentagram's case study, and the case study opens with the
 * identity photographed properly. That picture is the one a reader wants, and
 * it is what the publications worth imitating run: the work itself, "courtesy
 * of" the studio. No photo library has it and no model should fake it.
 *
 * NOTHING HERE IS CLEARED. A page's lead image belongs to whoever published
 * it, and a credit is not a licence. These come back with `license: null`,
 * which the image stage shows as "needs permission", and none of them can
 * become a cover until a person confirms the press-kit terms allow it or that
 * permission was given (see `sourced-cover.ts`). They may still be used as a
 * REFERENCE for generation straight away, as any photograph could.
 *
 * `og:image` because it is the one image a publisher has chosen to represent the
 * page — the picture they put forward when the page is shared — rather than a
 * guess among everything on it.
 */

/** Pages visited per search. Each is one fetch of HTML and one of an image. */
const MAX_PAGES = 5;
const PAGE_TIMEOUT_MS = 6_000;
/** A page's head is all that is read for; 1.5 MB is far past any real one. */
const MAX_PAGE_BYTES = 1.5 * 1024 * 1024;

/** The links an article cites: its Sources list first, then links in the prose. */
export function citedPages(markdown: string): { label: string; url: string }[] {
  const { references } = splitSourcesSection(markdown);
  const pages = [...references];
  const seen = new Set(pages.map((page) => page.url));
  for (const match of markdown.matchAll(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g)) {
    const url = match[2];
    if (seen.has(url)) continue;
    seen.add(url);
    pages.push({ label: match[1], url });
  }
  return pages.filter((page) => page.url.startsWith("https://"));
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // Last, so "&amp;lt;" stays the text "&lt;" rather than becoming "<".
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * A site's front page, which leads with the site's own brand card — a logo on
 * a flat colour — and never with anyone's work. The article cites it as a
 * source; it has no picture to offer.
 */
function isFrontPage(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") === "";
  } catch {
    return true;
  }
}

/**
 * Bytes per pixel below which an image is a flat graphic — a logo card, a
 * share template — rather than a photograph of anything. Measured: the brand
 * cards of three design publications' front pages came in at 0.02; a
 * photograph at the same 1200px is five to ten times that.
 */
const MIN_BYTES_PER_PIXEL = 0.03;

/** Every `<meta>` in the page, as `property|name` → `content`. First one wins. */
function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map<string, string>();
    for (const attribute of tag[0].matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      attributes.set(attribute[1].toLowerCase(), attribute[3] ?? attribute[4] ?? "");
    }
    const key = (attributes.get("property") ?? attributes.get("name"))?.toLowerCase();
    const content = attributes.get("content");
    if (key && content && !tags.has(key)) tags.set(key, decodeEntities(content));
  }
  return tags;
}

/** The page's lead image, its publisher's name and its title — or null. */
async function leadImageOf(page: { label: string; url: string }): Promise<{
  imageUrl: string;
  sourceName: string;
  title: string;
} | null> {
  const response = await publicFetch(page.url, {
    accept: "text/html,application/xhtml+xml",
    userAgent: USER_AGENT,
    timeoutMs: PAGE_TIMEOUT_MS,
  });
  if (!response?.ok) return null;
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!type.includes("html")) return null;

  const body = await readCapped(response, MAX_PAGE_BYTES);
  if (!body) return null;
  // Only the head carries these; cutting there also keeps the regexes cheap.
  const html = body.toString("utf8");
  const head = html.slice(0, Math.max(html.search(/<\/head>/i), 0) || html.length);

  const meta = metaTags(head);
  const raw = meta.get("og:image:secure_url") ?? meta.get("og:image") ?? meta.get("twitter:image");
  if (!raw) return null;

  let imageUrl: string;
  try {
    imageUrl = new URL(raw, response.url || page.url).toString();
  } catch {
    return null;
  }

  const host = new URL(page.url).hostname.replace(/^www\./, "");
  return {
    imageUrl,
    sourceName: (meta.get("og:site_name") ?? host).slice(0, 180),
    title: (meta.get("og:title") ?? page.label).slice(0, 100),
  };
}

/**
 * Lead images from the pages this article cites, at most `limit`, skipping any
 * page already recorded as a reference's source.
 */
export async function findArticleSourceImages(
  markdown: string,
  options: { limit: number; exclude: Set<string> },
): Promise<ReferenceCandidate[]> {
  if (options.limit <= 0) return [];
  const pages = citedPages(markdown)
    .filter((page) => !options.exclude.has(page.url) && !isFrontPage(page.url))
    .slice(0, MAX_PAGES);
  if (pages.length === 0) return [];

  // Side by side: this runs inside the same sixty seconds as the photo search.
  const found = await Promise.all(
    pages.map(async (page): Promise<ReferenceCandidate | null> => {
      try {
        const lead = await leadImageOf(page);
        if (!lead) return null;
        const image = await downloadImage(lead.imageUrl);
        if (!image) return null;
        if (image.data.length / (image.width * image.height) < MIN_BYTES_PER_PIXEL) return null;
        return {
          ...image,
          originalName: `${lead.title || "Source image"}.${image.mimeType.split("/")[1] ?? "jpg"}`,
          origin: "article_source",
          sourceUrl: page.url,
          sourceName: lead.sourceName,
          license: null,
          attribution: null,
        };
      } catch {
        return null;
      }
    }),
  );

  // The same picture once: two pages from one site can lead with the same
  // image, and two copies of it is one choice, not two. By the bytes, not the
  // publisher — two articles from one magazine are usually two different works.
  const seen = new Set<string>();
  const kept: ReferenceCandidate[] = [];
  for (const candidate of found) {
    if (!candidate) continue;
    const print = fingerprint(candidate.data);
    if (seen.has(print)) continue;
    seen.add(print);
    kept.push(candidate);
    if (kept.length >= options.limit) break;
  }
  return kept;
}
