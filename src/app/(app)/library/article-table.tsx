"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProjectStatus } from "@/db/schema";
import { deleteArticleAction, deleteArticlesAction } from "./actions";
import { LibraryItem, LibraryRow } from "./library-row";
import { SortHead } from "./sort-head";

export type ArticleRow = {
  id: string;
  title: string;
  category: string;
  dateLabel: string;
  status: ProjectStatus;
  imageUrl: string | null;
};

/**
 * The library list, and whatever you have picked out of it.
 *
 * THE SELECTION LIVES HERE, above the rows, because it is not a property of any
 * one of them: the header's tick has to know what every row is doing, and the
 * bar has to count them. A checkbox that owned its own state could not answer
 * either question.
 *
 * IT IS SCOPED TO THE PAGE YOU CAN SEE. Ten rows are shown at a time, and the
 * selection is cleared by paging — carrying a hidden selection across pages
 * means a Delete button reporting a number you cannot check against anything on
 * screen, which is exactly the situation where a bulk delete goes wrong.
 */
export function ArticleTable({ rows, sort }: { rows: ArticleRow[]; sort: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /* The phone's swipe-to-delete: which card is swiped open (one at a time), and
     which article is waiting on the confirmation. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [asking, setAsking] = useState<ArticleRow | null>(null);

  /* A touch anywhere but the open card puts it away. */
  useEffect(() => {
    if (!openId) return;
    const onDown = (event: PointerEvent) => {
      const card = (event.target as Element | null)?.closest?.("[data-swipe-id]");
      if (card?.getAttribute("data-swipe-id") !== openId) setOpenId(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [openId]);

  function removeOne(row: ArticleRow) {
    setAsking(null);
    setError(null);
    start(async () => {
      try {
        await deleteArticleAction(row.id);
        setOpenId(null);
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "That article could not be deleted.");
      }
    });
  }

  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  const count = selected.size;
  const allSelected = count > 0 && count === rows.length;

  function toggle(id: string, next: boolean) {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }

  function remove() {
    const batch = [...selected];
    setConfirming(false);
    setError(null);
    start(async () => {
      try {
        await deleteArticlesAction(batch);
        setSelected(new Set());
        router.refresh();
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Those articles could not be deleted."
        );
      }
    });
  }

  return (
    <div className="space-y-3">
      {/* Only present when something is picked. A bar that is always there,
          reading "0 selected" beside a disabled button, is a permanent reminder
          of a mode you are not in. */}
      {count > 0 && (
        /* Desk only: a phone has no selection, it swipes a card to delete it. */
        <div className="hidden flex-wrap items-center gap-3 rounded-xl bg-surface px-4 py-2.5 sm:flex">
          <p className="text-sm font-medium text-ink">
            {count} selected
          </p>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded-md text-sm text-ink-3 underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:2px]"
          >
            Clear
          </button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="ml-auto"
            disabled={pending}
            onClick={() => setConfirming(true)}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      )}

      {error && (
        <p className="text-sm text-danger-ink" role="alert">
          {error}
        </p>
      )}

      {/* A PHONE GETS A LIST, NOT A NARROWER TABLE. The table sheds columns as
          the screen shrinks and that holds until the last two are Title and
          Status — at 375px the title had about seven characters before the
          ellipsis. Below `sm` the same rows render as list items instead; from
          `sm` up the table is what it always was, since by then there is width
          for columns to mean something.

          EACH ONE ON ITS OWN CARD, rather than ruled lines inside a single
          plate. A row is a row because the things beside it line up into
          columns; with the columns gone there is nothing to line up, and a
          hairline between two titles was left drawing a boundary that no
          longer separated anything. Cards say what is actually true — that
          these are ten separate articles, each a thing you open. */}
      <ul className="space-y-2 sm:hidden">
        {rows.map((row) => (
          <LibraryItem
            key={row.id}
            {...row}
            open={openId === row.id}
            onOpenChange={(next) => setOpenId(next ? row.id : null)}
            onDelete={() => setAsking(row)}
          />
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface sm:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-px px-4">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(next) =>
                    setSelected(next === true ? new Set(ids) : new Set())
                  }
                  aria-label={allSelected ? "Clear selection" : "Select all articles on this page"}
                />
              </TableHead>
              <TableHead className="px-4 text-ink-3">
                <SortHead label="Title" field="title" sort={sort} />
              </TableHead>
              <TableHead className="hidden px-4 text-ink-3 sm:table-cell">
                <SortHead label="Direction" field="direction" sort={sort} />
              </TableHead>
              <TableHead className="px-4 text-ink-3">
                <SortHead label="Status" field="status" sort={sort} />
              </TableHead>
              <TableHead className="hidden w-px px-4 text-ink-3 md:table-cell">
                <SortHead label="Updated" field="updated" sort={sort} />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <LibraryRow
                key={row.id}
                {...row}
                selected={selected.has(row.id)}
                onSelectedChange={(next) => toggle(row.id, next)}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        title={count === 1 ? "Delete this article?" : `Delete ${count} articles?`}
        description="Permanent. Anything already published to the Hub stays there."
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      />

      {/* The phone's one-article delete, from a swiped card. */}
      <ConfirmDialog
        title="Delete this article?"
        description={
          asking
            ? `“${asking.title}” will be deleted permanently. Anything already published to the Hub stays there.`
            : "Permanent. Anything already published to the Hub stays there."
        }
        open={Boolean(asking)}
        onCancel={() => setAsking(null)}
        onConfirm={() => asking && removeOne(asking)}
      />
    </div>
  );
}
