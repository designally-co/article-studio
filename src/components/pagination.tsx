import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PerPageMenu } from "@/components/per-page-menu";

/**
 * Which slice of a list you are looking at, and how to move.
 *
 * SHARED, BECAUSE PAGING IS NOT A LIBRARY IDEA. It began there and reads the
 * same wherever a list is longer than a page — Library at every width, and the
 * routines history next. The one thing that was actually about the Library was
 * the nav's accessible name, which is now the caller's to state; everything
 * else was already general.
 *
 * IT STATES THE RANGE, NOT JUST THE PAGE. "Page 2 of 4" tells you where you
 * are in a sequence nobody can picture; "21–40 of 73" tells you how much there
 * is and how much of it is in front of you, which is the question being asked.
 *
 * PLAIN LINKS, so a page is a real address: it survives a reload, can be
 * bookmarked, and the back button steps through pages the way it should. A
 * click handler would look identical and lose all three.
 *
 * The whole bar is absent on a single page — a control that can only be
 * disabled is furniture.
 */
export function Pagination({
  pageCount,
  total,
  from,
  to,
  hrefFor,
  label,
  perPage,
}: {
  pageCount: number;
  /** How many there are in total, not on this page. */
  total: number;
  /** The first and last of this page, counting from one. */
  from: number;
  to: number;
  /** Prebuilt by the caller, so whatever else is in the URL survives the move. */
  hrefFor: { previous: string | null; next: string | null };
  /** Names the nav for assistive technology — "Library pages", "Run pages".
   *  A page with two of these needs them told apart, and "pagination" would
   *  not do it. */
  label: string;
  /** Optional: how many rows a page holds, and where each choice leads. */
  perPage?: { value: number; options: { value: number; href: string }[] };
}) {
  /* WITH A PAGE-SIZE CHOICE, ONE PAGE IS NOT ENOUGH TO HIDE IT. Pick 50 on a
     list of 18 and everything fits on one page — hiding the bar then would take
     away the only control that could set it back. It goes only when the list
     fits on a page at the smallest size, where the choice changes nothing. */
  const smallest = perPage ? Math.min(...perPage.options.map((option) => option.value)) : 0;
  if (perPage ? total <= smallest : pageCount <= 1) return null;

  /* TWO ARROWS, NO WORDS. "Previous" and "Next" beside arrows pointing the way
     they already point is the label saying what the glyph says; the pair took
     most of the width of a phone to carry four characters of meaning. The
     names live in `aria-label`, so nothing is lost to anyone who cannot see
     the arrow.

     Each on its own disc, matching the pill beside them: same white, same
     hairline, same fully-rounded edge. Three objects on one line, not one
     enclosure containing three things.

     The same at every width. A phone and a desktop are both asking "how far
     in am I, and how do I move" — there is no version of that question that
     needs the word "Previous" spelled out beside a left-pointing arrow. */
  const step =
    "grid size-11 place-items-center rounded-full border border-line bg-surface text-ink-2 lg:size-10 transition-colors duration-(--duration-fast) hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:2px]";
  const spent = `${step} pointer-events-none opacity-40`;

  return (
    <nav
      aria-label={label}
      /* The row itself carries nothing — no ground, no edge, no padding. What
         sits on it does: a pill holding the count, and two discs to move by.
         Enclosing the whole line instead made the range and the arrows one
         object, which they are not: one is a statement and the other two are
         controls. */
      className="mt-4 flex items-center justify-between gap-3"
    >
      {/* ON A SURFACE, LIKE EVERYTHING ABOVE IT. Bare type on the page ground
          under a stack of cards read as a caption that had come loose from
          them. The pill gives the count the same white, hairline and rounded
          edge the discs beside it have, so the line is three objects of one
          family rather than a sentence with two buttons after it. */}
      {/* `min-h-9` rather than vertical padding, so the pill is exactly as tall
          as the discs beside it. Padded to the text it holds, it came out 33
          against their 36 — three pixels is not a mistake anyone names, but it
          is enough to stop three objects reading as one row. */}
      {/* THE PAGE SIZE LIVES IN THE COUNT'S PILL. "1–10 of 18" and "Per page:
          10" are two readings of one thing — how much of the list is in front
          of you — so they share the pill, the choice on the right behind an
          inset hairline. The Hub's list screens draw theirs the same way. */}
      <div className="inline-flex h-9 items-center rounded-full border border-line bg-surface text-sm text-ink-3">
        <p className={perPage ? "pl-3.5 pr-3" : "px-3.5"}>
          {from}–{to} of {total}
        </p>
        {perPage && (
          <>
            <span aria-hidden className="h-4 w-px bg-line" />
            <PerPageMenu value={perPage.value} options={perPage.options} />
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        {hrefFor.previous ? (
          <Link href={hrefFor.previous} className={step} rel="prev" aria-label="Previous page">
            <ChevronLeft aria-hidden className="size-4" />
          </Link>
        ) : (
          /* Rendered rather than hidden, so the pair does not shift sideways
             on the first and last page. */
          <span className={spent} aria-hidden>
            <ChevronLeft className="size-4" />
          </span>
        )}
        {/* NO "1 / 2". It sat between the two arrows restating the half of the
            range that the line to its left already carries — "1–10 of 73" says
            both how far in you are and how much there is, in the terms the
            reader actually asked in. Two ways of counting the same list, a
            hand's width apart. */}
        {hrefFor.next ? (
          <Link href={hrefFor.next} className={step} rel="next" aria-label="Next page">
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        ) : (
          <span className={spent} aria-hidden>
            <ChevronRight className="size-4" />
          </span>
        )}
      </div>
    </nav>
  );
}
