import "server-only";
import { splitSourcesSection } from "@/lib/outline";
import { publicFetch, readCapped } from "@/lib/net/public-fetch";
import { getModels, runJson, type PromptImage } from "@/lib/anthropic";
import { IMAGE_SYSTEM_PROMPT } from "@/prompts/system";
import { sourceImageJudgeTask } from "@/prompts/tasks";
import { downloadImage, fingerprint, USER_AGENT, type ReferenceCandidate } from "./reference-sources";
import { loadSharp } from "./sharp";
import { COVER_MIN_WIDTH } from "./reference-policy";

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
const CHROME =
  /logo|icon|avatar|gravatar|sprite|badge|emoji|spinner|placeholder|loader|pixel|tracking|author|byline|contributor|profile|headshot|favicon|banner-ad|advert/i;

/**
 * THE AUTHOR IS NOT THE WORK. A byline carries the writer's photograph, often
 * large enough to pass every size test, and sometimes named nothing more
 * telling than `image-3.jpg`. So the blocks that hold one are removed before
 * any picture is collected: links to a person's page, and elements whose
 * class, id or microdata says author, byline, contributor, bio or staff. What
 * slips past this is caught by the judge, which rejects any portrait.
 */
const AUTHOR_LINK = /\/(?:authors?|contributors?|writers?|people|person|staff|team|profiles?|users?)\//i;
const AUTHOR_BLOCK =
  /author|byline|contributor|writer|avatar|gravatar|profile|headshot|staff|(?:^|[\s_-])bio(?:$|[\s_-])/i;
const VOID_TAGS = new Set(["img", "source", "br", "hr", "input", "meta", "link", "wbr"]);

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
  return (
    value
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      // Last, so "&amp;lt;" stays the text "&lt;" rather than becoming "<".
      .replace(/&amp;/g, "&")
      .trim()
  );
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
  const region = withoutAuthorBlocks(
    html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ??
      html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ??
      html.slice(Math.max(html.search(/<body\b/i), 0)),
  );

  const found: string[] = [];
  for (const tag of region.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const attributes = attributesOf(tag[0]);
    const described = ["alt", "class", "id", "src", "data-src"]
      .map((name) => attributes.get(name) ?? "")
      .join(" ");
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

/** The markup with every author block taken out. See AUTHOR_BLOCK. */
function withoutAuthorBlocks(html: string): string {
  // Links to a person's page. Anchors do not nest, so a lazy match is exact.
  const unlinked = html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (block) => {
    const open = block.match(/^<a\b[^>]*>/i)?.[0] ?? "";
    return AUTHOR_LINK.test(attributesOf(open).get("href") ?? "") ? "" : block;
  });

  // Marked elements, removed with everything inside them, counting depth so a
  // <div> inside the author <div> does not end the removal early.
  const opener = /<([a-z][a-z0-9-]*)\b[^>]*>/gi;
  let out = "";
  let index = 0;
  for (;;) {
    opener.lastIndex = index;
    let found: RegExpExecArray | null = null;
    for (let tag = opener.exec(unlinked); tag; tag = opener.exec(unlinked)) {
      const attributes = attributesOf(tag[0]);
      const marker = ["class", "id", "itemprop", "rel", "data-testid", "data-component"]
        .map((name) => attributes.get(name) ?? "")
        .join(" ");
      if (AUTHOR_BLOCK.test(marker)) {
        found = tag;
        break;
      }
    }
    if (!found) return out + unlinked.slice(index);

    out += unlinked.slice(index, found.index);
    const name = found[1].toLowerCase();
    let end = found.index + found[0].length;
    if (!VOID_TAGS.has(name) && !found[0].endsWith("/>")) {
      const tags = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi");
      tags.lastIndex = end;
      let depth = 1;
      end = unlinked.length;
      for (let tag = tags.exec(unlinked); tag; tag = tags.exec(unlinked)) {
        if (tag[0].endsWith("/>")) continue;
        depth += tag[1] ? -1 : 1;
        if (depth === 0) {
          end = tag.index + tag[0].length;
          break;
        }
      }
    }
    index = end;
  }
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

/**
 * Up to PER_PAGE downloaded pictures from one page, lead first. `lead` marks
 * the page's own og:image, which the publisher chose and which is kept even
 * when the judge cannot run.
 */
async function downloadPictures(page: {
  label: string;
  url: string;
}): Promise<{ candidate: ReferenceCandidate; lead: boolean }[]> {
  const pictures = await picturesOf(page);
  if (!pictures) return [];

  const [lead, ...body] = await Promise.all([
    pictures.lead ? downloadImage(pictures.lead).catch(() => null) : Promise.resolve(null),
    ...pictures.body.map((url) => downloadImage(url).catch(() => null)),
  ]);

  const kept = [
    ...(lead && !isFlatGraphic(lead) ? [{ image: lead, lead: true }] : []),
    ...body
      .filter(
        (image): image is NonNullable<typeof image> =>
          !!image && Math.max(image.width, image.height) >= MIN_BODY_EDGE && !isFlatGraphic(image),
      )
      .map((image) => ({ image, lead: false })),
  ].slice(0, PER_PAGE);

  return kept.map(({ image, lead: isLead }, index) => ({
    lead: isLead,
    candidate: {
      ...image,
      originalName: `${pictures.title || "Source image"}${index ? ` (${index + 1})` : ""}.${image.mimeType.split("/")[1] ?? "jpg"}`,
      origin: "article_source" as const,
      // The page, not the file: the credit and the permission are about where
      // the picture was published, and that is what a person can check.
      sourceUrl: page.url,
      sourceName: pictures.sourceName,
      license: null,
      attribution: null,
    },
  }));
}

/** How long the judge may take; this runs inside a sixty-second step. */
const JUDGE_TIMEOUT_MS = 20_000;
/** The side a preview is shrunk to before the judge sees it. */
const PREVIEW_EDGE = 768;
/** Raw bytes the vision API will take when a preview cannot be made. */
const MAX_RAW_PREVIEW_BYTES = 3.5 * 1024 * 1024;

type Verdict = "subject" | "related" | "reject";

/** A small JPEG of the picture for the judge, or the bytes themselves where sharp is missing. */
async function previewOf(candidate: ReferenceCandidate): Promise<PromptImage | null> {
  try {
    const sharp = await loadSharp();
    const data = await sharp(candidate.data)
      .rotate()
      .resize({
        width: PREVIEW_EDGE,
        height: PREVIEW_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 70 })
      .toBuffer();
    return { base64: data.toString("base64"), mediaType: "image/jpeg" };
  } catch {
    if (candidate.data.length > MAX_RAW_PREVIEW_BYTES) return null;
    return {
      base64: candidate.data.toString("base64"),
      mediaType: candidate.mimeType,
    };
  }
}

/**
 * Look at every picture and rule on it against the article. Null when the judge
 * could not run; a picture it did not rule on is rejected — silence is not
 * approval.
 */
async function judgeSourcePictures(
  candidates: ReferenceCandidate[],
  article: {
    projectId: string;
    title: string;
    angle?: string;
    opening: string;
  },
): Promise<Verdict[] | null> {
  const previews = await Promise.all(candidates.map(previewOf));
  const visible = candidates
    .map((candidate, index) => ({ candidate, index, preview: previews[index] }))
    .filter(
      (
        entry,
      ): entry is {
        candidate: ReferenceCandidate;
        index: number;
        preview: PromptImage;
      } => !!entry.preview,
    );
  if (visible.length === 0) return null;

  try {
    const { research } = await getModels();
    const { data } = await runJson<{ verdicts: Verdict[] }>({
      model: research,
      system: IMAGE_SYSTEM_PROMPT,
      task: sourceImageJudgeTask({
        title: article.title,
        angle: article.angle,
        opening: article.opening,
        pages: visible.map((entry) => `${entry.candidate.sourceName} — ${entry.candidate.sourceUrl}`),
      }),
      images: visible.map((entry) => entry.preview),
      schema: {
        type: "object",
        properties: {
          verdicts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                candidate: { type: "integer" },
                verdict: {
                  type: "string",
                  enum: ["subject", "related", "reject"],
                },
              },
              required: ["candidate", "verdict"],
              additionalProperties: false,
            },
          },
        },
        required: ["verdicts"],
        additionalProperties: false,
      },
      maxTokens: 800,
      timeoutMs: JUDGE_TIMEOUT_MS,
      allowHeal: false,
      cache: false,
      projectId: article.projectId,
      stage: "source_image_judge",
      validate: (raw) => {
        const list = (raw as { verdicts?: { candidate?: unknown; verdict?: unknown }[] }).verdicts;
        const verdicts: Verdict[] = candidates.map(() => "reject");
        for (const item of Array.isArray(list) ? list : []) {
          const n = Number(item?.candidate);
          if (!Number.isInteger(n) || n < 1 || n > visible.length) continue;
          if (item.verdict === "subject" || item.verdict === "related") {
            verdicts[visible[n - 1].index] = item.verdict;
          }
        }
        return { verdicts };
      },
    });
    return data.verdicts;
  } catch {
    return null;
  }
}

/**
 * Pictures from the pages this article cites, at most `limit`, skipping any page
 * already recorded as a reference's source.
 *
 * Dealt round the pages rather than page by page: every page's lead first,
 * then every page's second picture, then its third. Three angles on the first
 * page's project are worth less than one picture each of three projects.
 *
 * THEN JUDGED, and only then cut to `limit`, so a rejected picture never takes
 * a place a good one could have had. What shows the article's own subject goes
 * first — the autopilot, which asks for one, uses that one as the cover as it
 * is (see `runReferenceStep`). Where the judge cannot run, only the pages'
 * lead images are kept, as `related`: the publisher chose those, and nothing
 * unjudged is ever offered as the article's subject.
 */
export async function findArticleSourceImages(
  markdown: string,
  options: {
    limit: number;
    exclude: Set<string>;
    projectId: string;
    title: string;
    angle?: string;
  },
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
  const dealt: { candidate: ReferenceCandidate; lead: boolean }[] = [];
  for (let round = 0; round < PER_PAGE; round += 1) {
    for (const pictures of perPage) {
      const entry = pictures[round];
      if (!entry) continue;
      const print = fingerprint(entry.candidate.data);
      if (seen.has(print)) continue;
      seen.add(print);
      dealt.push(entry);
    }
  }
  if (dealt.length === 0) return [];

  const verdicts = await judgeSourcePictures(
    dealt.map((entry) => entry.candidate),
    {
      projectId: options.projectId,
      title: options.title,
      angle: options.angle,
      opening: markdown
        .replace(/^#\s+.+$/m, "")
        .trim()
        .slice(0, 1500),
    },
  );

  const ruled = verdicts
    ? dealt
        .map((entry, index) => ({ ...entry.candidate, match: verdicts[index] }))
        .filter(
          (
            candidate,
          ): candidate is ReferenceCandidate & {
            match: "subject" | "related";
          } => candidate.match !== "reject",
        )
    : dealt.filter((entry) => entry.lead).map((entry) => ({ ...entry.candidate, match: "related" as const }));

  /* Subject first, and among those the ones big enough to be the cover as they
     are (COVER_MIN_WIDTH) — a routine asks for one, and uses it as the cover
     only if it clears that bar. The round order is kept within each group. */
  const coverSized = (candidate: ReferenceCandidate) => candidate.width >= COVER_MIN_WIDTH;
  return [
    ...ruled.filter((candidate) => candidate.match === "subject" && coverSized(candidate)),
    ...ruled.filter((candidate) => candidate.match === "subject" && !coverSized(candidate)),
    ...ruled.filter((candidate) => candidate.match === "related"),
  ].slice(0, options.limit);
}
