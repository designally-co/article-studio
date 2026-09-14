import type { ReferenceOrigin, SelectedTopic } from "@/db/schema";

/**
 * The shapes that cross between the server and the browser.
 *
 * THEY LIVE IN A MODULE OF THEIR OWN BECAUSE OF WHERE THEY ARE READ FROM. A
 * client component needs these names; the functions that produce them are
 * `server-only`, and the actions that wrap those are `"use server"`. Neither is
 * a safe place for a client import to point at, and re-exporting a type from a
 * `"use server"` file is worse than unsafe — it is broken:
 *
 *     ReferenceError: PublishToHubResult is not defined
 *     ReferenceError: TopicIdea is not defined
 *
 * That is production, on every page that loaded one of those modules. The
 * server-actions transform turns each export of such a file into a registered
 * server reference, and it does that to `export type { … }` as well — emitting
 * a runtime export of a name that only ever existed in the type system. The
 * build says nothing, because nothing is wrong until the module is evaluated.
 *
 * So the types are declared here, in a plain module with no directive of any
 * kind, and everyone — client components, server modules, actions — imports
 * them from here. There is no re-export to get wrong.
 */

export type TopicIdea = SelectedTopic & { directionId: string; directionName: string };

export type GeneratedImageView = {
  id: string;
  url: string;
  provider: string;
  model: string;
  aspectRatio: string;
  variationNo: number;
};

export type GenerationRunResult = {
  images: GeneratedImageView[];
  /** Variations that were requested but produced nothing. */
  failedCount: number;
  /** The first failure's message, so the caller can act on it. */
  failureReason?: string;
};

export type UploadedReferenceView = {
  id: string;
  url: string;
  name: string;
  width: number;
  height: number;
  origin: ReferenceOrigin;
  sourceUrl: string | null;
  sourceName: string | null;
  license: string | null;
};

export type PublishToHubResult = {
  url: string;
  /** The article in the Hub's CMS — where a draft is visible; its public page is not. */
  adminUrl: string;
  slug: string;
  status: string;
  /**
   * Why the article went up without its cover, when it did.
   *
   * The cover is deliberately optional — a bad image must never stop an article
   * being published. But "optional" was implemented as an empty `catch`, so a
   * cover that failed for TEN DAYS looked exactly like a cover nobody asked
   * for: articles arriving at the Hub with no image and no complaint. The
   * decision to carry on is right; throwing the reason away was not.
   */
  coverWarning?: string;
};
