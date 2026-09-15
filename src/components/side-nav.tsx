"use client";

import Link from "next/link";

import { FlatMark } from "@/app/mark";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";

import { MOTION, duration } from "@/lib/motion";
import { ArrowLeft, Menu, PanelLeftClose, X } from "lucide-react";
import { PAGE_ACTION_BUTTON_QUIET, PAGE_CLOSE_BUTTON } from "./page-bar";
import { AccountMenu } from "./account-menu";
import { SettingsSheet } from "./settings/settings-sheet";
import type { SettingsSection } from "./settings/sections";
import {
  IconNew,
  IconLibrary,
  IconRoutine,
} from "./icons";

/* Three destinations, and they are all places you do work. Settings was a
   fourth row here and is not a destination — it is the drawer you open while
   working somewhere else, so it moved into the account menu at the foot of the
   rail. */
const NAV = [
  { href: "/", label: "Create", icon: IconNew, exact: true },
  /* AN ARTICLE IS A LIBRARY ITEM, so the rail says Library while you are in
     one. `/pipeline/<id>` matched none of the three destinations, which left
     the menu showing a list with nothing current on it for the route people
     spend the most time on — every row equally unselected, as though the
     article were nowhere. It is not a fourth destination; it is where Library
     leads. */
  { href: "/library", label: "Library", icon: IconLibrary, exact: true, owns: "/pipeline/" },
  // A routine publishes to a live site with nobody reading it first, and the
  // page itself refuses anyone else — so the link is not offered either.
  { href: "/routines", label: "Routines", icon: IconRoutine, exact: false, adminOnly: true },
];

/** Routes that open with the panel out of the way. */
const COLLAPSED_ROUTES = new Set(["/"]);

/* `useLayoutEffect` on the client, `useEffect` on the server — React warns
   about the former during SSR, and the drawer's opening position has to be set
   BEFORE the browser paints or the panel flashes at x=0 for a frame on its way
   to sliding in from off-screen. */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function SideNav({
  email,
  isAdmin = false,
}: {
  email: string;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  /* An article's pipeline, where the phone's corner button goes back instead of
     opening the navigation. */
  const inPipeline = pathname.startsWith("/pipeline/");
  const [open, setOpen] = useState(false);
  /* PRESENCE, SEPARATE FROM INTENT. `open` is what the reader asked for;
     `mounted` is whether the panel is still in the tree. They came apart the
     moment the drawer got an exit animation: closing has to keep the markup
     alive until the panel has finished leaving, or there is nothing left to
     watch leave. Adjusted during render rather than in an effect — React's own
     answer for state derived from other state, and the pattern the search box
     on Library already uses. */
  const [mounted, setMounted] = useState(false);
  if (open && !mounted) setMounted(true);
  const panelRef = useRef<HTMLElement>(null);

  /* Off-screen before the first paint, so the slide starts from outside the
     display rather than appearing in place and then jumping left. */
  useIsomorphicLayoutEffect(() => {
    if (!mounted || !panelRef.current) return;
    gsap.set(panelRef.current, { xPercent: -100 });
  }, [mounted]);

  /* IN FROM THE LEFT, OUT THE WAY IT CAME. The drawer is reached by a button on
     the left edge, so the left edge is where it lives when it is not here —
     travel from anywhere else would be a claim about geography that the button
     contradicts.

     The rows follow the panel rather than arriving with it, and overlap it by
     just over half: the panel is most of the way home before they begin, so the
     eye reads one movement with a grain to it rather than two things happening
     at once. `-14px` is a hint of the same direction, not a second slide.

     Only on the way in. Leaving, the panel takes its contents with it as one
     object — staggering an exit makes a reader wait for a list to finish
     dismantling itself after they have already said they are done with it. */
  useEffect(() => {
    if (!mounted || !panelRef.current) return;
    const panel = panelRef.current;
    const rows = panel.querySelectorAll("[data-stagger]");
    const timeline = gsap.timeline();

    if (open) {
      timeline.to(panel, {
        xPercent: 0,
        duration: duration(MOTION.ENTER),
        ease: MOTION.EASE_ENTER,
      });
      timeline.fromTo(
        rows,
        { x: -14, autoAlpha: 0 },
        {
          x: 0,
          autoAlpha: 1,
          duration: duration(MOTION.CONTENT),
          ease: MOTION.EASE_ENTER,
          stagger: duration(MOTION.STAGGER),
        },
        `-=${duration(MOTION.ENTER) * 0.55}`,
      );
    } else {
      timeline.to(panel, {
        xPercent: -100,
        duration: duration(MOTION.EXIT),
        ease: MOTION.EASE_EXIT,
        // The unmount rides on the tween rather than on a timer, so the markup
        // is removed exactly when the panel has finished leaving — not a frame
        // before, and not still sitting there afterwards.
        onComplete: () => setMounted(false),
      });
    }

    return () => {
      timeline.kill();
    };
  }, [open, mounted]);
  // Which settings section is showing, or null for closed. Held here rather
  // than in the menu so the sheet outlives the menu that opened it — a menu
  // closes on select, and a sheet mounted inside one would close with it.
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  // The route decides the opening state and nothing else ever does: only the
  // toggle moves the panel after that. A sidebar that reflows when you follow
  // a link makes the link feel like it did something other than navigate, and
  // the width change costs more attention than the labels are worth.
  const [collapsed, setCollapsed] = useState(() => COLLAPSED_ROUTES.has(pathname));
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <>
      {/* NOT A HEADER ANY MORE — A BUTTON THAT STAYS PUT.
          This was a 64px bar in the chrome grey with a bottom rule, carrying
          the mark and "Content Studio" beside the hamburger. It named the app
          to somebody already inside it, on the smallest screen the app has,
          above every page whose first line is its own title — so the top of a
          phone read "Content Studio / Everything on the desk."

          What is left is the one thing the bar existed to hold. It still sits
          in the flow and still sticks, because a menu button you have to
          scroll back up to find is a menu button you cannot reach; but it is
          on the page's own ground with no rule under it, so there is no second
          surface up there, just a control. */}
      {/* AS WIDE AS THE BUTTON, NOT AS WIDE AS THE SCREEN. It still claims a
          48px line in the flow — that is what keeps it off the top of every
          page — but only the button's own width of it, which leaves the rest of
          that line for whatever the page wants to put there. The pipeline puts
          its stepper there, pulled up alongside.

          NO FILL OF ITS OWN. It had one, to hide a step scrolling past behind
          it — but the row now fades to nothing at that end on its own, and an
          opaque 64px block sitting in a bar that blurs whatever passes under it
          was the one square of the design where the page stopped showing
          through. The button's own disc is what keeps the icon legible. */}
      <div className="sticky top-0 z-(--z-nav) flex h-12 w-fit shrink-0 items-center px-3 lg:hidden">
        {inPipeline ? (
          /* INSIDE AN ARTICLE THE CORNER GOES BACK. The pipeline is a place you
             came into from somewhere — the Library, Create — and on a phone the
             way out of it is the way you came, not the whole app's navigation.
             Back through history when there is one; to the Library when the
             article was opened straight from a link, where there is nothing to
             go back to. The same disc as the menu it replaces. */
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) router.back();
              else router.push("/library");
            }}
            className={PAGE_ACTION_BUTTON_QUIET}
            aria-label="Go back"
          >
            <ArrowLeft aria-hidden className="size-5" />
          </button>
        ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          /* A CIRCLE, AND THE SAME ONE THE RAIL'S OWN TOGGLE IS. That control
             straddles the sidebar edge on a desktop and is drawn exactly this
             way — --border-strong, the page's ground, a card's shadow. This is
             the same job on a smaller screen, so it is not a second design. */
          /* 44px, unlike the steps beside it. That was the right call to refuse
             for a progress indicator you rarely press; this is the only way to
             reach the rest of the app from a phone, it is pressed constantly,
             and it sits in the top corner where a thumb is least accurate. */
          /* The same disc as Library's search, from the same constant — both
             are quiet controls sitting over content that scrolls underneath
             them, and both need an edge to be a shape rather than a gap. The
             shadow it used to carry does not come back with the hairline: one
             or the other states the edge, and two made it the heaviest thing
             on the screen for a control pressed twice a session. */
          className={PAGE_ACTION_BUTTON_QUIET}
          aria-label="Open navigation"
          aria-expanded={open}
          aria-controls="mobile-navigation"
        >
          <Menu aria-hidden className="size-5" />
        </button>
        )}
      </div>

      {mounted && (
        /* ON THE NAV'S OWN LAYER, NOT THE BACKDROP'S. The drawer is the rail,
           folded away — and the account menu at its foot is set one step above
           the rail so it can clear it. At --z-backdrop the drawer outranked
           its own menu: pressing the account row on a phone lit the trigger
           and painted the menu underneath the panel, so Brand, Content and
           Sign out were never reachable from a small screen. Sheets and
           dialogs sit two steps up and still cover it. */
        <div className="fixed inset-0 z-(--z-drawer) lg:hidden">
          <aside
            ref={panelRef}
            id="mobile-navigation"
            /* THE WHOLE SCREEN, AND NO SCRIM BEHIND IT. This was a 17rem panel
               over a dimmed page, which is the right shape when what is behind
               it still matters — but nothing here is a preview of the page you
               came from, and a sliver of dimmed work at the right edge was an
               invitation to tap the one part of the screen that does nothing
               but dismiss. Full bleed states it plainly: this is navigation,
               you are in it, and the way out is the button where the way in
               was. The scrim came out with the gutter it lived in; Escape and
               the close button are the two ways back, and both are explicit.

               No border and no shadow either — both drew the edge of a panel
               that no longer has one. */
            /* THE PAGE'S OWN GROUND, not the rail's. `bg-chrome` is the colour
               of a panel beside the work; at full screen there is no work
               beside it, and the close disc — a grey a single step off chrome —
               went invisible on it. On the app ground the drawer reads as a
               screen you navigated to, and every surface the close button
               appears on is now the same colour under it. */
            className="relative flex h-full w-full flex-col bg-bg"
            aria-label="Mobile navigation"
            role="dialog"
            aria-modal="true"
          >
            <div data-stagger className="flex h-16 items-center justify-between gap-3 border-b border-line pl-7 pr-4">
              <MobileBrand />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                /* THE SAME DISC AS EVERY OTHER CLOSE IN THE APP, from the one
                   constant, so the drawer's and the sheets' cannot drift. A
                   square-cornered ghost button was the only rounded-lg thing
                   on a surface of pills. */
                className={PAGE_CLOSE_BUTTON}
                aria-label="Close navigation"
              >
                <X aria-hidden className="size-5" />
              </button>
            </div>
            <NavLinks pathname={pathname} isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
            <div data-stagger className="shrink-0 border-t border-line px-4 pb-4 pt-3">
              <AccountMenu
                email={email}
                isAdmin={isAdmin}
                onOpenSettings={(section) => {
                  // The drawer goes first. Leaving it open behind the sheet
                  // would put a full-height panel under a modal and hand back
                  // a covered screen when the sheet closes.
                  setOpen(false);
                  setSettings(section);
                }}
              />
            </div>
          </aside>
        </div>
      )}

      <aside
        // z-(--z-nav) both lifts the nav over a route's sticky header and gives
        // the overhanging toggle a stacking context of its own to live in.
        /* THE ONE PIECE OF STRUCTURAL MOTION THAT IS DESKTOP-ONLY, so it takes
           the module's timing like everything else. `--duration-base` is 200ms
           — the number hover states and colour changes use — and a rail 240px
           wide folding to 80 is not a hover state. `--motion-enter` is the
           length a surface takes to arrive, which is what this is: the rail
           arriving at a different size. */
        className={`relative z-(--z-nav) hidden min-h-dvh shrink-0 self-stretch border-r border-line-strong bg-chrome transition-[width] duration-(--motion-enter) ease-(--ease-out) lg:block ${
          collapsed ? "w-20" : "w-60"
        }`}
      >
        <div className="sticky top-0 flex h-dvh flex-col">
        {/* The brandmark holds one position across both states — only the
            wordmark beside it appears and disappears, so collapsing reads as
            the panel narrowing rather than as the logo jumping.

            ON THE TABS' OWN EDGE. The rail pads its list by 16 and each row
            pads its icon by another 12, so every destination icon starts at 28
            — and the logo, padded once at 16, started 12px to their left. One
            vertical line runs down the panel now instead of two. Collapsed,
            both were already centred in the same 80px. */}
        <div className={`flex h-16 shrink-0 items-center ${collapsed ? "justify-center px-0" : "gap-3 pl-7 pr-3"}`}>
          {collapsed ? (
            /* THE LOGO IS THE WAY BACK. Collapsed, the rail is 80px of icons
               and the brandmark is the only thing in it that does nothing —
               while the control that would widen it was hanging off the
               outside edge, half on the rail and half on the page, which is
               the one place a button belongs to neither. Pressing the mark is
               what people try first anyway.

               `aria-expanded` and a name, because "logo" is not an affordance
               a screen reader can infer. */
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-expanded={false}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="grid size-12 place-items-center rounded-xl transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-chrome-hover focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
            >
              <FlatMark size={32} />
            </button>
          ) : (
            <>
              <FlatMark size={32} />
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[var(--tracking-caps)] text-ink-3">
                  Designally
                </p>
                <p className="font-heading text-base font-medium tracking-tight text-ink">
                  Article Studio
                </p>
              </div>
              {/* INSIDE THE RAIL, ON THE BRAND'S OWN LINE. It used to straddle
                  the right edge on a `-right-5` offset — a disc that belonged
                  to neither surface, needed its own border to be legible
                  against both, and moved with the rail's width. Here it is a
                  control in a panel, like every other control in the panel.

                  Transparent at rest: the rail is already `--chrome`, and a
                  filled disc on it would be the loudest thing in a column
                  whose job is to be quiet. It fills on hover. */}
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-expanded
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="ml-auto grid size-10 shrink-0 place-items-center rounded-full text-ink-2 transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-chrome-active hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
              >
                <PanelLeftClose aria-hidden className="size-4" />
              </button>
            </>
          )}
        </div>
        <div className={`h-px shrink-0 bg-line ${collapsed ? "mx-3" : "mx-4"}`} />

        <NavLinks pathname={pathname} isAdmin={isAdmin} collapsed={collapsed} />

        {/* NavLinks takes the slack, so this sits on the floor of the rail
            whether there are three destinations or thirty. */}
        <div className={`shrink-0 border-t border-line pb-4 pt-3 ${collapsed ? "px-2" : "px-4"}`}>
          <AccountMenu
            email={email}
            isAdmin={isAdmin}
            collapsed={collapsed}
            onOpenSettings={setSettings}
          />
        </div>
        </div>
      </aside>

      {/* Mounted outside both panels: the sheet belongs to the app, not to the
          rail that happened to open it. */}
      {settings && (
        <SettingsSheet section={settings} onClose={() => setSettings(null)} />
      )}
    </>
  );
}
function MobileBrand() {
  return (
    /* THE RAIL'S LOCKUP, NOT A SMALLER COUSIN OF IT. The drawer had the mark
       and one line of 13px type; the rail has the mark, "Designally" over the
       product name, and both start on the tabs' own vertical line at 28. Two
       different brand blocks for the same brand, and the phone got the lesser
       one — which mattered more once the drawer went full screen and became
       the only thing on the display. Same gap, same sizes, same eyebrow. */
    <div className="flex min-w-0 items-center gap-3">
      <FlatMark size={32} />
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[var(--tracking-caps)] text-ink-3">
          Designally
        </p>
        <p className="truncate font-heading text-base font-medium tracking-tight text-ink">
          Article Studio
        </p>
      </div>
    </div>
  );
}

function NavLinks({ pathname, isAdmin, onNavigate, collapsed = false }: { pathname: string; isAdmin: boolean; onNavigate?: () => void; collapsed?: boolean }) {
  return (
    <nav className={`flex-1 space-y-1 overflow-y-auto py-4 ${collapsed ? "px-2" : "px-4"}`} aria-label="Primary navigation">
      {NAV.filter((item) => !item.adminOnly || isAdmin).map(({ href, label, icon: Icon, exact, owns }) => {
          const active =
            (owns !== undefined && pathname.startsWith(owns)) ||
            (exact
              ? pathname === href
              : pathname === href || pathname.startsWith(href + "/"));
          return (
            <Link
              key={href}
              href={href}
              /* Part of the drawer's opening stagger. Inert on the desktop
                 rail, which never animates — the attribute is only ever
                 queried from inside the drawer's own panel. */
              data-stagger
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              title={collapsed ? label : undefined}
              // Collapsed rows are square and centred. A full-width pill behind
              // a lone centred icon reads as a mis-sized target, not a state.
              /* ONE DIFFERENCE, NOT FOUR. The current row used to change its
                 fill, its ink, its weight AND its icon colour all at once —
                 four signals for one fact. It changes surface and nothing
                 else: same ink, same weight, same icon as every row beside it,
                 sitting on a grey two steps down from the rail. Hover is the
                 step between, so the pointer reads as a preview of selection
                 rather than as a different idea. */
              /* THE ROUTINE CARD'S TITLE, EXACTLY: the heading family at 500.
                 The label had been inheriting the body font, so the rail was
                 set in Poppins while every name it points at is set in
                 Zalando — a destination and the thing it names, in two
                 different voices. Tracking is left alone: the card's title
                 carries `tracking-tight` and that is a 22px decision, not one
                 to repeat at 14. */
              className={`flex min-h-12 items-center rounded-xl font-heading text-base font-medium text-ink transition-colors duration-(--duration-fast) ease-(--ease-out) ${collapsed ? "mx-auto size-12 justify-center px-0" : "gap-3 px-3"} ${
                active ? "bg-chrome-active" : "hover:bg-chrome-hover"
              }`}
            >
              {/* OPTICALLY BALANCED WITH THE LABEL, NOT NOMINALLY EQUAL TO IT.
                  The icons are drawn 1.6 thick on a 24 grid and rendered at 20,
                  so what reaches the screen is 1.33px — which sat level with a
                  500-weight label and reads thin beside a heavier one. A stem
                  and a stroke are the same mark to the eye, and if one is
                  lighter the row looks like a label somebody drew an icon next
                  to rather than one thing.

                  1.75 on the grid lands at ~1.46 on screen, against a 500 stem
                  at 14px. Stated here rather than in the icons themselves:
                  they are 1.6 everywhere else in the product, beside text that
                  has not changed. */}
              <Icon className="text-ink" width={20} height={20} strokeWidth={1.75} />
              <span className={collapsed ? "sr-only" : ""}>{label}</span>
            </Link>
          );
        })}
    </nav>
  );
}

