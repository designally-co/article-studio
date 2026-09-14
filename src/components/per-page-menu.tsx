"use client";

import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

/**
 * How many rows a page holds — the right half of the pagination's count pill.
 *
 * LINKS, NOT A HANDLER, for the reason the page discs beside it are links: a
 * page size is part of the address, so it survives a reload, a bookmark and
 * the back button. The caller builds each href, so whatever else is in the
 * URL — search, filters, sort — comes along.
 *
 * The panel and its rows are the direction picker's: the same white plate,
 * shadow and 44px rows at 500, so the two menus in the product are one object.
 * UPWARD, because the pager is the last thing on the page and there is rarely
 * room under it.
 */
export function PerPageMenu({
  value,
  options,
}: {
  value: number;
  options: { value: number; href: string }[];
}) {
  return (
    <DropdownMenuPrimitive.Root modal={false}>
      <DropdownMenuPrimitive.Trigger
        aria-label={`Rows per page: ${value}`}
        className="group inline-flex h-full items-center gap-0.5 rounded-r-full pl-3 pr-2.5 text-sm text-ink-3 transition-colors duration-(--duration-fast) hover:text-ink focus-visible:outline-none focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:2px] data-[state=open]:text-ink"
      >
        Per page: {value}
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 transition-transform duration-(--duration-fast) group-data-[state=open]:rotate-180"
        />
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Rows per page"
          className="z-(--z-dropdown) min-w-36 rounded-2xl bg-surface p-2 text-ink shadow-[var(--shadow-pop)] outline-none duration-(--motion-enter) ease-(--ease-out) data-closed:duration-(--motion-exit) data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none"
        >
          {options.map((option) => (
            <DropdownMenuPrimitive.Item key={option.value} asChild>
              <Link
                href={option.href}
                className="flex min-h-11 cursor-default select-none items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium outline-none transition-colors data-highlighted:bg-sunken"
              >
                <span className="min-w-0 flex-1">{option.value}</span>
                {option.value === value && <Check aria-hidden className="size-4 shrink-0 text-accent-press" />}
              </Link>
            </DropdownMenuPrimitive.Item>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
