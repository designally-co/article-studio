"use client";

import { useEffect, useState } from "react";
import { WorkArt, type WorkArtKind } from "./work-art";

/**
 * A wait, shown as one line at a time.
 *
 * WHAT IS SHOWN. The step the work is on, a bar that says it is still moving,
 * and the seconds left. Nothing else: the list of every step with a note under
 * each was detail for whoever built the pipeline, not for the editor waiting on
 * it (5 Oct 2026).
 *
 * THE STEPS ADVANCE ON TIME. There is no progress channel back from the server
 * — each wait is one call — so a step names the work being attempted, and the
 * last one holds until the caller unmounts this, never claiming a finish the
 * server has not reached.
 *
 * THE SECONDS ARE AN ESTIMATE, from what the work usually takes. Past it the
 * line says "Almost done" rather than counting below zero, and the bar stays
 * indeterminate throughout (.cs-sweep): a bar parked at 95% is worse than one
 * that never claimed a number.
 */
export type WorkStep = {
  at: number;
  label: string;
  /** A small drawing of the step (components/work-art), smaller in the compact size. */
  art?: WorkArtKind;
};

export function WorkProgress({
  steps,
  typicalSeconds,
  heading,
  size = "regular",
}: {
  steps: readonly WorkStep[];
  /** What the work usually takes. Without it no countdown is shown — for a wait too short to need one. */
  typicalSeconds?: number;
  /** A line above the step, e.g. the article's title. Optional. */
  heading?: string;
  /** `compact` for a side rail; `regular` for a card on its own. */
  size?: "regular" | "compact";
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  let active = 0;
  for (let i = 0; i < steps.length; i++) if (elapsed >= steps[i].at) active = i;
  const step = steps[active]?.label ?? "";
  const art = steps[active]?.art;
  const left = typicalSeconds === undefined ? undefined : Math.max(typicalSeconds - elapsed, 0);
  const remaining =
    left === undefined ? undefined : left > 0 ? `About ${left} second${left === 1 ? "" : "s"} left` : "Almost done…";
  const compact = size === "compact";

  return (
    <div role="status" className="text-center">
      {art && (
        // Keyed, so the next drawing fades in when the step changes.
        <div key={art} className={`cs-step-in ${compact ? "mb-3" : "mb-6"}`}>
          <WorkArt kind={art} width={compact ? 120 : 160} />
        </div>
      )}
      {heading && (
        <p
          className={
            compact
              ? "text-sm font-semibold text-ink"
              : "font-heading text-[length:var(--text-h3)] font-medium leading-snug tracking-tight text-ink"
          }
        >
          {heading}
        </p>
      )}

      {/* Keyed on the step, so each new one fades in rather than swapping. */}
      <p
        key={step}
        className={`cs-step-in font-medium text-accent-press ${compact ? "mt-2 text-sm" : "mt-5 text-base"}`}
      >
        {step}
      </p>

      <span
        className={`block h-[3px] w-full overflow-hidden rounded-full ${compact ? "mt-2.5" : "mx-auto mt-4 max-w-xs"}`}
        style={{ background: "var(--accent-tint)" }}
        aria-hidden="true"
      >
        <span className="cs-sweep block h-full w-1/4 rounded-full" style={{ background: "var(--accent)" }} />
      </span>

      {/* Not announced every second: the step line above is the live news. */}
      {remaining && (
        <p aria-live="off" className={`tabular-nums text-ink-3 ${compact ? "mt-2 text-xs" : "mt-3 text-sm"}`}>
          {remaining}
        </p>
      )}
    </div>
  );
}
