"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";

export type SortField = "title" | "direction" | "status" | "updated";
export type SortDir = "asc" | "desc";

/**
 * A column heading that sorts the table by that column — the Hub's list
 * screens draw theirs the same way: the column's name, then an up and a down
 * chevron, the one in force at full ink and the other faint.
 *
 * LINKS, like the pager beside the table: a sort is part of the address, so it
 * survives a reload and the back button, and whatever else is in the URL —
 * search, filters, page size — comes along. It drops `page`, because page 3 of
 * one order is not a place in another.
 */
export function SortHead({
  label,
  field,
  sort,
}: {
  label: string;
  field: SortField;
  /** The sort in force, as `field_dir`. */
  sort: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const hrefFor = (dir: SortDir) => {
    const next = new URLSearchParams(params.toString());
    next.set("sort", `${field}_${dir}`);
    next.delete("page");
    return `${pathname}?${next.toString()}`;
  };

  /* 24 across, as the Hub's: a chevron is a small mark, and the box around it
     is what makes it a target. Faint until it is the order in force. */
  const button = (dir: SortDir) => {
    const active = sort === `${field}_${dir}`;
    const Icon = dir === "asc" ? ChevronUp : ChevronDown;
    return (
      <Link
        href={hrefFor(dir)}
        scroll={false}
        aria-label={`Sort by ${label}, ${dir === "asc" ? "ascending" : "descending"}`}
        aria-current={active ? "true" : undefined}
        className={`grid h-7 w-6 place-items-center rounded-md text-ink transition-opacity duration-(--duration-fast) hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:[outline:2px_solid_var(--accent)] ${
          active ? "opacity-100" : "opacity-30"
        }`}
      >
        <Icon aria-hidden className="size-4" strokeWidth={1.75} />
      </Link>
    );
  };

  return (
    <span className="inline-flex items-center gap-3">
      <span>{label}</span>
      <span className="inline-flex items-center">
        {button("asc")}
        {button("desc")}
      </span>
    </span>
  );
}
