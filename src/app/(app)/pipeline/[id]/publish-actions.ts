"use server";

import { eq } from "drizzle-orm";
import { deDash } from "@/lib/text";
import { getDb } from "@/db";
import { projects } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { loadProject } from "@/lib/projects";
import { stripTitleHeading } from "@/lib/markdown";
import { generateDek, publishToHubCore } from "@/lib/pipeline/publish";
import type { PublishToHubResult } from "@/lib/pipeline/views";

/* A type re-export creates no endpoint — only exported async FUNCTIONS in a
   "use server" module become callable. */

export type PublishToHubOutcome =
  | ({ ok: true } & PublishToHubResult)
  | { ok: false; message: string };

export async function ensurePublishDekAction(projectId: string): Promise<string | undefined> {
  await requireUser();

  const loaded = await loadProject(projectId);
  if (!loaded) return undefined;

  // A dek cached before dashes were cleaned from it is cleaned on the way out.
  const cached = loaded.project.inputs.publishDek?.trim();
  if (cached) return deDash(cached);

  const title = loaded.project.selectedTopic?.title?.trim();
  const draftMarkdown = (loaded.drafts.find((d) => d.isSelected) ?? loaded.drafts[0])?.contentMd?.trim();
  if (!title || !draftMarkdown) return undefined;

  const dek = await generateDek(projectId, title, stripTitleHeading(draftMarkdown, title));
  if (!dek) return undefined;

  const db = await getDb();
  await db
    .update(projects)
    .set({ inputs: { ...loaded.project.inputs, publishDek: dek }, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
  return dek;
}

/**
 * Publish the finalized article to the Designally Knowledge Hub — live
 * (`published`) or as a `draft` to review in the Hub admin (where its Thai
 * translation can be checked before going live). Derives tags from the content
 * direction, auto-generates a one-sentence dek, posts the Markdown body, and
 * records the Hub URL on the project.
 */
/**
 * Returns its failure instead of throwing it.
 *
 * `publishArticleToHub` throws with the Hub's own message — "slug must be
 * unique", "Create failed", whatever actually went wrong — and a thrown Server
 * Action error is redacted in production, so all of that arrived as "An
 * unexpected response was received from the server". A returned string is data
 * and reaches the screen intact.
 */
export async function publishToHubAction(
  projectId: string,
  status: "draft" | "published" = "draft",
): Promise<PublishToHubOutcome> {
  try {
    await requireUser();
    const r = await publishToHubCore(projectId, status);
    return { ok: true, ...r };
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Publishing to the Hub failed.",
    };
  }
}
