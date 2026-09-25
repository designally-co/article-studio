import "server-only";
import { splitSourcesSection } from "@/lib/outline";
import { publicFetch, readCapped } from "@/lib/net/public-fetch";
import { downloadImage, fingerprint, USER_AGENT, type ReferenceCandidate } from "./reference-sources";

/**
 * Pictures from the pages the article cites — the studio's own pictures of its
 * own work.
 *
 * WHY THIS IS THE FIRST PLACE TO LOOK. An article about Pentagram's new
 * identity cites Pentagram's case study, and the case study opens with the
 * identity photographed properly. That picture is the one a reader wants, and
 * it is what the publications worth imitating run: the work itself, "courtesy
 * of" the studio. No photo library has it and no model should fake it.
 *
 * NOTHING HERE IS CLEARED. A page's pictures belong to whoever published them,
 * and a credit is not a licence. These come back with `license: null`, which
 * the image stage shows as "needs permission", and none of them can become a
 * cover until a person confirms the press-kit terms allow it or that permission
 * was given (see `sourced-cover.ts`). They may still be used as a REFERENCE for
 * generation straight away, as any photograph could.
 *
 * UP TO THREE PER PAGE. First the lead image — `og:image`, the one picture the
 * publisher put forward for the page — then the largest pictures in the page's
 * own body, which on a case study are the same work from other angles: the
 * packaging, the signage, the spread. The rest of a page is chrome — logos,
 * icons, avatars, other articles' thumbnails — and is filtered by what it is
 * called, how big it says it is, and, once downloaded, how big it really is.
 */

/** Pages visited per search. Each is one fetch of HTML and a few of images. */
const MAX_PAGES = 5;
const PAGE_TIMEOUT_MS = 6_000;
/** Far past any real page; the body is read now, not only the head. */
const MAX_PAGE_BYTES = 1.5 * 1024 * 1024;
/** Pictures kept from one page: the lead and two from the body. */
const PER_PAGE = 3;
/** Body pictures downloaded per page to find those two. Each may be megabytes. */
const BODY_CANDIDATES = 4;
/** A body picture smaller than this on its long edge is not cover material. */
const MIN_BODY_EDGE = 800;
/**
 * Names that mean page furniture. Matched against a picture's address, alt,
 * class and id — a studio's case study rarely calls its hero `logo.png`, and a
 * site's header nearly always does.
 */
const CHROME = /logo|icon|avatar|sprite|badge|emoji|spinner|placeholder|loader|pixel|tracking|author|profile|headshot|favicon|banner-ad|advert/i;

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

/** Every attribute of one tag, lower-cased names, entity-decoded values. */
function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const attribute of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    const name = attribute[1].toLowerCase();
    if (!attributes.has(name)) attributes.set(name, decodeEntities(attribute[3] ?? attribute[4] ?? ""));
  }
  return attributes;
}

/**
 * The largest address a `srcset` offers. Split on a comma FOLLOWED BY SPACE:
 * image CDNs put bare commas inside their addresses (`c_fill,w_800`).
 */
function largestInSrcset(srcset: string): string | null {
  let best: { url: string; size: number } | null = null;
  for (const entry of srcset.split(/,\s+/)) {
    const [url, descriptor = ""] = entry.trim().split(/\s+/);
    if (!url) continue;
    const size = Number.parseFloat(descriptor) || 0;
    if (!best || size >= best.size) best = { url, size };
  }
  return best?.url ?? null;
}

/**
 * The pictures in a page's own content, largest rendition of each, in page
 * order. The article or main element when the page has one — outside it are
 * the header, the footer and the "more stories" rail.
 */
function bodyImages(html: string): string[] {
  const region =
    html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ??
    html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ??
    html.slice(Math.max(html.search(/<body\b/i), 0));

  const found: string[] = [];
  for (const tag of region.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const attributes = attributesOf(tag[0]);
    const described = ["alt", "class", "id", "src", "data-src"].map((name) => attributes.get(name) ?? "").join(" ");
    if (CHROME.test(described)) continue;
    // A size the markup states, and states as small, is believed.
    const width = Number(attributes.get("width") ?? 0);
    const height = Number(attributes.get("height") ?? 0);
    if (width && height && Math.max(width, height) < MIN_BODY_EDGE / 2) continue;

    const srcset = attributes.get("data-srcset") ?? attributes.get("srcset");
    const url =
      (srcset && largestInSrcset(srcset)) ||
      attributes.get("data-src") ||
      attributes.get("data-lazy-src") ||
      attributes.get("data-original") ||
      attributes.get("src");
    if (!url || url.startsWith("data:") || /\.(svg|gif)(\?|$)/i.test(url)) continue;
    found.push(url);
  }
  return found;
}

/** The address without its query: one picture at two CDN sizes is one picture. */
function samePicture(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/** What one cited page offers: its name, its title, and picture addresses, lead first. */
async function picturesOf(page: { label: string; url: string }): Promise<{
  lead: string | null;
  body: string[];
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

  const bytes = await readCapped(response, MAX_PAGE_BYTES);
  if (!bytes) return null;
  const html = bytes.toString("utf8");
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html;
  const base = response.url || page.url;
  const resolve = (raw: string): string | null => {
    try {
      const url = new URL(raw, base);
      return url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  };

  const meta = metaTags(head);
  const leadRaw = meta.get("og:image:secure_url") ?? meta.get("og:image") ?? meta.get("twitter:image");
  const lead = leadRaw ? resolve(leadRaw) : null;

  const seen = new Set(lead ? [samePicture(lead)] : []);
  const body: string[] = [];
  for (const raw of bodyImages(headEnd > 0 ? html.slice(headEnd) : html)) {
    const url = resolve(raw);
    if (!url) continue;
    const key = samePicture(url);
    if (seen.has(key)) continue;
    seen.add(key);
    body.push(url);
    if (body.length >= BODY_CANDIDATES) break;
  }

  const host = new URL(page.url).hostname.replace(/^www\./, "");
  return {
    lead,
    body,
    sourceName: (meta.get("og:site_name") ?? host).slice(0, 180),
    title: (meta.get("og:title") ?? page.label).slice(0, 90),
  };
}

/** A flat graphic — a logo card, a share template — rather than a picture of anything. */
function isFlatGraphic(image: { data: Buffer; width: number; height: number }): boolean {
  return image.data.length / (image.width * image.height) < MIN_BYTES_PER_PIXEL;
}

/** Up to PER_PAGE downloaded pictures from one page, lead first. */
async function downloadPictures(page: { label: string; url: string }): Promise<ReferenceCandidate[]> {
  const pictures = await picturesOf(page);
  if (!pictures) return [];

  const [lead, ...body] = await Promise.all([
    pictures.lead ? downloadImage(pictures.lead).catch(() => null) : Promise.resolve(null),
    ...pictures.body.map((url) => downloadImage(url).catch(() => null)),
  ]);

  const kept = [
    ...(lead && !isFlatGraphic(lead) ? [lead] : []),
    ...body.filter(
      (image): image is NonNullable<typeof image> =>
        !!image && Math.max(image.width, image.height) >= MIN_BODY_EDGE && !isFlatGraphic(image),
    ),
  ].slice(0, PER_PAGE);

  return kept.map((image, index) => ({
    ...image,
    originalName: `${pictures.title || "Source image"}${index ? ` (${index + 1})` : ""}.${image.mimeType.split("/")[1] ?? "jpg"}`,
    origin: "article_source" as const,
    // The page, not the file: the credit and the permission are about where
    // the picture was published, and that is what a person can check.
    sourceUrl: page.url,
    sourceName: pictures.sourceName,
    license: null,
    attribution: null,
  }));
}

/**
 * Pictures from the pages this article cites, at most `limit`, skipping any page
 * already recorded as a reference's source.
 *
 * Dealt round the pages rather than page by page: every page's lead first,
 * then every page's second picture, then its third. Three angles on the first
 * page's project are worth less than one picture each of three projects, and
 * the autopilot, which asks for one, gets the first page's lead.
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
  const perPage = await Promise.all(pages.map((page) => downloadPictures(page).catch(() => [])));

  // The same picture once, by its bytes: two pages of one site can lead with
  // the same image, and two copies of it is one choice, not two.
  const seen = new Set<string>();
  const kept: ReferenceCandidate[] = [];
  for (let round = 0; round < PER_PAGE && kept.length < options.limit; round += 1) {
    for (const pictures of perPage) {
      const candidate = pictures[round];
      if (!candidate) continue;
      const print = fingerprint(candidate.data);
      if (seen.has(print)) continue;
      seen.add(print);
      kept.push(candidate);
      if (kept.length >= options.limit) break;
    }
  }
  return kept;
}
