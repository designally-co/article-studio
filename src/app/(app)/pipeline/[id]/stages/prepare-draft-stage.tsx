"use client";

import { useEffect, useRef, useState } from "react";
import { WorkProgress } from "@/components/work-progress";
import { useRouter } from "next/navigation";
import type { SelectedTopic } from "@/db/schema";
import { ApiNotReady, StageShell } from "./stage-shell";
import { prepareSimpleArticleAction } from "../actions";

/**
 * The pause between choosing a topic and reading a draft: one source check and
 * an outline, then straight on to stage 4.
 *
 * This used to carry a second copy of the topic picker as well. Topics are now
 * chosen on the home surface before a project exists, so every project arrives
 * here already holding one and that branch was unreachable — verified against
 * the database before removing it. The stepper folds this into Draft & edit
 * rather than numbering it, because it is automatic and cannot be returned to.
 */

/**
 * What the preparation moves through, on elapsed time (see WorkProgress), and
 * what a typical run takes. One line at a time is shown, not the list.
 */
const PHASES = [
  { at: 0, label: "Reading your topic", art: "reading" },
  { at: 3, label: "Researching sources", art: "research" },
  { at: 15, label: "Planning the article", art: "outline" },
  { at: 27, label: "Starting the draft", art: "writing" },
] as const;

const TYPICAL_SECONDS = 35;

function DraftProgress({ title }: { title: string }) {
  return (
    /* Centred, because nothing sits beside it: there is nothing to act on yet. */
    <div className="cs-bezel mx-auto max-w-xl">
      <div className="cs-bezel-core px-6 py-9 sm:px-10 sm:py-11">
        <WorkProgress steps={PHASES} typicalSeconds={TYPICAL_SECONDS} heading={title} />
      </div>
    </div>
  );
}

export function PrepareDraftStage({
  projectId,
  selected,
  anthropicReady,
}: {
  projectId: string;
  selected: SelectedTopic | null;
  anthropicReady: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const started = useRef(false);

  async function prepareDraft() {
    setError(null);
    try {
      const result = await prepareSimpleArticleAction(projectId);
      // The action reports failure as data rather than throwing, because a
      // thrown server-action error is redacted in production and arrives as a
      // sentence about Server Components that names nothing.
      if (!result.ok) {
        setError(result.message);
        started.current = false;
        return;
      }
      // The action persists the outline and bumps the project to stage 4, but
      // no longer redirects — a server-action redirect throws NEXT_REDIRECT,
      // which this try/catch would swallow and leave the page stuck.
      router.replace(`/pipeline/${projectId}?stage=4`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not prepare the draft.");
      started.current = false;
    }
  }

  useEffect(() => {
    if (!anthropicReady || !selected || started.current) return;
    started.current = true;
    void prepareDraft();
    // Preparation persists each completed phase server-side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anthropicReady, projectId, selected]);

  if (!anthropicReady) return <StageShell title="Draft"><ApiNotReady /></StageShell>;

  // Defensive only: no project reaches this stage without a topic, but a blank
  // screen would be the worst possible way to find out otherwise.
  if (!selected) {
    return (
      <StageShell title="Draft" description="This article has no topic yet.">
        <p className="text-sm leading-relaxed text-ink-2">
          Start it again from Create and it will come straight through to the draft.
        </p>
      </StageShell>
    );
  }

  // The failed run replaces the progress rail rather than sitting under it: a
  // rail that keeps animating beneath an error reads as still working.
  if (error) {
    return (
      <StageShell title="Draft" wide>
        <div className="cs-bezel mx-auto max-w-2xl">
          <div className="cs-bezel-core px-6 py-7 sm:px-8 sm:py-9">
            <h3 className="font-heading text-[length:var(--text-h3)] font-medium tracking-tight text-ink">
              The draft did not start
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-ink-2">{error}</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-3">
              Nothing was lost — your topic is saved and this can be run again.
            </p>
            <button
              type="button"
              onClick={() => {
                started.current = true;
                void prepareDraft();
              }}
              className="cs-btn cs-btn-primary mt-6"
            >
              Try again
            </button>
          </div>
        </div>
      </StageShell>
    );
  }

  return (
    <StageShell title="Draft" wide>
      <DraftProgress title={selected.title} />
    </StageShell>
  );
}
