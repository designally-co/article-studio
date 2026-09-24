"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { imageReferences, images, projects } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { loadProject } from "@/lib/projects";
import { deleteStoredImage, saveImage } from "@/lib/image/storage";
import { imageSize } from "@/lib/image/dimensions";
import {
  findReferenceImagesCore,
  generateImagesCore,
  loadSharp,
  referenceView,
} from "@/lib/pipeline/images";
import type { GeneratedImageView, GenerationRunResult, UploadedReferenceView } from "@/lib/pipeline/views";
import { updateCoverCreditCore, coverFromReferenceCore } from "@/lib/pipeline/sourced-cover";
import type { CoverCredit } from "@/db/schema";
import type { ImageAspectRatio } from "@/lib/image/providers";

/* The work lives in @/lib/pipeline/images so the autopilot runner can do it
   too, and the shapes in @/lib/pipeline/views so the stage can import them
   without going through this file. NOTHING IS RE-EXPORTED FROM HERE: a
   `export type { … }` in a "use server" module is emitted as a real runtime
   export and throws "X is not defined" when the module is evaluated. */

const MAX_REFERENCE_BYTES = 2 * 1024 * 1024;
const REFERENCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function uploadImageReferenceAction(
  projectId: string,
  formData: FormData
): Promise<UploadedReferenceView> {
  await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image to upload.");
  if (file.size > MAX_REFERENCE_BYTES) throw new Error("Reference images must be 2 MB or smaller.");
  if (!REFERENCE_MIME_TYPES.has(file.type)) throw new Error("Use a PNG, JPEG, or WebP image.");

  const db = await getDb();
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found.");

  const source = Buffer.from(await file.arrayBuffer());
  const metadata = imageSize(source);
  if (!metadata) throw new Error("The uploaded image could not be read.");

  // Normalizing to PNG gives providers a predictable, metadata-free input and
  // applies the EXIF rotation a phone photo carries. It is the one thing here
  // that genuinely needs sharp, so if sharp cannot load, keep the upload rather
  // than failing it and send the original bytes: a reference image that is
  // sideways is a smaller problem than one that never uploads at all.
  let data = source;
  let mimeType = file.type;
  let ext: "png" | "jpg" = file.type === "image/png" ? "png" : "jpg";
  try {
    const sharp = await loadSharp();
    data = await sharp(source).rotate().png().toBuffer();
    mimeType = "image/png";
    ext = "png";
  } catch {
    // sharp is unavailable on this runtime; the original bytes are still valid.
  }
  const { storagePath } = await saveImage({ data, mimeType, ext });
  const [row] = await db
    .insert(imageReferences)
    .values({
      projectId,
      storagePath,
      mimeType: "image/png",
      originalName: file.name.slice(0, 180) || "reference.png",
      width: metadata.width,
      height: metadata.height,
      origin: "upload",
    })
    .returning();

  return referenceView(row);
}

/** Session-checked wrapper. The work lives in @/lib/pipeline/images. */
export async function findReferenceImagesAction(
  projectId: string,
  options?: { query?: string }
): Promise<{ references: UploadedReferenceView[]; note?: string }> {
  await requireUser();
  const result = await findReferenceImagesCore(projectId, options);
  revalidatePath(`/pipeline/${projectId}`);
  return result;
}

/** Detach a reference from the article and delete its bytes. */
export async function deleteImageReferenceAction(referenceId: string): Promise<void> {
  await requireUser();
  const db = await getDb();
  const [row] = await db
    .select({ id: imageReferences.id, projectId: imageReferences.projectId, storagePath: imageReferences.storagePath })
    .from(imageReferences)
    .where(eq(imageReferences.id, referenceId))
    .limit(1);
  if (!row) return;

  await deleteStoredImage(row.storagePath);
  await db.delete(imageReferences).where(eq(imageReferences.id, referenceId));
  revalidatePath(`/pipeline/${row.projectId}`);
}

/** Session-checked wrapper. The work lives in @/lib/pipeline/images. */
export async function generateImagesAction(
  projectId: string,
  request: {
    prompt: string;
    optionId: string;
    aspectRatio: ImageAspectRatio;
    variationCount: number;
    referenceIds: string[];
    variantPrompts?: string[];
  }
): Promise<GenerationRunResult> {
  await requireUser();
  const result = await generateImagesCore(projectId, request);
  revalidatePath(`/pipeline/${projectId}`);
  return result;
}


/**
 * Choose which generated image becomes the article's cover.
 *
 * Only one image travels to the Hub, and the stage used to send whichever was
 * generated most recently — so a third variation silently replaced a first the
 * editor preferred. Stored on the project rather than as a flag per image, so
 * there is exactly one place the answer can live and no way to end up with two.
 */
export async function setCoverImageAction(projectId: string, imageId: string): Promise<void> {
  await requireUser();
  const db = await getDb();
  const loaded = await loadProject(projectId);
  if (!loaded) throw new Error("Project not found");
  await db
    .update(projects)
    .set({
      inputs: { ...loaded.project.inputs, coverImageId: imageId },
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));
  revalidatePath(`/pipeline/${projectId}`);
}

/**
 * Make a reference photograph the cover as it is. Session-checked wrapper; the
 * rules — including why `rightsConfirmed` is required for anything without an
 * open licence — live in @/lib/pipeline/sourced-cover.
 */
export async function coverFromReferenceAction(
  projectId: string,
  referenceId: string,
  rightsConfirmed: boolean
): Promise<{ image: GeneratedImageView; credit: CoverCredit }> {
  const user = await requireUser();
  const result = await coverFromReferenceCore(projectId, referenceId, {
    rightsConfirmed: rightsConfirmed === true,
    confirmedBy: user.email,
  });
  revalidatePath(`/pipeline/${projectId}`);
  return result;
}

export async function updateCoverCreditAction(
  projectId: string,
  imageId: string,
  edit: { label: string; url: string }
): Promise<CoverCredit> {
  await requireUser();
  const credit = await updateCoverCreditCore(projectId, imageId, edit);
  revalidatePath(`/pipeline/${projectId}`);
  return credit;
}

export async function deleteGeneratedImageAction(imageId: string): Promise<void> {
  // Shared workspace: every signed-in account manages all generated images.
  await requireUser();
  const db = await getDb();
  const [row] = await db
    .select({ id: images.id, projectId: images.projectId, storagePath: images.storagePath })
    .from(images)
    .where(eq(images.id, imageId))
    .limit(1);
  if (!row) return;

  await deleteStoredImage(row.storagePath);
  await db.delete(images).where(eq(images.id, imageId));
  revalidatePath(`/pipeline/${row.projectId}`);
}
