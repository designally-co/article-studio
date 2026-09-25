import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { projects } from "@/db/schema";
import { coverImage, loadProject } from "@/lib/projects";
import {
  isHubConfigured,
  publishArticleToHub,
  uploadImageToHub,
  uploadImageToHubByUrl,
} from "@/lib/hub";
import { publishMetadata } from "@/lib/publish-meta";
import { fetchableImageUrls, resolveImage } from "@/lib/image/storage";
import { sweepPublishedReferences } from "@/lib/image/sweep-references";
import { stripTitleHeading } from "@/lib/markdown";
import { splitSourcesSection } from "@/lib/outline";
import { deDash } from "@/lib/text";
import { getModels, runText } from "@/lib/anthropic";
import type { PublishToHubResult } from "./views";

export type { PublishToHubResult } from "./views";

/**
 * Generate a one-sentence dek (subtitle) for an article. Best-effort — returns
 * undefined on any failure so it never blocks the caller.
 */
export async function generateDek(
  projectId: string,
  title: string,
  bodyMarkdown: string,
): Promise<string | undefined> {
  try {
    const { drafting } = await getModels();
    const { text } = await runText({
      model: drafting,
      task:
        "Write a single-sentence dek (subtitle) for this article: under 25 words, plain, " +
        "no surrounding quotes, framing what the reader gains. Never use em dashes or en dashes " +
        "as punctuation; use a comma or colon instead. Return ONLY the sentence.\n\n" +
        `Title: ${title}\n\n${bodyMarkdown.slice(0, 4000)}`,
      maxTokens: 120,
      projectId,
      stage: "publish-dek",
    });
    /* CLEANED, like the article. This is its own call, outside the system
       prompt that carries the no-dash rule, and nothing cleaned what it wrote —
       so the one sentence set in large type under the headline was the one
       place an em dash still reached the Hub, and from there its Thai. */
    return deDash(text.trim().replace(/^["']+|["']+$/g, "")) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Return the article's dek, generating and caching it on `inputs.publishDek` the
 * first time. Called when the Publish stage opens so the Hub preview shows the
 * real subtitle, and reused verbatim at publish time. Returns undefined when the
 * article can't be dek'd yet (no title/body) or generation fails.
 */

/**
 * The extension a stored image was written with — `webp` for anything
 * generated since covers started being re-encoded, `png`/`jpg` for the ones
 * stored before that. Falls back to `jpg` only if a path carries no extension
 * at all, which no path this function is given ever has.
 */
function extensionOf(storagePath: string): string {
  const match = /\.([a-z0-9]{3,4})$/i.exec(storagePath);
  return match ? match[1].toLowerCase() : "jpg";
}

/**
 * Publishing, with no session check.
 *
 * Out of the stage's `"use server"` module because every exported async
 * function in one is a callable endpoint, and this one posts to a live site.
 * The action imports it behind `requireUser()`; the autopilot runner imports it
 * behind its own shared-secret check.
 */

export async function publishToHubCore(
  projectId: string,
  status: "draft" | "published" = "draft",
): Promise<PublishToHubResult> {
  if (!isHubConfigured()) {
    throw new Error(
      "Knowledge Hub isn't configured. Set HUB_BASE_URL and HUB_API_KEY in the environment.",
    );
  }

  const loaded = await loadProject(projectId);
  if (!loaded) throw new Error("Project not found.");

  const title = loaded.project.selectedTopic?.title?.trim();
  const draftMarkdown = (loaded.drafts.find((d) => d.isSelected) ?? loaded.drafts[0])?.contentMd?.trim();
  const { tags } = publishMetadata(loaded.category?.name);

  if (!title) throw new Error("This article has no title yet.");
  if (!draftMarkdown) throw new Error("There's no article draft to publish.");
  if (tags.length === 0) {
    throw new Error("Set a content direction first — the Hub needs at least one tag.");
  }

  // The generator writes the title as a leading H1; the Hub renders the title
  // separately, so strip it to avoid the title showing twice.
  const bodyMarkdown = stripTitleHeading(draftMarkdown, title);

  // Reuse the dek cached when the Publish stage opened; generate on the fly only
  // if it's somehow missing. Optional — never block publishing on it.
  // Cleaned here too: a dek cached before the fix still carries its dash.
  const cachedDek = loaded.project.inputs.publishDek?.trim();
  const summary = cachedDek ? deDash(cachedDek) : await generateDek(projectId, title, bodyMarkdown);

  // Put the cover in the Hub's media library. Optional: a failed or absent
  // image never blocks publishing — it comes back as a warning instead.
  let coverMediaId: number | undefined;
  let coverWarning: string | undefined;
  /* The one the editor chose — NOT `images[0]`, which is merely the newest.
     Picking the second variation and watching the Hub publish the third is
     what that mistake looked like from the outside. The autopilot has no
     editor and no choice recorded, so it falls through to the same default. */
  const chosen = coverImage(loaded);

  if (!chosen?.storagePath) {
    coverWarning = "No generated image on this project, so it was published without a cover.";
  } else {
    try {
      /* THE BYTES DO NOT TRAVEL IF THEY DO NOT HAVE TO. Vercel refuses a
         request body over 4.5MB at the edge — a 413 before the Hub's route or
         auth runs, with no error body to report — and generated covers now
         exceed it, which is why ten days of articles published with no image.
         A URL is a few hundred bytes, and the Hub fetches the file itself, so
         size stops being a factor.

         The cover is sent as its public R2 URL, which the Hub will only fetch
         if the R2 domain is listed in its MEDIA_FETCH_HOSTS — otherwise its
         refusal comes back as the cover warning, naming the variable. `local:`
         paths have no URL and fall through to the upload below, which is fine:
         that is the self-hosted case, where the 4.5MB ceiling does not exist
         either. */
      const fetchable = (await fetchableImageUrls([chosen.storagePath])).get(chosen.storagePath);

      if (fetchable) {
        /* FROM THE STORED PATH, NOT THE URL. This read the extension out of a
           signed URL — which ends in a JWT, whose segments are separated by
           dots and can begin with any base64url characters. A token segment
           starting "png" would have made `.png` appear in a URL pointing at a
           WebP, and the Hub would have been handed a filename that disagreed
           with the bytes. The path is what was written. */
        const ext = extensionOf(chosen.storagePath);
        coverMediaId = await uploadImageToHubByUrl({
          url: fetchable,
          filename: `${projectId}-cover.${ext}`,
          alt: title,
        });
      } else {
        const resolved = await resolveImage(chosen.storagePath);
        if (!resolved) {
          /* The single most useful thing this function can say. `resolveImage`
             returns null when the bytes cannot be read — a `local:` file that
             is not on this machine, or a path with no file behind it. */
          coverWarning =
            `The cover image could not be read (${chosen.storagePath.slice(0, 60)}), ` +
            "so the article was published without it.";
        } else {
          const ext = resolved.mimeType.includes("png")
            ? "png"
            : resolved.mimeType.includes("webp")
              ? "webp"
              : "jpg";
          coverMediaId = await uploadImageToHub({
            data: resolved.data,
            filename: `${projectId}-cover.${ext}`,
            mimeType: resolved.mimeType,
            alt: title,
          });
        }
      }
    } catch (cause) {
      /* Still never fatal — but now it says what happened. The Hub's own
         message comes through here when it is the one refusing. */
      coverWarning =
        `The cover image failed to upload to the Hub, so the article was published without it. ` +
        (cause instanceof Error ? cause.message : String(cause)).slice(0, 200);
      coverMediaId = undefined;
    }
  }

  /* The Hub has a structured reference field and draws the list itself, so the
     article's own "## Sources" block is lifted out of the markdown and sent as
     data. Left in the body it would arrive as Lexical paragraphs — the same
     links, but unlistable and duplicated under a heading the Hub renders
     again. Inline links inside the prose are untouched. */
  const { body: bodyWithoutSources, references } = splitSourcesSection(bodyMarkdown);

  /* A PHOTOGRAPH IS CREDITED WHERE THE ARTICLE CREDITS EVERYTHING ELSE. When the
     cover is someone's picture rather than a generated one, the line the editor
     approved goes at the end of References. Only if the cover actually went up:
     a credit under an article with no image is a credit for nothing. The Hub
     needs a link on every reference, so a credit with none is left out and
     said so. */
  const credit = chosen ? loaded.project.inputs.coverCredits?.[chosen.id] : undefined;
  if (credit && coverMediaId !== undefined) {
    const label = credit.label.trim();
    if (label && credit.url && !references.some((reference) => reference.url === credit.url && reference.label === label)) {
      references.push({ label, url: credit.url });
    } else if (!credit.url) {
      coverWarning =
        "The cover's credit has no link, and the Hub needs one for every reference, so it was left out. Add the link on the image stage and publish again.";
    }
  }

  const result = await publishArticleToHub({
    title,
    tags,
    summary,
    bodyMarkdown: bodyWithoutSources,
    status,
    coverImage: coverMediaId,
    ...(references.length ? { references } : {}),
  });

  // Record where it went, merging with any existing published targets. A live
  // publish flips the project to "published"; saving a Hub draft leaves it a
  // Draft (it isn't public yet). Cache the dek if we just generated it.
  const db = await getDb();
  const existing = (loaded.project.publishedTo ?? {}) as Record<string, string>;
  await db
    .update(projects)
    .set({
      // The CMS address too: a Hub draft has no public page to link to.
      publishedTo: { ...existing, knowledgeHub: result.absoluteUrl, knowledgeHubAdmin: result.adminUrl },
      ...(status === "published" ? { status: "published" as const } : {}),
      inputs: { ...loaded.project.inputs, publishDek: summary ?? loaded.project.inputs.publishDek },
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  /* THE REFERENCES HAVE DONE THEIR JOB. Only on a live publish: a Hub draft is
     still being worked on, and its cover may yet be regenerated from these
     photographs. Deliberately after the project row is updated and deliberately
     unawaited-for-failure inside — the article is already on the Hub by now, and
     no amount of storage trouble should turn that into a failed publish. */
  if (status === "published") await sweepPublishedReferences(projectId);

  /*
   * NO revalidatePath HERE.
   *
   * It re-rendered both routes INSIDE this action's response, on top of a call
   * that has already published to the Hub and waited on a Thai translation. A
   * failure in that render corrupts the action's reply, and the caller sees
   * "An unexpected response was received from the server" — after the article
   * has in fact been published and saved. Exactly the symptom the draft step
   * had, one stage later: the work succeeds and the UI reports a failure.
   *
   * The try/catch around this function cannot help, because the render happens
   * after the body returns. So the caller refreshes instead, in its own
   * request with its own budget.
   */
  return {
    url: result.absoluteUrl,
    adminUrl: result.adminUrl,
    slug: result.slug,
    status: result.status,
    ...(coverWarning ? { coverWarning } : {}),
  };
}
