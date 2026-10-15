"use server";

import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  clearBlockImagesCore,
  drawBlockImageCore,
  findBlockImageCore,
  generateBlockImageCore,
  setBlockImageRightsCore,
  uploadBlockImageCore,
} from "@/lib/pipeline/image-blocks";
import type { BlockFillResult, BlockImageView } from "@/lib/pipeline/views";

/*
 * PREVIEW ONLY: the buttons on an in-body image block (proposed article
 * direction). The work is in @/lib/pipeline/image-blocks and the shapes in
 * @/lib/pipeline/views; nothing is re-exported from this file (see AGENTS.md).
 *
 * Each action answers `{ ok, … }` rather than throwing: a thrown error's
 * message is redacted in production, and "the block found nothing" is an
 * answer the editor needs to read, not a crash.
 */

type Answer<T> = { ok: true; value: T } | { ok: false; message: string };

async function answer<T>(work: () => Promise<T>): Promise<Answer<T>> {
  try {
    await requireUser();
    return { ok: true, value: await work() };
  } catch (reason) {
    unstable_rethrow(reason);
    return { ok: false, message: reason instanceof Error ? reason.message : "That did not work. Try again." };
  }
}

export async function fillBlockAction(
  projectId: string,
  blockId: string,
  route: "find" | "generate" | "draw",
): Promise<Answer<BlockFillResult>> {
  return answer(() =>
    route === "find"
      ? findBlockImageCore(projectId, blockId)
      : route === "generate"
        ? generateBlockImageCore(projectId, blockId)
        : drawBlockImageCore(projectId, blockId),
  );
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function uploadBlockImageAction(
  projectId: string,
  blockId: string,
  formData: FormData,
): Promise<Answer<BlockFillResult>> {
  return answer(async () => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image to upload.");
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("Images must be 8 MB or smaller.");
    if (!UPLOAD_TYPES.has(file.type)) throw new Error("Use a PNG, JPEG, or WebP image.");
    return uploadBlockImageCore(
      projectId,
      blockId,
      { data: Buffer.from(await file.arrayBuffer()), name: file.name },
      {
        rights: String(formData.get("rights") ?? "unknown"),
        credit: String(formData.get("credit") ?? ""),
        sourceUrl: String(formData.get("sourceUrl") ?? ""),
      },
    );
  });
}

export async function setBlockImageRightsAction(
  projectId: string,
  imageId: string,
  rights: string,
  credit?: string,
): Promise<Answer<BlockImageView>> {
  return answer(() => setBlockImageRightsCore(projectId, imageId, { rights, credit }));
}

/** The picture goes; the editor removes the block from the draft in the same click. */
export async function clearBlockAction(projectId: string, blockId: string): Promise<Answer<true>> {
  return answer(async () => {
    await clearBlockImagesCore(projectId, blockId);
    return true as const;
  });
}
