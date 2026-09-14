"use client";

import Link from "next/link";
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
 * The checkbox stays. Selecting and using the bar above is the only way to
 * delete anything, here and in the table — removing the tick would remove the
 * capability.
 */
export function LibraryItem({
  id,
  title,
  imageUrl,
  selected,
  onSelectedChange,
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
  selected: boolean;
  onSelectedChange: (next: boolean) => void;
}) {
  return (
    <li
      data-selected={selected || undefined}
      /* `relative` is what lets the title's stretched link cover the whole
         item rather than just its own line. */
      /* Its own plate. `border-line-strong` on selection rather than a fill:
         the card is white on the page's near-white ground, so `bg-sunken`
         alone made a picked article read as a HOLE in the stack rather than as
         one that is picked. The edge states it without changing the surface. */
      className="relative flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-3 transition-colors duration-(--duration-fast) ease-(--ease-out) data-selected:border-line-strong data-selected:bg-sunken"
    >
      {/* Above the stretched link, or the link swallows the tick and opens the
          article instead. */}
      <span className="relative z-10 shrink-0 self-center">
        <Checkbox
          checked={selected}
          onCheckedChange={(next) => onSelectedChange(next === true)}
          aria-label={`Select ${title}`}
        />
      </span>

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
    </li>
  );
}
