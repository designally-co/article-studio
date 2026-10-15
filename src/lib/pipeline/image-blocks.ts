import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { images, type ProjectInputs } from "@/db/schema";
import { loadProject, type LoadedProject } from "@/lib/projects";
import { getModels, runText } from "@/lib/anthropic";
import { logImageUsage } from "@/lib/cost";
import { imageGenerationOptions, getImageProvider } from "@/lib/image/registry";
import { deleteStoredImage, saveGeneratedImage } from "@/lib/image/storage";
import { loadSharp } from "@/lib/image/sharp";
import { findArticleSourceImages } from "@/lib/image/article-sources";
import { findRelatedReferences } from "@/lib/image/reference-search";
import { findReferenceImagesCore, generateImagesCore } from "./images";
import { coverFromReferenceCore } from "./sourced-cover";
import { generateImagePromptCore } from "./image-prompt";
import { IMAGE_ASPECT_RATIOS, type ImageAspectRatio } from "@/lib/image/providers";
import { projects } from "@/db/schema";
import type { ReferenceCandidate } from "@/lib/image/reference-sources";
import { imageSystemPromptFor } from "@/prompts/system";
import { blockImagePromptTask, drawFigureTask } from "@/prompts/direction";
import { finishImagePrompt } from "@/lib/image/visual-brief";
import { parseImageBlocks, slotOf, type LocatedImageBlock } from "@/lib/direction/image-blocks";
import {
  AUTO_FILL_ROUTES,
  RIGHTS_HOLD_AS_DRAFT,
  TYPE_IMAGE_POLICY,
  effectiveRoute,
  isCoverSourceAllowed,
  isRouteAllowed,
  rightsForOrigin,
  type BlockRoute,
  type ImageFit,
  type Rights,
} from "@/lib/direction/image-routing";
import type { ArticleLabels } from "@/lib/direction/labels";
import { draftCreditLabel } from "./sourced-cover";
import type { BlockFillResult, BlockImageView } from "./views";

/**
 * Filling the in-body image blocks of the proposed article direction
 * (preview only), with no session check.
 *
 * Out of the stage's `"use server"` module for the usual reason: every
 * exported async function in one is a callable endpoint, and these spend
 * money. The block actions import them behind `requireUser()`; the autopilot
 * imports `autoFillBlocksCore` behind its own secret.
 *
 * Every picture placed is a row in `images` with `position` = the block's slot
 * (img-2 → 2), and its route, caption, alt, credit, source page and rights
 * written beside it (migration 0031). Every fill is also logged as one line,
 * so a trial can be read back from the server log.
 */

type BlockContext = {
  loaded: LoadedProject;
  labels: ArticleLabels;
  block: LocatedImageBlock;
  slot: number;
  article: string;
  title: string;
};

async function loadBlock(projectId: string, blockId: string): Promise<BlockContext> {
  const loaded = await loadProject(projectId);
  if (!loaded) throw new Error("Project not found.");
  const labels = loaded.project.inputs.labels;
  if (!labels) throw new Error("This article has no labels, so it has no image blocks.");
  const draft = loaded.drafts.find((d) => d.isSelected) ?? loaded.drafts[0];
  const article = draft?.contentMd ?? "";
  const block = parseImageBlocks(article).find((entry) => entry.id === blockId);
  if (!block) throw new Error(`There is no image block "${blockId}" in the draft. Save the draft and try again.`);
  const slot = slotOf(block.id);
  if (!slot) throw new Error(`Image block "${blockId}" has no slot (use img-1 to img-3).`);
  const title = article.match(/^#\s+(.+)$/m)?.[1]?.trim() || loaded.project.selectedTopic?.title || "Untitled";
  return { loaded, labels, block, slot, article, title };
}

function assertRoute(ctx: BlockContext, route: BlockRoute) {
  if (!isRouteAllowed(ctx.labels.type, route)) {
    throw new Error(`A ${ctx.labels.type.replace("_", " ")} does not use "${route}" for body images.`);
  }
}

function fitFor(ctx: BlockContext): ImageFit {
  return {
    pillar: ctx.labels.pillar,
    type: ctx.labels.type,
    role: ctx.block.role ?? "evidence",
    purpose: ctx.block.purpose,
    subject: ctx.block.searchHint,
    narrowers: [ctx.labels.topic, ...ctx.labels.keywords],
  };
}

const ratioOf = (width: number, height: number) => {
  const r = width / height;
  if (r > 1.6) return "16:9";
  if (r > 1.2) return "3:2";
  if (r > 0.9) return "1:1";
  if (r > 0.7) return "4:5";
  return "2:3";
};

export function blockImageView(row: typeof images.$inferSelect): BlockImageView {
  return {
    id: row.id,
    blockId: row.blockId ?? "",
    slot: row.position ?? 0,
    url: `/api/images/${row.id}`,
    route: (row.route as BlockRoute | null) ?? null,
    caption: row.caption ?? "",
    alt: row.alt ?? "",
    credit: row.credit ?? "",
    sourceUrl: row.sourceUrl ?? "",
    rights: row.rights ?? "unknown",
    provider: row.provider,
    model: row.model,
    width: row.width ?? null,
    height: row.height ?? null,
  };
}

/** The newest picture per block, keyed by block id. */
export function blockImagesOf(rows: (typeof images.$inferSelect)[]): Record<string, BlockImageView> {
  const out: Record<string, BlockImageView> = {};
  const newestFirst = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const row of newestFirst) {
    if (!row.blockId || row.position === null) continue;
    if (!out[row.blockId]) out[row.blockId] = blockImageView(row);
  }
  return out;
}

/** Replace whatever filled this block before with the new picture. */
async function saveBlockImage(
  ctx: BlockContext,
  input: {
    data: Buffer;
    route: BlockRoute;
    provider: string;
    model: string;
    prompt: string;
    rights: Rights;
    credit?: string | null;
    sourceUrl?: string | null;
  },
): Promise<BlockImageView> {
  const projectId = ctx.loaded.project.id;
  const stored = await saveGeneratedImage({ data: input.data, mimeType: "image/png", ext: "png" });
  const db = await getDb();
  const previous = await db
    .select()
    .from(images)
    .where(and(eq(images.projectId, projectId), eq(images.position, ctx.slot)));
  const [row] = await db
    .insert(images)
    .values({
      projectId,
      provider: input.provider,
      model: input.model,
      prompt: input.prompt.slice(0, 8000),
      aspectRatio: ratioOf(stored.width, stored.height),
      width: stored.width,
      height: stored.height,
      storagePath: stored.storagePath,
      position: ctx.slot,
      blockId: ctx.block.id,
      route: input.route,
      caption: ctx.block.caption,
      alt: ctx.block.alt,
      credit: input.credit ?? null,
      sourceUrl: input.sourceUrl ?? null,
      rights: input.rights,
    })
    .returning();
  // The old picture for this slot goes, file and row: one block, one picture.
  for (const old of previous) {
    await db.delete(images).where(eq(images.id, old.id));
    await deleteStoredImage(old.storagePath).catch(() => false);
  }
  console.info(
    `[direction] image ${JSON.stringify({
      projectId,
      block: ctx.block.id,
      route: input.route,
      sourceUrl: input.sourceUrl ?? null,
      credit: input.credit ?? null,
      rights: input.rights,
    })}`,
  );
  return blockImageView(row);
}

/* ---------------------------------------------------------------- Find --- */

/** Is this search hint a page address? Then that page is where to look. */
function hintPage(hint: string): { label: string; url: string } | null {
  try {
    const url = new URL(hint.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? { label: url.hostname, url: url.toString() } : null;
  } catch {
    return null;
  }
}

export async function findBlockImageCore(projectId: string, blockId: string): Promise<BlockFillResult> {
  const ctx = await loadBlock(projectId, blockId);
  assertRoute(ctx, "find");
  const policy = TYPE_IMAGE_POLICY[ctx.labels.type].body;
  const fit = fitFor(ctx);
  const stats = { judged: 0, rejected: 0 };
  const tried: string[] = [];
  /* A case study's evidence and a resource's preview must show THE thing
     itself, so only a picture judged to be the article's subject will do.
     Anything else may be merely related. */
  const strict = ctx.block.role === "evidence" || ctx.block.role === "preview";
  let chosen: ReferenceCandidate | null = null;

  if (policy.find.includes("cited_pages")) {
    const page = hintPage(ctx.block.searchHint);
    tried.push(page ? `the page ${page.url}` : "the pages the article cites");
    const found = await findArticleSourceImages(ctx.article, {
      limit: 3,
      exclude: new Set(),
      projectId,
      title: ctx.title,
      angle: ctx.block.purpose,
      fit,
      pages: page ? [page] : undefined,
      stats,
    }).catch(() => []);
    chosen = found.find((candidate) => candidate.match === "subject") ?? (strict ? null : (found[0] ?? null));
    // A named page with nothing usable still leaves the article's own cited pages to try.
    if (!chosen && page) {
      tried.push("the pages the article cites");
      const cited = await findArticleSourceImages(ctx.article, {
        limit: 3,
        exclude: new Set([page.url]),
        projectId,
        title: ctx.title,
        angle: ctx.block.purpose,
        fit,
        stats,
      }).catch(() => []);
      chosen = cited.find((candidate) => candidate.match === "subject") ?? (strict ? null : (cited[0] ?? null));
    }
  }

  if (!chosen && policy.find.includes("library")) {
    tried.push("the photo library");
    const search = await findRelatedReferences({
      projectId,
      title: ctx.title,
      angle: ctx.block.purpose,
      article: ctx.article.slice(0, 3000),
      seedQuery: ctx.block.searchHint,
      limit: 1,
      fit,
    });
    stats.judged += search.found;
    stats.rejected += search.rejected;
    chosen = search.candidates[0] ?? null;
  }

  const log = { route: "find" as const, tried, judged: stats.judged, rejected: stats.rejected };
  if (!chosen) {
    console.info(`[direction] image ${JSON.stringify({ projectId, block: blockId, route: "find", empty: true, ...stats })}`);
    return {
      image: null,
      note: `Nothing found in ${tried.join(", then ")} shows ${
        hintPage(ctx.block.searchHint) ? "what this block needs" : ctx.block.searchHint || "this subject"
      } well enough${
        stats.rejected ? ` (${stats.rejected} picture${stats.rejected === 1 ? "" : "s"} turned down)` : ""
      }. This block needs a person: upload the picture.`,
      log,
    };
  }

  const credit =
    chosen.origin === "article_source"
      ? draftCreditLabel(chosen).replace(/^Cover image /, "Image ").replace(/^Image courtesy/, "Courtesy")
      : chosen.attribution || draftCreditLabel(chosen).replace(/^Cover image: /, "");
  const image = await saveBlockImage(ctx, {
    data: chosen.data,
    route: "find",
    provider: chosen.origin === "article_source" ? "source" : "library",
    model: chosen.origin,
    prompt: `Found on ${chosen.sourceUrl}`,
    rights: rightsForOrigin(chosen.origin),
    credit,
    sourceUrl: chosen.sourceUrl,
  });
  return { image, log };
}

/* ------------------------------------------------------------ Generate --- */

export async function generateBlockImageCore(projectId: string, blockId: string): Promise<BlockFillResult> {
  const ctx = await loadBlock(projectId, blockId);
  assertRoute(ctx, "generate");
  const options = await imageGenerationOptions();
  const option = options.find(
    (entry) => !entry.capabilities.referenceImagesRequired && entry.capabilities.aspectRatios.includes("3:2"),
  );
  const provider = option ? getImageProvider(option.providerId) : undefined;
  if (!option || !provider) throw new Error("No image generator is configured (add a Fal.ai key in Settings).");

  const { image: model } = await getModels();
  const { text } = await runText({
    model,
    system: imageSystemPromptFor(ctx.labels),
    task: blockImagePromptTask({
      title: ctx.title,
      labels: ctx.labels,
      purpose: ctx.block.purpose,
      caption: ctx.block.caption,
      searchHint: ctx.block.searchHint,
      role: ctx.block.role ?? "mood",
    }),
    maxTokens: 650,
    projectId,
    stage: "block_image_prompt",
  });
  const prompt = finishImagePrompt(text, "illustration", false);
  const result = await provider.generate({ prompt, aspectRatio: "3:2", referenceImages: [] }, option.keyId || undefined);
  const first = result.images[0];
  if (!first) throw new Error("The generator returned no image.");
  await logImageUsage({ projectId, stage: "block_image_generate", model: provider.model, count: 1, unitPrice: provider.indicativePricePerImage });
  const image = await saveBlockImage(ctx, {
    data: first.data,
    route: "generate",
    provider: provider.provider,
    model: provider.model,
    prompt,
    rights: "own",
  });
  return { image, log: { route: "generate", tried: [provider.label], judged: 0, rejected: 0 } };
}

/* ---------------------------------------------------------------- Draw --- */

/**
 * Keep an SVG to drawing only: no scripts, no event handlers, no embedded
 * documents or images, no links outside the file. What is left is rendered by
 * sharp (librsvg) on the server, never shown to a browser as SVG.
 */
export function sanitizeSvg(raw: string): string {
  const start = raw.indexOf("<svg");
  const end = raw.lastIndexOf("</svg>");
  if (start < 0 || end < 0) throw new Error("The figure did not come back as an SVG.");
  return raw
    .slice(start, end + "</svg>".length)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<image\b[^>]*>(<\/image>)?/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, "")
    .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, "none")
    .replace(/—/g, ", ");
}

/** The paragraphs around a block, so the figure is drawn from what the reader is reading. */
function contextAround(article: string, block: LocatedImageBlock): string {
  const before = article.slice(Math.max(0, block.start - 1500), block.start);
  const after = article.slice(block.end, block.end + 600);
  return `${before}\n[the figure goes here]\n${after}`.replace(/```image[\s\S]*?```/g, "").trim();
}

export async function drawBlockImageCore(projectId: string, blockId: string): Promise<BlockFillResult> {
  const ctx = await loadBlock(projectId, blockId);
  assertRoute(ctx, "draw");
  const { drafting: model } = await getModels();
  const { text } = await runText({
    model,
    system: "You draw clean, correct editorial figures as SVG for a design publication. You output SVG only.",
    task: drawFigureTask({
      title: ctx.title,
      labels: ctx.labels,
      role: ctx.block.role ?? "diagram",
      purpose: ctx.block.purpose,
      caption: ctx.block.caption,
      context: contextAround(ctx.article, ctx.block),
    }),
    maxTokens: 6000,
    projectId,
    stage: "block_draw_svg",
  });
  const svg = sanitizeSvg(text);
  const sharp = await loadSharp();
  // Rendered at twice the drawing's size, then stored at the delivery width.
  const png = await sharp(Buffer.from(svg), { density: 144 }).flatten({ background: "#ffffff" }).png().toBuffer();
  const image = await saveBlockImage(ctx, {
    data: png,
    route: "draw",
    provider: "svg",
    model,
    prompt: svg,
    rights: "own",
  });
  return { image, log: { route: "draw", tried: [model], judged: 0, rejected: 0 } };
}

/* -------------------------------------------------------------- Upload --- */

export async function uploadBlockImageCore(
  projectId: string,
  blockId: string,
  file: { data: Buffer; name: string },
  meta: { credit?: string; sourceUrl?: string },
): Promise<BlockFillResult> {
  const ctx = await loadBlock(projectId, blockId);
  assertRoute(ctx, "upload");
  // The editor is not asked about rights (build session, 2026-10-15): an upload is recorded as their own.
  const rights: Rights = "own";
  const image = await saveBlockImage(ctx, {
    data: file.data,
    route: "upload",
    provider: "upload",
    model: "upload",
    prompt: `Uploaded: ${file.name}`.slice(0, 300),
    rights,
    credit: meta.credit?.trim() || null,
    sourceUrl: meta.sourceUrl?.trim() || null,
  });
  return { image, log: { route: "upload", tried: [], judged: 0, rejected: 0 } };
}

/* ------------------------------------------------------- Rights, remove --- */

/** Remove the picture filling a block (the block itself is removed from the draft by the editor). */
export async function clearBlockImagesCore(projectId: string, blockId: string): Promise<void> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(images)
    .where(and(eq(images.projectId, projectId), eq(images.blockId, blockId)));
  for (const row of rows) {
    await db.delete(images).where(eq(images.id, row.id));
    await deleteStoredImage(row.storagePath).catch(() => false);
  }
}

/* ------------------------------------------------------------ Autopilot --- */

/**
 * Fill what an unattended run may fill: Generate and Draw blocks only. Find
 * and Upload blocks wait for a person, and publishing holds the article as a
 * Hub draft while any block is empty.
 */
export async function autoFillBlocksCore(
  projectId: string,
): Promise<{ filled: string[]; waiting: string[]; failed: { blockId: string; error: string }[] }> {
  const loaded = await loadProject(projectId);
  const labels = loaded?.project.inputs.labels;
  const out = { filled: [] as string[], waiting: [] as string[], failed: [] as { blockId: string; error: string }[] };
  if (!loaded || !labels) return out;
  const draft = loaded.drafts.find((d) => d.isSelected) ?? loaded.drafts[0];
  const filled = blockImagesOf(loaded.images);
  for (const block of parseImageBlocks(draft?.contentMd ?? "")) {
    if (filled[block.id]) continue;
    const route = effectiveRoute(labels.type, block.suggestedRoute);
    if (!AUTO_FILL_ROUTES.includes(route)) {
      out.waiting.push(block.id);
      continue;
    }
    try {
      const result =
        route === "draw" ? await drawBlockImageCore(projectId, block.id) : await generateBlockImageCore(projectId, block.id);
      (result.image ? out.filled : out.waiting).push(block.id);
    } catch (error) {
      out.failed.push({ blockId: block.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}

/* ------------------------------------------------------------- Publish --- */

/**
 * Why a labelled article may only go to the Hub as a draft: an empty block,
 * or a picture whose rights are unknown or pending. Empty when nothing holds
 * it. Read by publishing and shown on the Publish stage.
 */
export function holdAsDraftReasons(loaded: LoadedProject, inputs: ProjectInputs = loaded.project.inputs): string[] {
  if (!inputs.labels) return [];
  const draft = loaded.drafts.find((d) => d.isSelected) ?? loaded.drafts[0];
  const filled = blockImagesOf(loaded.images);
  const reasons: string[] = [];
  for (const block of parseImageBlocks(draft?.contentMd ?? "")) {
    const image = filled[block.id];
    if (!image) reasons.push(`${block.id} is empty.`);
    else if (RIGHTS_HOLD_AS_DRAFT.includes(image.rights as Rights)) {
      reasons.push(`${block.id}: rights are ${image.rights.replace("_", " ")}.`);
    }
  }
  const coverId = inputs.coverImageId;
  const cover = loaded.images.find((image) => image.id === coverId) ?? loaded.images.find((image) => image.position === null);
  if (cover?.rights && RIGHTS_HOLD_AS_DRAFT.includes(cover.rights)) {
    reasons.push(`The cover's rights are ${cover.rights.replace("_", " ")}.`);
  }
  return reasons;
}

/* --------------------------------------------------------------- Cover --- */

/*
 * THE COVER IS PART OF THE DRAFT STAGE in the proposed direction (build
 * session, 2026-10-15: "the cover image must be at draft stage too", "just
 * draft and publish steps"). The same work the Image stage and the autopilot
 * do, by the type's cover route: a case study's cover comes from its cited
 * pages only and is never generated; commentary's never from a cited page.
 */

/** Which cover routes this article's type allows. Upload always. */
export function coverRoutesFor(labels: ArticleLabels): BlockRoute[] {
  const routes: BlockRoute[] = [];
  if (isCoverSourceAllowed(labels.type, "cited_pages") || isCoverSourceAllowed(labels.type, "library")) routes.push("find");
  if (isCoverSourceAllowed(labels.type, "generate")) routes.push("generate");
  routes.push("upload");
  return routes;
}

async function labelsOf(projectId: string): Promise<ArticleLabels> {
  const loaded = await loadProject(projectId);
  const labels = loaded?.project.inputs.labels;
  if (!labels) throw new Error("This article has no labels.");
  return labels;
}

async function coverView(imageId: string): Promise<BlockImageView> {
  const db = await getDb();
  const [row] = await db.select().from(images).where(eq(images.id, imageId)).limit(1);
  if (!row) throw new Error("The cover was not saved.");
  return blockImageView(row);
}

async function setCover(projectId: string, imageId: string) {
  const db = await getDb();
  const [row] = await db.select({ inputs: projects.inputs }).from(projects).where(eq(projects.id, projectId)).limit(1);
  await db
    .update(projects)
    .set({ inputs: { ...(row?.inputs ?? {}), coverImageId: imageId }, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

export async function findCoverCore(projectId: string): Promise<BlockFillResult> {
  const labels = await labelsOf(projectId);
  if (!coverRoutesFor(labels).includes("find")) throw new Error(`A ${labels.type.replace("_", " ")} cover is not found online.`);
  const drafted = await generateImagePromptCore(projectId, { variationCount: 1 }).catch(() => null);
  const found = await findReferenceImagesCore(projectId, { query: drafted?.brief.photoQuery ?? "", limit: 2, oneOfEach: true });
  const subject = found.references.find((item) => found.subjectIds?.includes(item.id));
  // A case study's cover must show the project itself: a merely related picture will not do.
  const candidates =
    labels.type === "case_study"
      ? [subject]
      : [subject ?? found.references.find((item) => item.origin === "article_source"), found.references.find((item) => item.origin === "open_license")];
  const tried: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    tried.push(candidate.sourceUrl ?? candidate.name);
    try {
      const { image } = await coverFromReferenceCore(projectId, candidate.id);
      return { image: await coverView(image.id), log: { route: "find", tried, judged: 0, rejected: 0 } };
    } catch {
      // Too small or unreadable: try the next.
    }
  }
  return {
    image: null,
    note: `${found.note ?? "No picture good enough for the cover was found."}${
      labels.type === "case_study" ? " A case study's cover must be the project itself: upload it." : ""
    }`,
    log: { route: "find", tried, judged: 0, rejected: 0 },
  };
}

export async function generateCoverCore(projectId: string): Promise<BlockFillResult> {
  const loaded = await loadProject(projectId);
  const labels = loaded?.project.inputs.labels;
  if (!loaded || !labels) throw new Error("This article has no labels.");
  if (!coverRoutesFor(labels).includes("generate")) throw new Error("A case study never uses a generated cover.");
  const options = await imageGenerationOptions();
  const option = options.find((entry) => !entry.capabilities.referenceImagesRequired);
  if (!option) throw new Error("No image generator is configured (add a Fal.ai key in Settings).");
  const drafted = await generateImagePromptCore(projectId, { variationCount: 1 });
  const wanted = IMAGE_ASPECT_RATIOS.find((ratio) => ratio === loaded.project.inputs.imageAspectRatio);
  const aspectRatio: ImageAspectRatio =
    wanted && option.capabilities.aspectRatios.includes(wanted) ? wanted : "16:9";
  const run = await generateImagesCore(projectId, {
    prompt: drafted.prompt,
    optionId: option.optionId,
    aspectRatio,
    variationCount: 1,
    referenceIds: [],
    variantPrompts: drafted.variants.map((variant) => variant.prompt),
  });
  const first = run.images[0];
  if (!first) throw new Error(run.failureReason ?? "No cover was generated.");
  await setCover(projectId, first.id);
  return { image: await coverView(first.id), log: { route: "generate", tried: [option.label], judged: 0, rejected: 0 } };
}

export async function uploadCoverCore(projectId: string, file: { data: Buffer; name: string }): Promise<BlockFillResult> {
  await labelsOf(projectId);
  const stored = await saveGeneratedImage({ data: file.data, mimeType: "image/png", ext: "png" });
  const db = await getDb();
  const [row] = await db
    .insert(images)
    .values({
      projectId,
      provider: "upload",
      model: "upload",
      prompt: `Uploaded: ${file.name}`.slice(0, 300),
      aspectRatio: ratioOf(stored.width, stored.height),
      width: stored.width,
      height: stored.height,
      storagePath: stored.storagePath,
      route: "cover-upload",
      rights: "own",
    })
    .returning();
  await setCover(projectId, row.id);
  return { image: blockImageView(row), log: { route: "upload", tried: [], judged: 0, rejected: 0 } };
}
