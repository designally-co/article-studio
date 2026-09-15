/**
 * The band across the top of a phone screen, and the two disc buttons that
 * live on it.
 *
 * WRITTEN ONCE BECAUSE IT WAS ABOUT TO BE WRITTEN THREE TIMES. The pipeline
 * built this first — a three-layer progressive blur under a row that shares its
 * line with the menu button — and Library and Routines both needed the same
 * thing. Three copies of a stack whose whole effect depends on three masks
 * agreeing with each other is three chances for them to stop agreeing.
 */

import Link from "next/link";
import { Plus } from "lucide-react";

/**
 * A page's one forward action as a floating button in the bottom-right corner —
 * Library's New article, Routines' New routine.
 *
 * BELOW `lg` ONLY. On a phone it shared a crowded bar with the menu and search;
 * in the corner it is always reachable and it is the corner a thumb reaches
 * first. On a desk the action stays a button on the heading line, where the
 * page's other controls are.
 *
 * 40 across, like every other icon button on a phone; the accent, a raised
 * shadow and a plus; 16 off the edges, lifted clear of a phone's home
 * indicator. Below the drawer and dialogs, above the
 * page. A link when it navigates, a button when it opens something on this page.
 */
export function PageFab({
  label,
  href,
  onClick,
}: {
  label: string;
  href?: string;
  onClick?: () => void;
}) {
  const className =
    "fixed right-4 bottom-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))] z-(--z-sticky) grid size-10 place-items-center rounded-full bg-accent text-white shadow-[var(--shadow-pop)] transition-[background-color,transform] duration-(--duration-fast) ease-(--ease-out) hover:bg-accent-hover active:scale-95 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] sm:right-6 sm:bottom-6 lg:hidden";
  const icon = <Plus aria-hidden className="size-5" />;
  return href ? (
    <Link href={href} aria-label={label} title={label} className={className}>
      {icon}
    </Link>
  ) : (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={className}>
      {icon}
    </button>
  );
}

/** The disc for a page's forward action: the thing you came here to press. */
export const PAGE_ACTION_BUTTON =
  "grid size-10 place-items-center rounded-full bg-accent text-white shadow-[var(--shadow-card)] transition-colors duration-(--duration-fast) ease-(--ease-out) enabled:hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-chrome-active disabled:text-ink-3 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]";

/** The same disc, for an action that commits nothing — search, filters, the
 *  menu. White rather than accent, because the accent is what you press to
 *  make something happen and a page that colours everything that way has said
 *  nothing about any of it.
 *
 *  OUTLINED, WHERE THE CLOSE DISCS ARE NOT. These sit over the page's content
 *  and it scrolls underneath them; white on white text is a shape you have to
 *  find rather than one you can see, and against the page's own near-white
 *  ground a fill five values off it is no edge at all. A close button never
 *  has that problem — it sits ON a surface, in a corner, and its soft grey
 *  fill is enough on its own.
 *
 *  `--line` rather than `--line-strong`: the edge only has to close the shape,
 *  not draw attention to it. At #e0e0e0 the hairline was the loudest thing on
 *  a bar whose whole job is to stay out of the way of the article under it;
 *  at #f0f0f0 it is nearly invisible against the disc and does the one thing
 *  it is there for — stopping the white from dissolving into the page.
 *
 *  40px, like every other icon button. The size lives HERE rather than at the
 *  call sites now that there is only one of it — a caller cannot drift from a
 *  number it does not state, and the two-`size-*`-utilities trap this used to
 *  invite needs two sizes to exist before it can happen. */
export const PAGE_ACTION_BUTTON_QUIET =
  "grid size-10 place-items-center rounded-full border border-line bg-surface text-ink-2 transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-chrome hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]";

/*  40, THE SAME AS EVERY OTHER ICON BUTTON. The sheet's close was 36 and the
 *  drawer's 44, which is why the size used to live at the call sites; with one
 *  size it belongs here, where nothing can disagree with it. */
export const PAGE_CLOSE_BUTTON =
  "grid size-10 shrink-0 place-items-center rounded-full bg-chrome text-ink-2 transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-chrome-active hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]";

/**
 * PROGRESSIVE BLUR, NOT A LID. An opaque band the width of the page does not
 * let the content pass under the bar so much as chop it off, and reads as a
 * second surface floating over the page rather than as part of it.
 *
 * Three stacked layers, each blurring harder and stopping sooner: at the top
 * all three apply, a third of the way down only the softest still does, and by
 * the bottom edge there is none. That gradient is what makes it read as depth —
 * the text is visibly still there, going out of focus as it slides underneath,
 * instead of vanishing at a hard line.
 *
 * Blur alone would leave the type legible enough to compete with whatever the
 * bar carries, so each layer brings a wash of the page's own ground with it.
 * `-z-10` keeps the stack behind the bar's content while staying inside the
 * bar's own stacking context.
 */
export function TopBlur() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[calc(100%+1.25rem)]"
    >
      <div className="absolute inset-0 bg-bg/35 backdrop-blur-[2px] [mask-image:linear-gradient(to_bottom,#000_0,#000_62%,transparent_100%)]" />
      <div className="absolute inset-0 bg-bg/35 backdrop-blur-[8px] [mask-image:linear-gradient(to_bottom,#000_0,#000_38%,transparent_74%)]" />
      <div className="absolute inset-0 bg-bg/35 backdrop-blur-[16px] [mask-image:linear-gradient(to_bottom,#000_0,#000_16%,transparent_46%)]" />
    </div>
  );
}

/**
 * A page's title bar on a phone: the name of the page on the menu button's own
 * line, and the page's one action at the far end of it.
 *
 * FIXED, NOT STICKY WITH A NEGATIVE MARGIN. The pipeline pulls its bar up onto
 * the menu button's line with `-mt-12`, which works because that bar is the
 * first thing in the page. Routines' action has to open a dialog owned by a
 * client component several levels in, and a bar that has to be the first child
 * of the page cannot go there. Fixed puts it on that line from anywhere in the
 * tree — the 48px the menu strip already reserves in the flow is exactly what
 * this covers, so nothing below it moves.
 *
 * Below `lg` only: on a wide screen the rail is a sidebar, there is no menu
 * button and no line to share, and the page opens with its full heading.
 */
export function PageBar({
  title,
  action,
}: {
  title: string;
  /** The page's forward action, as a disc. Right-aligned on the bar's line. */
  action?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-x-0 top-0 z-(--z-sticky) lg:hidden">
      <TopBlur />
      {/* IN THE MIDDLE OF THE SCREEN, NOT AFTER THE BUTTON. Padded to clear the
          menu disc, the title started 56px in and sat off toward the left with
          a wide empty gap before the action — it read as a label attached to
          the hamburger rather than as the name of the page.

          Three columns, and the outer two are the SAME WIDTH, which is what
          actually centres it: a title in the middle column is in the middle of
          the display whether or not there is an action on the right, and it
          does not shift when one appears. The left column is empty — the menu
          button belongs to the navigation and paints a layer above this — so
          the column is there to reserve its space, not to hold it. */}
      <div className="mx-auto grid h-12 w-full max-w-7xl grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 px-3 sm:px-8">
        <div aria-hidden />
        {/* The page's h1 — the only one it has below `lg`, since the heading
            block it used to open with is a desktop idea. Truncated rather than
            wrapped: the bar is one line tall and a second one would push it
            off the button's line. */}
        <h1 className="min-w-0 truncate text-center font-heading text-base font-medium tracking-tight text-ink">
          {title}
        </h1>
        <div className="justify-self-end">{action}</div>
      </div>
    </div>
  );
}
