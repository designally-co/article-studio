"use client";

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { MOTION, duration } from "@/lib/motion";

/* The field clipped to its right end — the width of the search disc it opens
   from — and the field in full. Both round, so the clip keeps the pill's
   shape at every frame between them. */
const AS_DISC = "inset(0% 0% 0% 88% round 999px)";
const IN_FULL = "inset(0% 0% 0% 0% round 999px)";

/**
 * The phone bar's search, opening out of its disc and folding back into it.
 *
 * OPENING GROWS LEFTWARD FROM THE DISC. The field is the disc spread across the
 * line, so it starts where the disc was — clipped to the bar's right end — and
 * uncovers toward the menu button, decelerating into place. The page's name
 * and the disc are gone the moment it opens; the field covers their line.
 *
 * CLOSING FOLDS IT BACK, THEN THE NAME RETURNS. The field accelerates back into
 * the right end, and only once it has gone does the bar hand the line back — so
 * `closeField` takes the state change as a callback rather than making it
 * itself. The name and the disc then settle in, the disc a beat behind.
 *
 * Mark the field's wrapper `data-search-field` and the name and the disc
 * `data-search-rest`; put `barRef` on the element holding both states.
 */
export function useSearchBarMotion(searching: boolean) {
  const barRef = useRef<HTMLDivElement>(null);
  /* The state last animated to. Compared rather than counted, so the first
     render — and React's development double-run of effects — animates
     nothing: a page arriving with its bar already in place is not a bar
     opening. */
  const shown = useRef(searching);

  useLayoutEffect(() => {
    if (shown.current === searching) return;
    shown.current = searching;
    const bar = barRef.current;
    if (!bar) return;

    if (searching) {
      const field = bar.querySelector("[data-search-field]");
      if (!field) return;
      gsap.fromTo(
        field,
        { clipPath: AS_DISC, autoAlpha: 0 },
        {
          clipPath: IN_FULL,
          autoAlpha: 1,
          duration: duration(MOTION.CONTENT),
          ease: MOTION.EASE_ENTER,
          clearProps: "clipPath",
        },
      );
    } else {
      const rest = bar.querySelectorAll("[data-search-rest]");
      if (!rest.length) return;
      gsap.fromTo(
        rest,
        { autoAlpha: 0, y: -4 },
        {
          autoAlpha: 1,
          y: 0,
          duration: duration(MOTION.CONTENT),
          ease: MOTION.EASE_ENTER,
          stagger: duration(MOTION.STAGGER),
          clearProps: "transform,opacity,visibility",
        },
      );
    }
  }, [searching]);

  /** Fold the field back into its disc, then `done` — which closes it. */
  const closeField = (done: () => void) => {
    const field = barRef.current?.querySelector("[data-search-field]");
    if (!field) {
      done();
      return;
    }
    gsap.to(field, {
      clipPath: AS_DISC,
      autoAlpha: 0,
      duration: duration(MOTION.EXIT),
      ease: MOTION.EASE_EXIT,
      overwrite: "auto",
      onComplete: done,
    });
  };

  return { barRef, closeField };
}
