"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

import { PAGE_ACTION_BUTTON_QUIET, TopBlur } from "@/components/page-bar";

/**
 * Library's phone bar: the page's name on the menu button's line, and the one
 * control the page actually needs there.
 *
 * SEARCH IS THE WHOLE BAR, NOT A BUTTON BESIDE ONE. The desktop filter row is
 * a search box and three selects — direction, status, sort — which on a phone
 * became a two-column grid of dropdowns occupying most of the screen above a
 * list of ten articles. The selects are how you narrow a table you can see all
 * of at once; on a phone you are looking for one article and you know its name.
 *
 * So the phone gets search and nothing else, and it is not even permanently on
 * screen: the bar shows the page's name until you press the disc, then becomes
 * the field. The desktop bar is untouched — this replaces it below `lg`, it
 * does not reduce it.
 */
export function LibraryBar() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  const queryParam = params.get("q") ?? "";
  const [query, setQuery] = useState(queryParam);
  /* Open if there is already a term, so arriving on a filtered link — a
     bookmark, the back button — shows you what is filtering the list rather
     than a title and a short list with no stated reason for being short. */
  const [searching, setSearching] = useState(queryParam !== "");

  /* Adjusted during render rather than in an effect, so a URL that changed
     underneath the box never paints stale for a frame. Only a value we did not
     cause: our own debounced push lands back here a moment later, and adopting
     it would overwrite the box with what was typed 300ms ago. */
  const [lastParam, setLastParam] = useState(queryParam);
  if (queryParam !== lastParam) {
    setLastParam(queryParam);
    if (queryParam !== query.trim()) setQuery(queryParam);
  }

  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (query === queryParam) return;
    debounce.current = setTimeout(() => push(query.trim()), 300);
    return () => clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function push(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set("q", value);
    else next.delete("q");
    // Narrowing while standing on page four leaves you on a page the new
    // result set may not have.
    next.delete("page");
    router.push(next.size ? `${pathname}?${next.toString()}` : pathname);
  }

  function closeSearch() {
    setSearching(false);
    setQuery("");
    if (queryParam) push("");
  }

  return (
    /* WHILE IT IS OPEN THE BAR OUTRANKS THE MENU BUTTON. The field spreads
       across the whole line, and the button lives one layer above the bar it
       shares that line with — so without this the hamburger sat on top of the
       search box. It drops back under when the field closes. */
    <div
      className={`fixed inset-x-0 top-0 lg:hidden ${
        searching ? "z-(--z-search)" : "z-(--z-sticky)"
      }`}
    >
      <TopBlur />
      {/* Three columns with matching outer widths, so the title lands in the
          middle of the display rather than beside the menu button. The left
          column is empty: it reserves the button's space, and the button
          itself belongs to the navigation and paints above this. */}
      <div className="mx-auto grid h-12 w-full max-w-7xl grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 px-3 sm:px-8">
        {searching ? (
          /* THE DISC BECOMES THE BAR. Open, search is not a control sitting
             beside the page's name — it is the only thing on the line, spread
             across all three columns and over the menu button with it. A field
             that shares the line with a title and a hamburger is a field the
             width of neither, and on a phone the thing you are doing is the
             only thing you are doing.

             `relative`, so the X is positioned against the pill rather than
             placed in a grid column — which is what the field's right padding
             reserves room for. */
          <div className="relative col-span-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150">
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title…"
              aria-label="Search articles"
              /* The bar's own height, so opening search does not make the band
                 taller and shift the list underneath it. White on the blur,
                 which is the surface treatment this line already uses. */
              className="h-9 w-full rounded-full bg-surface pl-4 pr-10 text-sm text-ink outline-none placeholder:text-ink-3 focus-visible:shadow-[var(--shadow-focus)] [&::-webkit-search-cancel-button]:hidden"
            />
            <button
              type="button"
              onClick={closeSearch}
              aria-label="Close search"
              /* Inside the pill's right end, in the padding reserved for it —
                 the way a field's own clear button sits, rather than as a
                 second control after the box.

                 THE ONE ICON BUTTON THAT IS NOT 40, and it is not a standalone
                 one: it lives INSIDE a 36px field, so 40 cannot fit and the
                 40px rule does not reach it. Everything the rule covers is a
                 control sitting beside other controls; this is a field's own
                 affordance, and its size is set by the field. */
              className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-ink-3 transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-chrome hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        ) : (
          <>
            <div aria-hidden />
            <h1 className="min-w-0 truncate text-center font-heading text-base font-medium tracking-tight text-ink">
              Library
            </h1>
            <button
              type="button"
              onClick={() => setSearching(true)}
              aria-label="Search articles"
              /* White, not accent. Search commits nothing — it narrows a
                 list — and the accent is the floating New article button. It
                 matches the menu button at the other end of the same line. */
              className={`justify-self-end ${PAGE_ACTION_BUTTON_QUIET}`}
            >
              <Search aria-hidden className="size-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
