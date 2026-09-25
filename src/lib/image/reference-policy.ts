/**
 * Limits that both the stage and the server action have to agree on.
 *
 * Not in `image-actions.ts` with the action that enforces it: a `"use server"`
 * module may only export async functions, so a constant shared with the client
 * has to live outside it. Not in `reference-sources.ts` either — that module is
 * `server-only`, and the dock needs this number to decide whether to offer the
 * search at all.
 */

/**
 * How many references one article may hold.
 *
 * NOT how many are sent to a model. The stage sends ONE — the chosen
 * photograph — because the editing models preserve what they are shown, and a
 * set of four unrelated subjects dilutes the frame rather than grounding it.
 * This is the size of the set the editor chooses from.
 *
 * Eight since the cited pages each give up to three pictures (see
 * `article-sources.ts`): the work from two or three angles, across two or three
 * pages, is a real choice, and it is still few enough to look at each one. It
 * fits one row under the dock on a desktop and two on a phone.
 */
export const MAX_FOUND_REFERENCES = 8;

/**
 * The narrowest picture that may go up as the cover as it is.
 *
 * The width the Hub's covers are delivered at (`DELIVERY_MAX_WIDTH` in
 * storage.ts), so a picture used as it is is never the softest thing on the
 * page. Measured on the Hub's latest articles, most cited pages lead with a
 * 1200×630 share card: those are for generating from, not for publishing. An
 * Unsplash photograph is exempt at the stage because its full-size original is
 * fetched when it becomes the cover; the server checks the bytes that actually
 * go up either way.
 */
export const COVER_MIN_WIDTH = 1600;
