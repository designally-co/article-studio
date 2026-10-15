import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { drafts, refinements } from "@/db/schema";
import { loadProject, pipelineContext } from "@/lib/projects";
import { getModels, buildSystemLayers, streamText, isAnthropicConfigured } from "@/lib/anthropic";
import { draftTask } from "@/prompts/tasks";
import { extractOutlineSources } from "@/lib/outline";
import { deDash } from "@/lib/text";
import { directionDraftTask } from "@/prompts/direction";
import { normalizeImageBlocks } from "@/lib/direction/image-blocks";

/**
 * Writing the article, with no session check.
 *
 * The route still streams — that is its whole job, and an editor watching a
 * blank panel for fifty seconds is a worse product than one watching sentences
 * arrive. But the work either side of the stream (appending sources, stripping
 * em dashes, snapshotting the previous version, saving the row) is not about
 * streaming at all, and the autopilot runner needs every bit of it.
 *
 * So it lives here, and `onDelta` is optional: the route passes one and gets a
 * stream, the runner passes nothing and gets the finished text. Not in the
 * route's own module because a route handler cannot be imported as a function,
 * and not in a `"use server"` file because every exported async function in one
 * of those is a callable endpoint.
 */
export type DraftResult = { draftId: string; content: string };

export async function generateDraftCore(
  projectId: string,
  onDelta?: (delta: string) => void
): Promise<DraftResult> {
  // A single draft per project — the old 1-of-3 variation flow is gone.
  const variation = 1;

  const loaded = await loadProject(projectId);
  if (!loaded) throw new Error("Project not found");
  if (!(await isAnthropicConfigured())) {
    throw new Error("The Anthropic API key is not configured");
  }
  const outline = loaded.project.outline?.markdown;
  if (!outline) throw new Error("No approved outline");

  const ctx = pipelineContext(loaded);
  const { drafting } = await getModels();
  const longForm = loaded.articleRules.longForm;
  const bothLang = ctx.language === "both";
  const maxTokens = longForm ? (bothLang ? 12000 : 8000) : bothLang ? 4000 : 3000;

  const { text } = await streamText({
    model: drafting,
    system: buildSystemLayers(ctx),
    // A labelled article (preview of the proposed direction) has its own task:
    // the current one forbids nothing the proposal needs, but it says nothing
    // of its shape or its image blocks either.
    task: ctx.inputs.labels
      ? directionDraftTask({ outlineMarkdown: outline, labels: ctx.inputs.labels })
      : draftTask({ outlineMarkdown: outline, longForm }),
    maxTokens,
    onDelta: (d) => onDelta?.(d),
    projectId,
    stage: "draft",
  });

  /* Append a Sources section from the outline's research, so a draft always
     cites where it was written from rather than relying on the writer to add
     one. EVERY draft, not only long-form ones: the drafting prompt tells every
     draft "do not add your own references, a sources list is appended
     automatically", so a gate here left short-form articles told to leave
     sources out and then never given any.

     The two guards still decide whether anything is added: no researched
     sources means nothing to append, and a draft that wrote its own Sources
     heading anyway is left alone. */
  let finalText = text;
  const sources = extractOutlineSources(outline);
  const alreadyHasSection = /(^|\n)#{1,6}\s*(sources|references)\b/i.test(text);
  if (sources.length && !alreadyHasSection) {
    const block = "\n\n## Sources\n\n" + sources.map((s) => `- [${s.name}](${s.url})`).join("\n");
    onDelta?.(block);
    /* The proposed shape ends Key takeaway → Sources → optional Free resource,
       so in a labelled article the list goes in front of a Free resource
       section rather than after it. */
    const freeResource = ctx.inputs.labels ? /\n#{2}\s*Free resource\b/i.exec(text) : null;
    finalText = freeResource
      ? `${text.slice(0, freeResource.index).trimEnd()}${block}\n${text.slice(freeResource.index)}`
      : text + block;
  }

  /* Hold the image blocks to what the type allows (count, role, route, ids).
     A route the type forbids is refused here, in code, not only in the prompt. */
  if (ctx.inputs.labels) {
    const normalized = normalizeImageBlocks(finalText, ctx.inputs.labels.type);
    finalText = normalized.markdown;
    for (const note of normalized.notes) console.info(`[direction] draft ${projectId}: ${note}`);
  }

  // Strip em dashes from the saved article (belt-and-suspenders with the
  // system-prompt rule) so the persisted copy reads human-written.
  finalText = deDash(finalText);

  // Keep one selected draft. Regeneration snapshots the previous version before
  // replacing its content so history remains restorable.
  const db = await getDb();
  const existing = loaded.drafts.find((draft) => draft.variationNo === variation);
  let row;
  if (existing) {
    if (existing.contentMd.trim()) {
      await db.insert(refinements).values({
        projectId,
        draftId: existing.id,
        userMessage: "Version before regeneration",
        resultMd: existing.contentMd,
      });
    }
    [row] = await db
      .update(drafts)
      .set({ contentMd: finalText, isSelected: true })
      .where(eq(drafts.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(drafts)
      .values({ projectId, variationNo: variation, contentMd: finalText, isSelected: true })
      .returning();
  }

  return { draftId: row.id, content: finalText };
}
