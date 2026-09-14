/*
 * THE CONTENT IN THE MIDDLE, THE ACTIONS AT THE RIGHT EDGE.
 *
 * Draft, Images and Publish each hold one thing to look at — the article, the
 * picture, the Hub preview — and a column of actions. They sat side by side, so
 * the thing you were looking at was always pushed left and the actions were
 * glued to its edge.
 *
 * The grid is three tracks inside the same `max-w-7xl` container every other
 * page uses: an empty one, the content at its own maximum width, and the rail.
 * The two outer tracks share what is left over, so where there is room the
 * content sits in the middle of the container and the rail against its right
 * edge. The rail's track never drops below the rail's width — when there is
 * not room to keep the content centred, it is the empty left track that gives
 * way, and the content moves left rather than under the rail.
 *
 * NO GAP BETWEEN THE TRACKS. The left track is often empty, and a column gap
 * would still indent the content by its width from the line every other page
 * starts on. The space between content and rail is the rail's own padding.
 *
 * The content's maximum is a variable, because the three things differ: an
 * article reads at a measure, a picture wants more, and the Hub preview is a
 * scaled page that is only legible given room. A phone keeps its own layout —
 * every class here is behind `lg:`.
 *
 * THE RAIL SHRINKS WITH THE SCREEN. At a fixed 360px beside a fixed 32px gap,
 * a 1100px window left the article 357px — narrower than the rail beside it.
 * The rail and its gap step down together instead, so the content keeps the
 * difference:
 *
 *   lg  (1024–1279)  288px rail, 20px gap
 *   xl  (1280–1535)  320px rail, 24px gap
 *   2xl (1536 and up) 360px rail, 32px gap — the size it was
 */
export const RAIL_GRID =
  "grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,var(--rail-content,52rem))_minmax(calc(var(--rail-w)_+_var(--rail-gap)),1fr)] lg:items-start lg:gap-x-0 lg:gap-y-6 lg:[--rail-w:288px] lg:[--rail-gap:20px] xl:[--rail-w:320px] xl:[--rail-gap:24px] 2xl:[--rail-w:360px] 2xl:[--rail-gap:32px]";

/** The thing to look at: the middle track. */
export const RAIL_CONTENT = "min-w-0 lg:col-start-2 lg:row-start-1";

/**
 * The actions: the right track, against its far edge — the rail's width plus
 * the gap that separates it from the content, which it carries as padding.
 */
export const RAIL_COLUMN =
  "lg:col-start-3 lg:row-start-1 lg:w-[calc(var(--rail-w)_+_var(--rail-gap))] lg:justify-self-end lg:pl-(--rail-gap)";

export function StageShell({
  title,
  description,
  children,
  wide,
  hideHeader,
  flushBottom,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** The container every other page uses — `max-w-7xl`, with its padding. */
  wide?: boolean;
  hideHeader?: boolean;
  /**
   * Drops the stage's bottom padding for a stage that ends in a bottom-anchored
   * element. A sticky child cannot travel past its container's content box, so
   * that padding would hold it up off the viewport edge and read as dead space.
   */
  flushBottom?: boolean;
}) {
  return (
    <div
      className={`mx-auto w-full px-3 pt-8 sm:px-6 sm:pt-12 ${
        flushBottom ? "pb-0" : "pb-20 sm:pb-28"
      } ${wide ? "max-w-7xl lg:px-12 xl:px-16" : "max-w-3xl lg:px-8"}`}
    >
      {/* The stepper names the current stage visibly, so printing it again in
          the body would say nothing. It remains the page's h1 because the
          chrome no longer carries one, and a page with no top-level heading
          leaves heading navigation with nowhere to start. */}
      <h1 className="sr-only">{title}</h1>
      {/* Only supplied when it says something the screen cannot — why a wait is
          happening, or what a state means. A sentence narrating what the visible
          controls already do is instruction nobody needed. */}
      {!hideHeader && description && (
        <p className="mb-8 max-w-[68ch] text-balance leading-relaxed text-ink-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 sm:mb-10">
          {description}
        </p>
      )}
      {children}
    </div>
  );
}

export function ApiNotReady() {
  return (
    <div className="rounded-2xl bg-warn-soft px-5 py-4 text-sm leading-relaxed text-ink-2">
      <strong className="font-semibold text-ink">ANTHROPIC_API_KEY is not configured.</strong>{" "}
      Generation is unavailable until the key is set in the server environment.
    </div>
  );
}
