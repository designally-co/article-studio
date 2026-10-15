/**
 * In-body image blocks for the proposed article direction (preview only).
 *
 * The draft places each body image as a fenced block in its Markdown:
 *
 *     ```image
 *     id: img-1
 *     role: step
 *     purpose: Show where the grid's gutter is set in the layout panel.
 *     caption: Setting a 24px gutter before placing any type.
 *     alt: A layout panel with columns set to twelve and gutter to 24px.
 *     suggested_route: draw
 *     search_hint: Figma layout grid panel
 *     ```
 *
 * One `key: value` per line. The block stays in the Markdown while the article
 * is edited, so it moves with the text around it; the picture that fills it is
 * a row in `images` whose `position` is the block's slot (img-2 → 2). At
 * publish the block is replaced by the Hub's own upload placeholder.
 *
 * Plain module, no imports beyond its siblings: testable with `node --test`
 * and safe in a client component.
 */
import {
  BLOCK_ROLES,
  BLOCK_ROUTES,
  MAX_BODY_BLOCKS,
  TYPE_IMAGE_POLICY,
  effectiveRoute,
  type BlockRole,
  type BlockRoute,
} from "./image-routing";
import type { LabelType } from "./labels";

export type ImageBlock = {
  id: string;
  role: BlockRole | null;
  purpose: string;
  caption: string;
  alt: string;
  suggestedRoute: BlockRoute | null;
  searchHint: string;
};

export type LocatedImageBlock = ImageBlock & {
  /** Where the whole fence starts and ends in the Markdown it was read from. */
  start: number;
  end: number;
};

/** A fence that opens with ```image on its own line and closes with ``` on its own line. */
const FENCE = /^```image[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;

const KEYS: Record<string, keyof ImageBlock> = {
  id: "id",
  role: "role",
  purpose: "purpose",
  caption: "caption",
  alt: "alt",
  suggested_route: "suggestedRoute",
  route: "suggestedRoute",
  search_hint: "searchHint",
};

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/** Read the body of one fence (the lines between the backticks). */
export function parseImageBlockBody(body: string): ImageBlock {
  const block: ImageBlock = {
    id: "",
    role: null,
    purpose: "",
    caption: "",
    alt: "",
    suggestedRoute: null,
    searchHint: "",
  };
  for (const line of body.split(/\r?\n/)) {
    const match = /^\s*([a-z_]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const key = KEYS[match[1].toLowerCase()];
    if (!key) continue;
    const value = oneLine(match[2]).replace(/^["']|["']$/g, "");
    if (key === "role") {
      block.role = (BLOCK_ROLES as readonly string[]).includes(value) ? (value as BlockRole) : null;
    } else if (key === "suggestedRoute") {
      block.suggestedRoute = (BLOCK_ROUTES as readonly string[]).includes(value) ? (value as BlockRoute) : null;
    } else {
      block[key] = value;
    }
  }
  return block;
}

/** Every image block in the Markdown, in order. */
export function parseImageBlocks(markdown: string): LocatedImageBlock[] {
  const out: LocatedImageBlock[] = [];
  for (const match of markdown.matchAll(FENCE)) {
    const start = match.index ?? 0;
    out.push({ ...parseImageBlockBody(match[1]), start, end: start + match[0].length });
  }
  return out;
}

export function serializeImageBlock(block: ImageBlock): string {
  const lines = [
    "```image",
    `id: ${block.id}`,
    `role: ${block.role ?? ""}`,
    `purpose: ${oneLine(block.purpose)}`,
    `caption: ${oneLine(block.caption)}`,
    `alt: ${oneLine(block.alt)}`,
    `suggested_route: ${block.suggestedRoute ?? ""}`,
    `search_hint: ${oneLine(block.searchHint)}`,
    "```",
  ];
  return lines.join("\n");
}

/** The slot a block fills: img-1 → 1. Null for an id that is not img-1 … img-3. */
export function slotOf(id: string): number | null {
  const match = /^img-([1-9])$/.exec(id.trim());
  if (!match) return null;
  const slot = Number(match[1]);
  return slot >= 1 && slot <= MAX_BODY_BLOCKS ? slot : null;
}

/**
 * Replace each block with what `replace` returns for it: a string to put in
 * its place, or null to remove it (with the blank line it leaves).
 */
export function replaceImageBlocks(
  markdown: string,
  replace: (block: LocatedImageBlock, index: number) => string | null,
): string {
  const blocks = parseImageBlocks(markdown);
  let out = "";
  let cursor = 0;
  blocks.forEach((block, index) => {
    out += markdown.slice(cursor, block.start);
    const next = replace(block, index);
    if (next === null) {
      // Drop the block and collapse the gap it leaves to one blank line.
      out = out.replace(/\n+$/, "\n");
      cursor = block.end;
      while (markdown[cursor] === "\n" || markdown[cursor] === "\r") cursor += 1;
      out += "\n";
    } else {
      out += next;
      cursor = block.end;
    }
  });
  out += markdown.slice(cursor);
  return out;
}

export function removeImageBlock(markdown: string, id: string): string {
  return replaceImageBlocks(markdown, (block) => (block.id === id ? null : serializeImageBlock(block)));
}

export type NormalizedBlocks = {
  markdown: string;
  blocks: ImageBlock[];
  /** What was changed and why, in plain sentences. Empty when nothing was. */
  notes: string[];
};

/**
 * Hold the draft's blocks to what the article's type allows: no more than the
 * type's maximum (and never more than three), a role the type allows, a route
 * the type allows, and ids img-1 … img-3 with no repeats. A news or commentary
 * draft keeps no body images at all.
 */
export function normalizeImageBlocks(markdown: string, type: LabelType): NormalizedBlocks {
  const policy = TYPE_IMAGE_POLICY[type].body;
  const max = Math.min(policy.max, MAX_BODY_BLOCKS);
  const notes: string[] = [];
  const kept: ImageBlock[] = [];
  const used = new Set<string>();
  const parsed = parseImageBlocks(markdown);

  const next = replaceImageBlocks(markdown, (raw, index) => {
    if (kept.length >= max) {
      notes.push(
        max === 0
          ? `Removed image block ${index + 1}: a ${type.replace("_", " ")} carries no body images.`
          : `Removed image block ${index + 1}: a ${type.replace("_", " ")} carries at most ${max}.`,
      );
      return null;
    }
    const block: ImageBlock = { ...raw };
    if (!slotOf(block.id) || used.has(block.id)) {
      const free = Array.from({ length: MAX_BODY_BLOCKS }, (_, i) => `img-${i + 1}`).find(
        (candidate) => !used.has(candidate) && !parsed.some((other, j) => j > index && other.id === candidate),
      );
      if (!free) {
        notes.push(`Removed image block ${index + 1}: no free slot.`);
        return null;
      }
      if (block.id) notes.push(`Renamed image block "${block.id}" to ${free}.`);
      block.id = free;
    }
    used.add(block.id);
    if (!block.role || !policy.roles.includes(block.role)) {
      const role = policy.roles[0] ?? null;
      notes.push(`${block.id}: role "${block.role ?? "none"}" is not used for this type; set to "${role}".`);
      block.role = role;
    }
    const route = effectiveRoute(type, block.suggestedRoute);
    if (route !== block.suggestedRoute) {
      notes.push(`${block.id}: route "${block.suggestedRoute ?? "none"}" is not allowed for this type; set to "${route}".`);
      block.suggestedRoute = route;
    }
    kept.push(block);
    return serializeImageBlock(block);
  });

  return { markdown: next, blocks: kept, notes };
}

/**
 * The line under the title, when it is the proposal's one-line summary
 * (a single italic sentence). Returned without its markers, and the Markdown
 * without it: the Hub shows the summary on its own, above the body.
 */
export function takeSummaryLine(markdown: string): { summary: string | null; markdown: string } {
  const match = /^\s*(?:_([^_\n]{8,400})_|\*([^*\n]{8,400})\*)\s*(?:\n|$)/.exec(markdown);
  if (!match) return { summary: null, markdown };
  return { summary: (match[1] ?? match[2]).trim(), markdown: markdown.slice(match[0].length).replace(/^\s+/, "") };
}

/**
 * The body as the Hub should receive it: each filled block becomes the Hub's
 * own upload placeholder, `![media:<id>]()`, on a line of its own, with its
 * caption (and credit) as an italic line under it; an empty block is removed.
 *
 * WHY THE PLACEHOLDER AND NOT `![alt](url)`. Measured against Payload 3.86's
 * `convertMarkdownToLexical` (the Hub's converter): a standard Markdown image
 * arrives as the literal text "![alt](url)" in a paragraph. The placeholder is
 * the one image syntax its upload transformer imports, and only when it stands
 * alone on its line: inside a sentence it replaces the whole paragraph.
 */
export function hubBodyFromBlocks(
  markdown: string,
  placed: Record<string, { mediaId: number; caption: string; credit?: string | null }>,
): string {
  return replaceImageBlocks(markdown, (block) => {
    const image = placed[block.id];
    if (!image) return null;
    const caption = [image.caption.trim(), image.credit?.trim()].filter(Boolean).join(" · ").replace(/[_*]/g, "");
    return caption ? `![media:${image.mediaId}]()\n\n_${caption}_` : `![media:${image.mediaId}]()`;
  });
}
