"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Layers, Newspaper, Palette, Shapes, Sparkle, Sparkles, type LucideIcon } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { PillarGroup } from "./setup-form";

/** How many rows the menu shows before it scrolls. */
const MAX_ROWS = 7;
/** One row's height — `min-h-11` on MenuItem below. Stated here because the
 *  cap is arithmetic on it, and the two have to move together. */
const ROW = "2.75rem";

/* The shared dropdown panel — the settings menus draw themselves with this and
   so does this one. */
const PANEL =
  "z-(--z-dropdown) rounded-2xl bg-surface p-2 shadow-[var(--shadow-pop)] outline-none duration-(--motion-enter) ease-(--ease-out) data-closed:duration-(--motion-exit) data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none";

const PILLAR_ICONS: Record<string, LucideIcon> = {
  design: Palette,
  "new-update": Newspaper,
  "creative-things": Shapes,
  "ai-with-design": Sparkles,
};

export function pillarIcon(slug: string | undefined): LucideIcon {
  return (slug && PILLAR_ICONS[slug]) || Layers;
}

type Selection = { pillarId: string; directionId: string };

/** Compact pillar → direction drill-down menu for the composer dock. */
export function PillarDirectionPicker({
  pillars,
  selection,
  open,
  onOpenChange,
  onChange,
  children,
}: {
  pillars: PillarGroup[];
  selection: Selection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (next: Selection) => void;
  children: React.ReactNode;
}) {
  const [activePillarId, setActivePillarId] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const activePillar = pillars.find((pillar) => pillar.id === activePillarId);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      contentRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [activePillarId, open]);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) setActivePillarId(null);
    onOpenChange(nextOpen);
  }

  function choose(next: Selection) {
    onChange(next);
    onOpenChange(false);
  }

  return (
    <DropdownMenuPrimitive.Root open={open} onOpenChange={handleOpenChange} modal={false}>
      <DropdownMenuPrimitive.Trigger asChild>{children}</DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          ref={contentRef}
          /* UPWARD, AND ALLOWED TO MOVE. `side="bottom"` was right when the
             composer floated in the middle of the screen; the dock sits at the
             FOOT of a phone now, so opening downwards put the menu below the
             fold — and `avoidCollisions={false}` was the instruction not to
             correct for exactly that. Both were true of a layout that no
             longer exists.

             ALWAYS UPWARD, THOUGH — never sometimes. Left to decide, Radix
             flips to whichever side has room, and "room" depends on how tall
             the list is: Design has ten directions and opened downward, New
             Update has three and opened up. Same control, same press, the menu
             appearing on a different side each time, and nothing the reader
             did caused it. A menu that moves is a menu you have to find.

             So the side is fixed and the HEIGHT gives instead. Capped to the
             space Radix measured above the trigger, a list that would not have
             fitted scrolls rather than jumping to the other side — which is
             the trade worth making, because a scrollbar is a thing you can see
             and a flip is a thing you can only be surprised by. */
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          avoidCollisions={false}
          /* SEVEN ROWS, THEN IT SCROLLS. A cap in viewport units answers "how
             much screen may this take" — the wrong question for a list, whose
             own unit is the row. At 60svh the menu was a different length on
             every display and on a tall one it never scrolled at all; seven
             rows is the same list everywhere, long enough to take in at a
             glance and short enough that the eighth is obviously below.

             `--radix-…-available-height` stays as the outer bound: seven rows
             is what it WANTS, and on a screen with room for four it takes
             four rather than running off the top. */

          /* THE SETTINGS MENU'S PANEL, exactly — same ground, same radius, same
             shadow, no border. Two dropdowns in one product drawn as two
             different objects is two products. It was a bordered plate with a
             bespoke two-layer shadow and 6px padding; this is the shared one. */
          className={`${PANEL} w-max max-w-[calc(100vw-1.5rem)] overflow-hidden text-ink`}
          aria-label={activePillar ? `${activePillar.name} directions` : "Content direction"}
        >
          {/* THE SCROLL IS INSIDE THE PADDING, NOT ON THE PANEL. With the
              overflow on the panel itself the bar ran down its right edge and
              across both rounded corners — a straight line drawn over a curve
              somebody deliberately put there, and the one part of the menu
              touching its own border. Inset by the panel's own `p-2` it sits
              beside the rows it scrolls, which is what it is for.

              The cap moves here with it: seven rows exactly, since the panel's
              padding is now outside the scrolling box rather than counted into
              it. The available height keeps its bound, less that padding. */}
          <div
            className="overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--border-strong)_transparent]"
            style={{
              maxHeight: `min(calc(${MAX_ROWS} * ${ROW}), calc(var(--radix-dropdown-menu-content-available-height, 100svh) - 1rem))`,
            }}
          >
          {activePillar ? (
            /* The cap lives on the panel, not here: two levels each scrolling
               inside a panel that also scrolls is two scrollbars for one list. */
            <div key={activePillar.id} className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-150">
              <MenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setActivePillarId(null);
                }}
              >
                <ChevronLeft aria-hidden className="size-4 text-ink-3" />
                <span>All pillars</span>
              </MenuItem>
              <DropdownMenuPrimitive.Label className="px-3 pb-1.5 pt-3 text-xs font-semibold text-ink-3">
                {activePillar.name}
              </DropdownMenuPrimitive.Label>
              {activePillar.directions.map((direction) => (
                <MenuItem
                  key={direction.id}
                  onSelect={() => choose({ pillarId: activePillar.id, directionId: direction.id })}
                >
                  <span className="min-w-0 flex-1 leading-snug">{direction.name}</span>
                  {selection.directionId === direction.id && <Check aria-hidden className="size-4 shrink-0 text-accent-press" />}
                </MenuItem>
              ))}
            </div>
          ) : (
            <div key="pillars" className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-2 motion-safe:duration-150">
              <DropdownMenuPrimitive.Label className="px-3 pb-1.5 pt-2 text-xs font-semibold text-ink-3">
                Content direction
              </DropdownMenuPrimitive.Label>
              <MenuItem onSelect={() => choose({ pillarId: "", directionId: "" })}>
                {/* THE SAME MARK THE TRIGGER WEARS, so the row you pick and the
                    disc you end up looking at are recognisably one thing.
                    Filled and unstroked for the same reason it is on the
                    trigger: an outlined four-point star this small closes up
                    into a cross.

                    16 here, not the trigger's 20 — every row below this one
                    carries a 16px icon, and a larger one would push this row's
                    text 4px out of the column they all share. */}
                <Sparkle aria-hidden className="size-4 shrink-0 text-ink-3" fill="currentColor" strokeWidth={0} />
                {/* NO DECK. "Choose the best fit from your input" explained a
                    row whose two words already say it, and it was the only
                    entry in the list with a second line — so the one option
                    that needs no explaining was the one drawn largest. */}
                <span className="min-w-0 flex-1">Auto direction</span>
                {!selection.directionId && <Check aria-hidden className="size-4 shrink-0 text-accent-press" />}
              </MenuItem>
              <DropdownMenuPrimitive.Separator className="my-1 h-px bg-line" />
              {pillars.map((pillar) => {
                const Icon = pillarIcon(pillar.slug);
                const selected = pillar.id === selection.pillarId;
                return (
                  <MenuItem
                    key={pillar.id}
                    onSelect={(event) => {
                      event.preventDefault();
                      setActivePillarId(pillar.id);
                    }}
                  >
                    {/* The pillar holding the current direction is the only row
                        without a check of its own, so it still needs to be
                        distinguishable — full ink against the muted default
                        carries that without spending the accent. */}
                    <Icon aria-hidden className={`size-4 shrink-0 ${selected ? "text-ink" : "text-ink-3"}`} strokeWidth={1.8} />
                    <span className="min-w-0 flex-1 truncate leading-snug">{pillar.name}</span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
                  </MenuItem>
                );
              })}
            </div>
          )}
          </div>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

function MenuItem({ className = "", ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      /* 500, the weight of the pillar pills on the Create page. At 600 the
         menu's rows were heavier than the pills they open from and the list
         read as a column of headings. */
      className={`flex min-h-11 cursor-default select-none items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium outline-none transition-colors data-highlighted:bg-sunken data-disabled:pointer-events-none data-disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}
