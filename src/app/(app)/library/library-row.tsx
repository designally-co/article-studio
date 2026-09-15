"use client";

import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { Trash2 } from "lucide-react";
import { MOTION, duration } from "@/lib/motion";
import { TableCell, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import type { ProjectStatus } from "@/db/schema";

/**
 * One article, as a row.
 *
 * A TABLE, BECAUSE THE LIBRARY IS A LIST OF THE SAME THING. Cards give every
 * article a picture the size of a postcard and then repeat four labels beneath
 * it, so twelve articles are twelve blocks to read rather than twelve lines to
 * scan. A row puts the same four facts in the same four places every time,
 * which is what makes a column comparable — and which article was edited last,
 * or which are still drafts, is a question you answer by running your eye down
 * one column rather than reading each card.
 *
 * The thumbnail stays, at row height. It is the fastest way to recognise an
 * article you already know, and it costs a column rather than a paragraph.
 *
 * ALL OF WHICH STOPS BEING TRUE ON A PHONE — see LibraryItem below.
 */
export function LibraryRow({
  id,
  title,
  category,
  dateLabel,
  status,
  imageUrl,
  selected,
  onSelectedChange,
}: {
  id: string;
  title: string;
  category: string;
  dateLabel: string;
  status: ProjectStatus;
  imageUrl: string | null;
  selected: boolean;
  onSelectedChange: (next: boolean) => void;
}) {
  /* NO DELETE ON THE ROW. It was a trash button in a column of its own after
     Updated, revealed on hover — a second way to delete that did not look like
     the first, confirmed by the browser's own dialog rather than the product's,
     and a column the table's last date could not close against. Deleting is
     one path now: tick the rows, and the selection bar's Delete, behind the
     same confirmation for one article or ten.

     `relative` on the row is what lets the title's stretched link cover the
     whole line rather than just its own cell.

     THE GUTTER IS SET ON THE ROW, NOT ON EACH CELL. The primitive pads a `td`
     by 8px and a `th` by 16, so the column BOXES lined up while everything
     printed inside them sat eight pixels apart from its own heading — the kind
     of misalignment that reads as sloppiness without being obvious enough to
     name. Declaring it once for every cell in the row is what stops the two
     drifting again. */
  return (
    <TableRow
      data-selected={selected || undefined}
      className="group relative [&>td]:px-4 hover:bg-sunken data-selected:bg-sunken"
    >
      {/* Above the row's stretched link, or the link would swallow the tick and
          open the article instead. */}
      <TableCell className="relative z-10 w-px">
        <Checkbox
          checked={selected}
          onCheckedChange={(next) => onSelectedChange(next === true)}
          aria-label={`Select ${title}`}
        />
      </TableCell>
      {/* `w-full max-w-0` is what makes a table cell truncate. A cell sizes to
          its content by default, so a long title widened the whole table and
          pushed the other columns off a phone instead of shortening itself;
          the zero max-width lets `truncate` take effect while `w-full` still
          claims the space the other columns do not need. */}
      <TableCell className="w-full max-w-0 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-deep">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
            ) : (
              /* The first letter, not an icon: a placeholder that differs per
                 row still tells the rows apart at a glance. */
              <span aria-hidden className="text-sm font-medium text-ink-3">
                {title.trim().charAt(0).toUpperCase()}
              </span>
            )}
          </span>
          <Link
            href={`/pipeline/${id}`}
            /* The row is the target. The link stretches across it, so the
               whole line is clickable and the name is still the accessible
               name for it. */
            className="min-w-0 rounded-sm after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:-2px]"
          >
            <span className="block truncate font-medium text-ink">{title}</span>
          </Link>
        </div>
      </TableCell>

      <TableCell className="hidden text-ink-2 sm:table-cell">{category}</TableCell>

      <TableCell>
        {/* Published is the exception worth marking; draft is the resting
            state, so it gets a word rather than a second badge competing. */}
        {status === "published" ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2">
            <span aria-hidden className="size-1.5 rounded-full bg-ok" />
            Published
          </span>
        ) : (
          <span className="text-ink-3">Draft</span>
        )}
      </TableCell>

      {/* The last column, as wide as a date: it closes the row at the card's
          edge, as the Hub's list tables do. */}
      <TableCell className="hidden w-px whitespace-nowrap text-ink-3 md:table-cell">{dateLabel}</TableCell>
    </TableRow>
  );
}

/**
 * One article, as a list item — the phone's version of the row above.
 *
 * COLUMNS NEED WIDTH, AND A PHONE HAS NONE TO GIVE. The table degrades by
 * dropping columns as the screen narrows, which works until the last two are
 * Title and Status: at 375px the title had about seven characters before the
 * ellipsis, so a page of ten articles read "Buildin…", "The Op…", "Why S…" —
 * ten thumbnails and ten copies of the word Published. The one fact you came to
 * find was the one fact the layout would not show.
 *
 * So it stops being a table, and then it stops carrying the columns too. The
 * title takes the full width and two lines if it needs them, and that is all.
 * Direction, Updated and Status were each argued down here in turn on the
 * reasoning that a phone should not lose what the table showed — but the table
 * had already dropped the first two at this width, and the third was a line of
 * type under every single article to mark the state that most of them share.
 * A list of names you can actually read beats a list of names you cannot with
 * a label underneath each one.
 *
 * NO SELECTION ON A PHONE: SWIPE A CARD LEFT TO DELETE IT. Choosing eight
 * articles and deleting them together is desk work, and the checkbox cost the
 * card its width to sit there in case. On a phone the one thing done to a row is
 * getting rid of it, so the card does what phone lists do everywhere else (Mail,
 * Messages): drag it left and it slides off the left edge of the screen,
 * revealing Delete underneath on the right. Tap Delete, answer the confirmation,
 * and that one article goes. The desk keeps its checkboxes and bar.
 */
/** How far an open card sits to the left: the part of Delete it reveals. */
const SWIPE_OPEN = 88;
/** A press that travels this far has declared which way it is going. */
const SWIPE_SLOP = 8;

export function LibraryItem({
  id,
  title,
  imageUrl,
  open,
  onOpenChange,
  onDelete,
}: {
  id: string;
  title: string;
  /* `category`, `dateLabel` and `status` arrive with the row and are
     deliberately not read here — the call site spreads the whole article, and
     the table beside this still wants all three. */
  category?: string;
  dateLabel?: string;
  status?: ProjectStatus;
  imageUrl: string | null;
  /** Whether this card is swiped open, showing Delete. One at a time. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
}) {
  /* GSAP MOVES THE CARD, NOT REACT. While a finger is on it the card is set to
     the finger's position on every pointer event — no render and no easing, so
     it never lags behind. On release, and when it is opened or closed from
     outside (a touch elsewhere), it tweens to rest with the product's easing.
     Delete grows and fades in with the distance the card has travelled. */
  const cardRef = useRef<HTMLDivElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; base: number; axis: "x" | "y" | null } | null>(null);
  /* A drag ends in a click, which would otherwise open the article just
     dragged. */
  const dragged = useRef(false);

  /** Put the card at `x`, and uncover Delete by as much as that travels. */
  const place = (x: number) => {
    const shown = Math.min(1, Math.max(0, -x / SWIPE_OPEN));
    gsap.set(cardRef.current, { x });
    gsap.set(deleteRef.current, { scale: 0.6 + 0.4 * shown, autoAlpha: shown });
  };

  /** To rest, open or shut. Both decelerate into place: the card settling,
      not leaving. */
  const settle = (toOpen: boolean) => {
    const seconds = duration(MOTION.CONTENT);
    gsap.to(cardRef.current, {
      x: toOpen ? -SWIPE_OPEN : 0,
      duration: seconds,
      ease: MOTION.EASE_ENTER,
      overwrite: "auto",
    });
    gsap.to(deleteRef.current, {
      scale: toOpen ? 1 : 0.6,
      autoAlpha: toOpen ? 1 : 0,
      duration: seconds,
      ease: MOTION.EASE_ENTER,
      overwrite: "auto",
    });
  };

  /* The first render places the card without motion; after that a change of
     `open` from outside the card tweens it. Compared rather than counted, so
     React's development double-run of effects does not animate on arrival. */
  const shownOpen = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    if (shownOpen.current === null) place(open ? -SWIPE_OPEN : 0);
    else if (shownOpen.current !== open && !drag.current) settle(open);
    shownOpen.current = open;
  }, [open]);

  return (
    <li
      data-swipe-id={id}
      /* `relative` holds Delete behind the card. Nothing here clips: the card
         slides off the left edge of the screen, past the page's own padding. */
      className="relative"
      onClickCapture={(event) => {
        /* Delete is its own control and is never swallowed. */
        if ((event.target as Element).closest("[data-swipe-delete]")) return;
        if (dragged.current) {
          dragged.current = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        /* A tap on an open card puts it away rather than opening the article
           behind a Delete that is still showing. */
        if (open && !(event.target as Element).closest("[data-swipe-delete]")) {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
        }
      }}
    >
      {/* DELETE, UNDERNEATH: a round icon button in the critical red, centred in
          the 88px the open card reveals. 44 across, like every other icon
          button on a phone. The name is on the button for assistive technology; it is out
          of the tab order and hidden until the card is open. */}
      <div className="absolute inset-y-0 right-0 grid w-[88px] place-items-center">
        <button
          type="button"
          ref={deleteRef}
          data-swipe-delete
          onClick={onDelete}
          tabIndex={open ? 0 : -1}
          aria-hidden={!open}
          aria-label={`Delete ${title}`}
          title="Delete"
          className="grid size-11 place-items-center rounded-full bg-destructive text-white transition-colors duration-(--duration-fast) ease-(--ease-out) active:bg-danger-hover focus-visible:outline-none focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:2px]"
        >
          <Trash2 aria-hidden className="size-5" />
        </button>
      </div>

      <div
        /* `pan-y` leaves vertical movement to the browser and hands horizontal
           movement to the swipe, so dragging a card sideways never also drags
           the page. `relative` lets the title's stretched link cover the card. */
        ref={cardRef}
        className="relative flex touch-pan-y select-none items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-3 [-webkit-touch-callout:none]"
        onPointerDown={(event) => {
          dragged.current = false;
          /* Catch the card where it is, mid-settle or at rest, so a finger that
             lands during a tween picks it up instead of it jumping. */
          gsap.killTweensOf([cardRef.current, deleteRef.current]);
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            base: Number(gsap.getProperty(cardRef.current, "x")) || 0,
            axis: null,
          };
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          if (!d) return;
          const dx = event.clientX - d.x;
          const dy = event.clientY - d.y;
          if (!d.axis) {
            if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;
            d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
            if (d.axis === "y") {
              /* A scroll: let go, and finish any settle the touch interrupted. */
              drag.current = null;
              settle(open);
              return;
            }
            dragged.current = true;
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              /* A pointer the browser no longer tracks; the drag works without
                 capture, it just stops following a finger that leaves the card. */
            }
          }
          /* Left only, and a little past Delete with resistance, so the end of
             the travel is felt rather than hit. */
          const raw = d.base + dx;
          place(raw > 0 ? 0 : raw < -SWIPE_OPEN ? -SWIPE_OPEN + (raw + SWIPE_OPEN) / 3 : raw);
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          if (d.axis !== "x") {
            /* A tap: finish any settle it interrupted. */
            settle(open);
            return;
          }
          /* RELEASE: past half of Delete it opens, short of it it closes, and
             either way GSAP carries it the rest of the distance. */
          const next = Number(gsap.getProperty(cardRef.current, "x")) <= -SWIPE_OPEN / 2;
          settle(next);
          if (next !== open) onOpenChange(next);
          /* THE SWALLOW LASTS ONE CLICK, NOT UNTIL THE NEXT ONE. A browser does
             not always follow a drag with a click; left set, the flag ate the
             next real tap — Delete itself. The click a drag does produce fires
             before this timer. */
          setTimeout(() => {
            dragged.current = false;
          }, 0);
        }}
        onPointerCancel={() => {
          drag.current = null;
          settle(open);
        }}
      >
      <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-deep">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        ) : (
          <span aria-hidden className="text-sm font-medium text-ink-3">
            {title.trim().charAt(0).toUpperCase()}
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1 self-center">
        <Link
          href={`/pipeline/${id}`}
          className="rounded-sm after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:-2px]"
        >
          {/* Two lines, then the ellipsis. One line is what the table was
              doing and is what made it useless; unbounded lets a long headline
              turn one article into a paragraph. */}
          <span className="line-clamp-2 font-medium leading-snug text-ink">{title}</span>
        </Link>

      </span>
      </div>
    </li>
  );
}
