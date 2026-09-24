import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { imageReferences, images, projects } from "@/db/schema";
import { loadProject } from "@/lib/projects";
import { getImageProvider } from "@/lib/image/registry";
import { loadStoredImage, saveGeneratedImage, saveImage } from "@/lib/image/storage";
import { loadSharp } from "@/lib/image/sharp";
import type { ImageAspectRatio, ReferenceImageInput } from "@/lib/image/providers";
import { IMAGE_ASPECT_RATIOS } from "@/lib/image/providers";
import { findRelatedReferences, type RelatedReferenceSearch } from "@/lib/image/reference-search";
import { MAX_FOUND_REFERENCES } from "@/lib/image/reference-policy";
import { citedPages, findArticleSourceImages } from "@/lib/image/article-sources";
import type {
  GeneratedImageView,
  GenerationRunResult,
  UploadedReferenceView,
} from "./views";

export type { GeneratedImageView, GenerationRunResult, UploadedReferenceView };

/**
 * Finding reference photographs and generating images, with no session check.
 *
 * Out of the stage's `"use server"` module because every exported async
 * function in one is a callable endpoint, and these two spend money — a search
 * against Unsplash and a generation against Fal. The stage's actions import
 * them behind `requireUser()`; the autopilot runner imports them behind its own
 * shared-secret check.
 */




export const referenceView = (row: typeof imageReferences.$inferSelect): UploadedReferenceView => ({
  id: row.id,
  url: `/api/image-references/${row.id}`,
  name: row.originalName,
  width: row.width,
  height: row.height,
  origin: row.origin,
  sourceUrl: row.sourceUrl,
  sourceName: row.sourceName,
  license: row.license,
});

/** Re-exported so existing importers keep their path; see `@/lib/image/sharp`. */
export { loadSharp };

/**
 * Find photographs related to this article — the kind of picture its image
 * should be matched against.
 *
 * Nothing is generated here and nothing is published. This attaches material
 * the editor can look at, remove, and then generate from — which is the point:
 * a cover drawn from words alone reads as synthetic because the model was never
 * shown a real surface or a real moment.
 *
 * WHAT TO LOOK FOR is worked out from the article itself: a ladder of searches
 * from the work being done down to the subject on its own, and a look at every
 * result before it is kept — see `findRelatedReferences`. The brief's
 * `photoQuery`, when one has been drafted, goes along as a hint. The headline
 * is never searched as it stands: it is a sentence about the topic, and a photo
 * library answered it with nothing.
 */
export async function findReferenceImagesCore(
  projectId: string,
  options?: {
    query?: string;
    /** At most this many new photographs. The autopilot asks for one. */
    limit?: number;
  }
): Promise<{ references: UploadedReferenceView[]; note?: string }> {
  const loaded = await loadProject(projectId);
  if (!loaded) throw new Error("Project not found.");

  const db = await getDb();
  /* WITHOUT THE SWEPT ONES. A published article's references keep their rows
     but lose their files (see `sweepPublishedReferences`), and the page already
     leaves them out. Counted here they filled the four places with pictures that
     no longer exist: the search came back with four broken thumbnails and "remove
     one to look for more", on an article whose editor could see none. */
  const existing = await db
    .select()
    .from(imageReferences)
    .where(and(eq(imageReferences.projectId, projectId), isNull(imageReferences.sweptAt)));
  const space = MAX_FOUND_REFERENCES - existing.length;
  if (space <= 0) {
    return {
      references: existing.map(referenceView),
      note: `This article already has ${existing.length} references. Remove one to look for more.`,
    };
  }
  const room = Math.min(space, Math.max(0, Math.floor(options?.limit ?? space)));

  const draft = loaded.drafts.find((d) => d.isSelected) ?? loaded.drafts[0];
  const article = draft?.contentMd.trim() ?? "";
  const title =
    article.match(/^#\s+(.+)$/m)?.[1]?.trim() || loaded.project.selectedTopic?.title?.trim() || "";
  if (!title || room <= 0) {
    return {
      references: existing.map(referenceView),
      note: title ? undefined : "This article has no title yet, so there is nothing to look for.",
    };
  }

  /* RECORDED BEFORE THE SEARCH, so a search that fails or runs out of time still
     counts as the one automatic attempt — otherwise every visit to the stage
     would try again. A JSON merge rather than a rewrite of `inputs`: this runs
     for twenty seconds, and the editor may choose a cover in the meantime. */
  await db
    .update(projects)
    .set({
      inputs: sql`coalesce(${projects.inputs}, '{}'::jsonb) || ${JSON.stringify({
        referencesSearchedAt: new Date().toISOString(),
      })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  /* TWO PLACES AT ONCE. The pages the article cites come first: their lead
     image is usually the work itself, photographed by the studio that made it,
     which is what a good design publication runs. The photo libraries fill
     what is left. Side by side because both live inside the same sixty
     seconds; a page already attached as a reference is not fetched again. */
  const [fromSources, search] = await Promise.all([
    findArticleSourceImages(article, {
      limit: room,
      exclude: new Set(existing.map((row) => row.sourceUrl).filter((url): url is string => !!url)),
    }).catch(() => []),
    findRelatedReferences({
      projectId,
      title,
      angle: loaded.project.selectedTopic?.angle,
      // The opening says what the article is about; the whole of it is not needed
      // to plan a photo search, and every token is inside the same sixty seconds.
      article: article.slice(0, 3000),
      seedQuery: options?.query,
      limit: room,
    }),
  ]);
  const candidates = [...fromSources, ...search.candidates].slice(0, room);

  const saved: UploadedReferenceView[] = [];
  for (const candidate of candidates) {
    // Normalised the same way an upload is, and for the same reason: the
    // providers get one predictable, metadata-free format. If sharp cannot
    // load, the original bytes are still a valid image.
    let data = candidate.data;
    let mimeType = candidate.mimeType;
    let ext = candidate.ext;
    try {
      const sharp = await loadSharp();
      data = await sharp(candidate.data).rotate().png().toBuffer();
      mimeType = "image/png";
      ext = "png";
    } catch {
      // sharp is unavailable on this runtime.
    }
    const { storagePath } = await saveImage({ data, mimeType, ext });
    const [row] = await db
      .insert(imageReferences)
      .values({
        projectId,
        storagePath,
        mimeType,
        originalName: candidate.originalName,
        width: candidate.width,
        height: candidate.height,
        origin: candidate.origin,
        sourceUrl: candidate.sourceUrl,
        sourceName: candidate.sourceName,
        license: candidate.license,
        attribution: candidate.attribution,
      })
      .returning();
    saved.push(referenceView(row));
  }

  return {
    references: [...existing.map(referenceView), ...saved],
    note:
      saved.length > 0
        ? undefined
        : // Said first when it applies: the cited pages are where the best
          // picture would have come from, and an editor can fix that by citing
          // the project's own page rather than a site's front door.
          `${citedPages(article).length > 0 ? "None of the pages this article cites had a picture to offer. " : ""}${searchNote(search)}`,
  };
}

/** Why nothing was attached, in terms the editor can act on. */
function searchNote(search: RelatedReferenceSearch): string {
  if (!search.planned) return "Could not work out what to look for. Try again, or upload a photograph.";
  if (search.found === 0) {
    return process.env.UNSPLASH_ACCESS_KEY
      ? `Nothing came back for ${search.queries.map((query) => `"${query}"`).join(", ")}. Try again, or upload a photograph.`
      : "UNSPLASH_ACCESS_KEY is not set, so only Openverse was searched — it rarely has a photograph of the work itself.";
  }
  if (search.judged && search.rejected > 0) {
    return `None of the ${search.found} photographs found were close enough to this article. Try again, or upload a photograph.`;
  }
  return "The photographs found could not be checked. Try again, or upload a photograph.";
}

export async function generateImagesCore(
  projectId: string,
  request: {
    prompt: string;
    optionId: string;
    aspectRatio: ImageAspectRatio;
    variationCount: number;
    referenceIds: string[];
    /**
     * One prompt per variation, each carrying a different concept, from
     * `generateImagePromptAction`. Variation `i` uses `variantPrompts[i]`, or
     * `prompt` where there is no entry for it — which is what happens when the
     * editor has written or edited the prompt themselves, and their words
     * should govern every image rather than be silently replaced.
     */
    variantPrompts?: string[];
  }
): Promise<GenerationRunResult> {
  if (!request || typeof request !== "object") throw new Error("Invalid generation request.");
  const prompt = typeof request.prompt === "string" ? request.prompt.trim() : "";
  if (!prompt) throw new Error("Enter an image prompt.");
  if (prompt.length > 8000) throw new Error("Image prompts must be 8,000 characters or shorter.");
  const variantPrompts = Array.isArray(request.variantPrompts)
    ? request.variantPrompts.map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    : [];
  if (variantPrompts.some((entry) => entry.length > 8000)) {
    throw new Error("Image prompts must be 8,000 characters or shorter.");
  }
  if (typeof request.optionId !== "string" || request.optionId.length > 240) {
    throw new Error("Invalid image model selection.");
  }
  if (!IMAGE_ASPECT_RATIOS.includes(request.aspectRatio)) throw new Error("Invalid aspect ratio.");
  const [providerId, keyId] = request.optionId.split("::");
  const provider = getImageProvider(providerId);
  if (!provider) throw new Error("Unknown image provider.");
  if (!provider.capabilities.aspectRatios.includes(request.aspectRatio)) {
    throw new Error(`${provider.label} does not support the selected aspect ratio.`);
  }
  const requestedReferenceIds = Array.isArray(request.referenceIds)
    ? request.referenceIds.filter((id): id is string => typeof id === "string" && id.length <= 64)
    : [];
  const referenceIds = Array.from(new Set(requestedReferenceIds)).slice(0, provider.capabilities.maxReferenceImages);
  if (referenceIds.length > 0 && !provider.capabilities.referenceImages) {
    throw new Error(`${provider.label} does not support reference images.`);
  }
  if (provider.capabilities.referenceImagesRequired && referenceIds.length === 0) {
    throw new Error(`${provider.label} requires a reference image.`);
  }
  const requestedCount = Number.isFinite(request.variationCount) ? Math.floor(request.variationCount) : 1;
  const variationCount = Math.min(Math.max(requestedCount, 1), provider.capabilities.maxVariations);

  const db = await getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found.");
  const references: ReferenceImageInput[] = [];
  for (const id of referenceIds) {
    const [row] = await db
      .select()
      .from(imageReferences)
      .where(eq(imageReferences.id, id))
      .limit(1);
    if (!row || row.projectId !== projectId) throw new Error("A reference image is unavailable.");
    const stored = await loadStoredImage(row.storagePath);
    if (!stored) throw new Error("A reference image could not be loaded.");
    references.push({ id: row.id, ...stored });
  }

  const promptFor = (index: number) => variantPrompts[index] || prompt;

  const generations = await Promise.allSettled(
    Array.from({ length: variationCount }, (_, index) =>
      provider.generate(
        { prompt: promptFor(index), aspectRatio: request.aspectRatio, referenceImages: references },
        keyId || undefined
      )
    )
  );
  const generated = generations.flatMap((result, index) =>
    result.status === "fulfilled"
      ? result.value.images.map((image) => ({ image, variationNo: index + 1, prompt: promptFor(index) }))
      : []
  );
  const rejection = generations.find((result) => result.status === "rejected");
  // Nothing at all is a failure and throws, as it always did. Some of what was
  // asked for is a result, and travels back with an account of the rest.
  if (generated.length === 0) {
    throw rejection && rejection.status === "rejected"
      ? rejection.reason
      : new Error("No images were returned.");
  }
  const failedCount = generations.filter((result) => result.status === "rejected").length;
  const failureReason =
    rejection && rejection.status === "rejected"
      ? rejection.reason instanceof Error
        ? rejection.reason.message
        : String(rejection.reason)
      : undefined;

  await db
    .update(projects)
    .set({
      inputs: {
        ...project.inputs,
        imageProvider: providerId,
        imageApiKeyId: keyId || undefined,
        imageCount: variationCount,
        imageAspectRatio: request.aspectRatio,
      },
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  const out: GeneratedImageView[] = [];

  for (const { image: img, variationNo, prompt: usedPrompt } of generated) {
    /* RESIZED AND RE-ENCODED BEFORE IT IS STORED — the original never leaves
       this function. Its dimensions come back from the same call, because they
       are the STORED file's, not the provider's. */
    const { storagePath, width, height } = await saveGeneratedImage(img);
    const [row] = await db
      .insert(images)
      .values({
        projectId,
        provider: provider.provider,
        model: provider.model,
        // The prompt this image came from, not the set's first one — the row is
        // the only record of why a given variation looks the way it does.
        prompt: usedPrompt,
        aspectRatio: request.aspectRatio,
        width,
        height,
        variationNo,
        referenceIds,
        storagePath,
      })
      .returning();
    out.push({
      id: row.id,
      url: `/api/images/${row.id}`,
      provider: provider.provider,
      model: provider.model,
      aspectRatio: request.aspectRatio,
      variationNo,
    });
  }

  return { images: out, failedCount, failureReason };
}
