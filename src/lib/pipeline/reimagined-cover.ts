import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { imageReferences } from "@/db/schema";
import { getModels, runJson, type PromptImage } from "@/lib/anthropic";
import { containsThai } from "@/lib/ai/schemas";
import { loadProject } from "@/lib/projects";
import { loadStoredImage } from "@/lib/image/storage";
import { loadSharp } from "@/lib/image/sharp";
import { IMAGE_SYSTEM_PROMPT } from "@/prompts/system";
import { reimagineCoverTask } from "@/prompts/tasks";

/**
 * A cover of our own, made from a cited page's picture instead of running that
 * picture as it is. EXPERIMENT (branch `claude/reimagined-cover`).
 *
 * WHY. The page's picture is the right subject, but it is the studio's: it has
 * to be credited, and two articles citing one page ran the same picture side
 * by side. Here an editing model is handed the picture as a guide and told to
 * keep only what kind of picture it is — new colours, every brand name, logo,
 * piece of text and face replaced, the details changed. What comes back is a
 * generated image like any other: it is chosen, published and (not) credited
 * the way generated covers already are.
 *
 * NOT A RECOLOURED COPY. The brief asks for a different picture of the same
 * kind of thing. The same picture in new colours would still be the studio's
 * picture, credit or no credit.
 *
 * This only WRITES the prompt. Generating is `generateImagesCore`, with the
 * reference attached — the editor presses Generate, or the routine's image step
 * runs it.
 */

export type ReimaginedPrompt = {
  prompt: string;
  /** What the picture showed, in a sentence. */
  seen: string;
  /** The brand names, logos, text and faces the prompt replaces. */
  ownedElements: string[];
  palette: string;
};

/** The side the picture is shrunk to before Claude sees it. */
const PREVIEW_EDGE = 1024;

async function previewOf(data: Buffer, mimeType: string): Promise<PromptImage> {
  try {
    const sharp = await loadSharp();
    const jpeg = await sharp(data)
      .rotate()
      .resize({ width: PREVIEW_EDGE, height: PREVIEW_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return { base64: jpeg.toString("base64"), mediaType: "image/jpeg" };
  } catch {
    return { base64: data.toString("base64"), mediaType: mimeType };
  }
}

/**
 * What the image model is sent after Claude's paragraph. Short, and last,
 * because last is what an image model reads: the things it must not carry
 * over, named.
 */
function finishReimaginePrompt(written: string, owned: string[], palette: string): string {
  const remove = owned.length > 0 ? ` Replace or remove: ${owned.join("; ")}.` : "";
  return `${written.trim()}\n\nUse the attached image only as a guide to the kind of picture. Make a new image, not a copy: a different arrangement and different details, in this palette: ${palette}.${remove} No text, letters, numbers, logos or brand marks anywhere.`;
}

export async function writeReimaginePromptCore(
  projectId: string,
  referenceId: string,
): Promise<ReimaginedPrompt> {
  const loaded = await loadProject(projectId);
  if (!loaded) throw new Error("Project not found.");
  const db = await getDb();
  const [reference] = await db
    .select()
    .from(imageReferences)
    .where(eq(imageReferences.id, referenceId))
    .limit(1);
  if (!reference || reference.projectId !== projectId) throw new Error("That reference is no longer on this article.");
  if (reference.sweptAt) throw new Error("That picture's file was cleared after publishing. Find it again to use it.");
  const stored = await loadStoredImage(reference.storagePath);
  if (!stored) throw new Error("That picture could not be read. Find it again, or upload it.");

  const draft = loaded.drafts.find((d) => d.isSelected) ?? loaded.drafts[0];
  const title =
    draft?.contentMd.match(/^#\s+(.+)$/m)?.[1]?.trim() || loaded.project.selectedTopic?.title?.trim() || "Untitled";

  const { drafting } = await getModels();
  const { data } = await runJson<Omit<ReimaginedPrompt, "prompt"> & { prompt: string }>({
    model: drafting,
    system: IMAGE_SYSTEM_PROMPT,
    task: reimagineCoverTask({ title, angle: loaded.project.selectedTopic?.angle }),
    images: [await previewOf(stored.data, stored.mimeType)],
    schema: {
      type: "object",
      properties: {
        seen: { type: "string" },
        ownedElements: { type: "array", items: { type: "string" } },
        palette: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["seen", "ownedElements", "palette", "prompt"],
      additionalProperties: false,
    },
    maxTokens: 1200,
    projectId,
    stage: "image_reimagine",
  });

  const written = data.prompt?.trim();
  if (!written) throw new Error("No prompt was written for that picture.");
  // The Fal models are English-trained; see `generateImagePromptCore`.
  if (containsThai(written)) throw new Error("The prompt came back in Thai. Try again.");
  const ownedElements = (data.ownedElements ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 12);
  const palette = data.palette?.trim() || "colours of its own";
  return {
    prompt: finishReimaginePrompt(written, ownedElements, palette),
    seen: data.seen?.trim() ?? "",
    ownedElements,
    palette,
  };
}
