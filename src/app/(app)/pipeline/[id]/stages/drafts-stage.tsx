"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Markdown } from "@/components/markdown";
import { streamNdjson } from "@/lib/ndjson-client";
import { ApiNotReady, RAIL_COLUMN, RAIL_CONTENT, RAIL_GRID, StageShell } from "./stage-shell";
import { ArrowRight, Eye, Pencil, X } from "lucide-react";
import { SHEET_CLEARANCE, StageAction, StageSheet } from "./stage-mobile";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteRevisionAction, goToFinalizeAction, saveDraftContentAction } from "../actions";

const SUGGESTIONS = [
  "Make the introduction shorter",
  "Add more concrete visual details",
  "Make the explanations more practical",
  "Tighten repetitive sections",
];

type Revision = { id: string; userMessage: string; resultMd: string };
type DraftView = {
  id: string | null;
  contentMd: string;
  metricLabel?: string;
  streaming: boolean;
  error?: string | null;
};

export function DraftsStage({
  projectId,
  drafts,
  refinements,
  targetLength,
  anthropicReady,
}: {
  projectId: string;
  drafts: { id: string; variationNo: number; contentMd: string; isSelected: boolean }[];
  refinements: Revision[];
  targetLength: string;
  anthropicReady: boolean;
}) {
  const existing = drafts.find((draft) => draft.isSelected) ?? drafts[0];
  const [draft, setDraft] = useState<DraftView>({
    id: existing?.id ?? null,
    contentMd: existing?.contentMd ?? "",
    streaming: false,
    error: null,
  });
  const [revisions, setRevisions] = useState(refinements);
  const [pickedVersionId, setPickedVersionId] = useState<string | null>(null);
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [dirty, setDirty] = useState(false);
  const [revising, setRevising] = useState(false);
  const [pending, startTransition] = useTransition();
  const autoStarted = useRef(false);
  const editSnapshotSaved = useRef(false);
  const editBase = useRef(existing?.contentMd ?? "");

  /**
   * Add a version, unless we already hold that exact text.
   *
   * A revision saves TWO entries — the text before it and the text after — so
   * revising twice from the same base filed the same "before" content again,
   * and the list grew faster than the number of versions in it. Identical text
   * is not another version.
   */
  function addLocalRevision(label: string, content: string) {
    if (!content.trim()) return;
    setRevisions((current) =>
      current.some((revision) => revision.resultMd === content)
        ? current
        : [...current, { id: crypto.randomUUID(), userMessage: label, resultMd: content }]
    );
  }

  /* The list as VERSIONS: distinct texts, oldest first, whatever the rows
     behind them look like. Existing articles already carry duplicate entries
     from before the dedupe above, and several of them share content — which is
     what made selecting one chip light four. */
  const versions = useMemo(() => {
    const seen = new Set<string>();
    return revisions.filter((revision) => {
      if (!revision.resultMd || seen.has(revision.resultMd)) return false;
      seen.add(revision.resultMd);
      return true;
    });
  }, [revisions]);

  /* Which chip is filled, by IDENTITY. Matching on content lit every version
     holding the same text — four or five at once on an article with duplicate
     rows. Falls back to the first version whose text is on screen, so arriving
     at the stage still shows where you are. */
  const activeVersionId =
    pickedVersionId ?? versions.find((revision) => revision.resultMd === draft.contentMd)?.id ?? null;

  /**
   * Remove a version — every row holding that text, not just the chip's own.
   *
   * A chip stands for a distinct TEXT, and the same text can sit behind several
   * rows: this article has seven refinements carrying two versions between
   * them. Deleting only the row the chip was built from would let the next
   * duplicate take its place, so the version would reappear on reload having
   * been deleted.
   */
  function deleteVersion(revision: Revision) {
    const sameText = revisions.filter((item) => item.resultMd === revision.resultMd);
    const ids = new Set(sameText.map((item) => item.id));
    setRevisions((current) => current.filter((item) => !ids.has(item.id)));
    if (pickedVersionId && ids.has(pickedVersionId)) setPickedVersionId(null);
    startTransition(async () => {
      for (const item of sameText) await deleteRevisionAction(item.id);
    });
  }

  async function generateDraft(regenerating = false) {
    const previous = draft.contentMd;
    if (regenerating && previous.trim()) addLocalRevision("Version before regeneration", previous);
    setDraft((current) => ({ ...current, contentMd: "", streaming: true, error: null, metricLabel: undefined }));
    try {
      let content = "";
      for await (const event of streamNdjson<{ t: string; d?: string; draftId?: string; metricLabel?: string; content?: string; m?: string }>(
        `/api/pipeline/${projectId}/draft`,
        {}
      )) {
        if (event.t === "delta" && event.d) {
          content += event.d;
          setDraft((current) => ({ ...current, contentMd: content }));
        } else if (event.t === "done") {
          // The server may return a sanitized final (e.g. em dashes removed); adopt it.
          if (event.content != null) content = event.content;
          setDraft((current) => ({ ...current, id: event.draftId ?? current.id, contentMd: content, metricLabel: event.metricLabel, streaming: false }));
          editBase.current = content;
        } else if (event.t === "error") {
          setDraft((current) => ({ ...current, contentMd: previous, streaming: false, error: event.m ?? "Draft generation failed." }));
        }
      }
    } catch (reason) {
      setDraft((current) => ({ ...current, contentMd: previous, streaming: false, error: reason instanceof Error ? reason.message : "Draft generation failed." }));
    }
  }

  useEffect(() => {
    if (!anthropicReady || existing || autoStarted.current) return;
    autoStarted.current = true;
    void generateDraft();
    // Initial generation persists server-side and must start once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anthropicReady, existing]);

  useEffect(() => {
    if (!dirty || !draft.id || draft.streaming || revising) return;
    const timer = setTimeout(() => {
      const preserve = !editSnapshotSaved.current;
      if (preserve) {
        addLocalRevision("Version before manual edits", editBase.current);
        editSnapshotSaved.current = true;
      }
      startTransition(() => saveDraftContentAction(draft.id!, draft.contentMd, preserve, "Version before manual edits"));
      setDirty(false);
    }, 900);
    return () => clearTimeout(timer);
  }, [dirty, draft.contentMd, draft.id, draft.streaming, revising]);

  function toggleEditing() {
    setEditing((current) => {
      const next = !current;
      if (next) {
        editBase.current = draft.contentMd;
        editSnapshotSaved.current = false;
      }
      return next;
    });
  }

  async function revise(message: string) {
    const instruction = message.trim();
    if (!instruction || revising || draft.streaming || dirty || pending || !draft.id) return;
    const previous = draft.contentMd;
    addLocalRevision(revisions.length === 0 ? "Original" : `Before: ${instruction}`, previous);
    setInput("");
    setRevising(true);
    setDraft((current) => ({ ...current, error: null }));
    try {
      let content = "";
      for await (const event of streamNdjson<{ t: string; d?: string; content?: string; m?: string }>(
        `/api/pipeline/${projectId}/refine`,
        { message: instruction }
      )) {
        if (event.t === "delta" && event.d) {
          content += event.d;
          setDraft((current) => ({ ...current, contentMd: content }));
        } else if (event.t === "done") {
          if (event.content != null) content = event.content;
          setDraft((current) => ({ ...current, contentMd: content }));
          addLocalRevision(instruction, content);
          setPickedVersionId(null);
          editBase.current = content;
        } else if (event.t === "error") {
          setDraft((current) => ({ ...current, contentMd: previous, error: event.m ?? "Revision failed." }));
        }
      }
    } catch (reason) {
      setDraft((current) => ({ ...current, contentMd: previous, error: reason instanceof Error ? reason.message : "Revision failed." }));
    } finally {
      setRevising(false);
    }
  }

  /**
   * Show a version. Not "restore" it.
   *
   * Restoring took a snapshot of whatever was on screen first, filed as
   * "Version before restore", so looking at an older draft ADDED a row to the
   * list you were looking through — and reading three versions left three
   * entries nobody wrote. Every version in this list is already saved; moving
   * between them is a change of view, and needs to record nothing.
   *
   * `preservePrevious: false` is what says that: set the draft to this text
   * and write no new revision.
   */
  function showVersion(revision: Revision) {
    if (!draft.id || dirty || pending || !revision.resultMd || revision.resultMd === draft.contentMd) return;
    setPickedVersionId(revision.id);
    setDraft((value) => ({ ...value, contentMd: revision.resultMd }));
    editBase.current = revision.resultMd;
    startTransition(() => saveDraftContentAction(draft.id!, revision.resultMd, false));
  }

  function regenerate() {
    void generateDraft(true);
  }

  function continueToImages() {
    const formData = new FormData();
    formData.set("projectId", projectId);
    startTransition(() => goToFinalizeAction(formData));
  }

  if (!anthropicReady) return <StageShell title="Draft & edit"><ApiNotReady /></StageShell>;

  /* ONE DEFINITION, TWO HOMES. The revise tools are a rail panel on a desktop
     and the body of a pull-up sheet on a phone. Written twice they would drift
     apart on the first change; written here they cannot. Each block keeps its
     own `px-5` so its dividers still run edge to edge, which is why the sheet
     takes them `flush`. */
  const cannotContinue =
    !draft.id || !draft.contentMd || draft.streaming || revising || dirty || pending;

  const reviseBody = (
    <>
              <div className="space-y-4 px-5 pb-5">
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void revise(suggestion)}
                      disabled={revising || dirty || pending}
                      className="rounded-full bg-sunken px-3 py-2 text-left text-xs font-medium text-ink-2 transition-colors duration-(--duration-fast) ease-(--ease-spring) hover:bg-accent-soft hover:text-accent-press focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
                <form onSubmit={(event) => { event.preventDefault(); void revise(input); }} className="space-y-2.5">
                  <label htmlFor="revision-instruction" className="sr-only">Revision instruction</label>
                  <textarea id="revision-instruction" value={input} onChange={(event) => setInput(event.target.value)} className="cs-textarea min-h-24 rounded-2xl text-sm" placeholder="Make the typeface descriptions more specific…" />
                  {/* SECONDARY. One orange button to a page, and on this page
                      it is Continue to images — the thing that moves the
                      article forward. Applying a revision keeps you exactly
                      where you are, however often you do it, so it takes the
                      outlined treatment the rest of this rail uses. Two filled
                      oranges made the page ask twice which one was the point. */}
                  <button type="submit" disabled={revising || dirty || pending || !input.trim()} className="cs-btn w-full justify-center">
                    {revising ? "Applying…" : "Apply revision"}
                  </button>
                </form>
              </div>

              {revisions.length > 0 && (
                <div className="max-h-[26rem] overflow-y-auto border-t border-line px-5 py-5">
                  <h4 className="text-sm font-semibold text-ink">Version history</h4>
                  {/* CHIPS, LIKE THE SUGGESTIONS ABOVE THEM. Each version was a
                      block of instruction text with a Restore link that
                      appeared on hover underneath it — a two-step reveal for a
                      list whose whole purpose is to be picked from, and a row
                      three times the height of what it says. They are the same
                      shape as the suggestion chips now: one press, and the one
                      you are on is filled. */}
                  {/* Oldest first, so the original is where you would look for
                      it and the newest is nearest the work. Each chip carries
                      its own remove: a list of versions is only readable if the
                      ones you have finished with can leave it. */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {versions.map((revision, index) => {
                      const showing = revision.id === activeVersionId;
                      const label = index === 0 ? "Original" : revision.userMessage;
                      return (
                        <span
                          key={revision.id}
                          className={`inline-flex max-w-full items-center rounded-full text-xs transition-colors duration-(--duration-fast) ease-(--ease-out) ${
                            showing
                              ? "bg-chrome-active text-ink"
                              : "bg-sunken text-ink-2 hover:bg-deep"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => showVersion(revision)}
                            disabled={dirty || pending || !revision.resultMd}
                            aria-pressed={showing}
                            title={label}
                            className="min-w-0 truncate rounded-full py-2 pl-3 pr-1.5 text-left font-medium hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {label}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteVersion(revision)}
                            disabled={pending}
                            aria-label={`Delete version: ${label}`}
                            className="grid size-6 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:text-danger-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-40 mr-1"
                          >
                            <X aria-hidden className="size-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Last, and separated: everything above changes the draft you
                  have, and this throws it away for a new one. */}
              <div className="border-t border-line px-5 py-4">
                {/* RED, BECAUSE IT DESTROYS THE DRAFT. Everything else in this
                    rail changes the article and leaves the previous text a chip
                    away; this throws the current draft out and writes a new one
                    from scratch. It kept the same outline as Apply revision,
                    which said the two were the same kind of act. */}
                <button
                  type="button"
                  onClick={() => setConfirmingRegenerate(true)}
                  disabled={draft.streaming || revising || dirty || pending}
                  className="cs-btn w-full justify-center border-danger/30 text-danger-ink hover:bg-danger-soft"
                >
                  {draft.streaming ? "Writing…" : "Regenerate the draft"}
                </button>
              </div>
    </>
  );

  return (
    <StageShell title="Draft & edit" wide>
      {/* THE SAME LAYOUT AS IMAGES AND PUBLISH — the article in the middle, the
          360px rail at the container's right edge (see RAIL_GRID) — so the action sits in
          one place across the pipeline instead of moving from a bar under the
          article to a panel beside it between stages. An article reads at a
          measure, so its track is the narrowest of the three.

          The rail is permanent. It used to appear only when the revisions
          drawer opened, which meant asking to see revisions reflowed the whole
          page and narrowed the article you were reading. Revisions drop INTO
          the rail now; the layout does not move. */}
      <div className={`${RAIL_GRID} lg:[--rail-content:52rem] ${SHEET_CLEARANCE}`}>
        {/* Tray and plate. The article is the product on this screen, so it is
            seated as an object rather than boxed by a header and footer strip. */}
        {/* The plate and the line that reports on it. Wrapped, because the grid
            gives this column one child and the status now sits outside the
            article rather than in its header. */}
        <div className={RAIL_CONTENT}>
        <article className="cs-bezel motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-4 motion-safe:duration-500">
          <div className="cs-bezel-core relative">
            {/* NO TITLE HERE. "Article draft" sat in 20px semibold at the top of
                the plate, directly under a progress row whose current step says
                Draft — the same fact, twice, in the two places you look first.
                What is left is the one control, so the header is the control.

                AND IT OVERLAYS, TAKING NO WIDTH AT ALL. Out of the flow it
                stopped being a 64px band across the top of the plate, but the
                body was still holding a wider right margin so no line could run
                under it — which is the same reservation moved sideways, and it
                showed as a permanent empty gutter down the right of every
                article. The column is symmetric now and the button floats over
                it, with a fill of its own so it stays legible above whatever
                passes beneath. */}
            <header className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
              {/* ONE ACTION ON THE ARTICLE, and it is the one that changes how
                  you are looking at it. Revisions and Regenerate were sitting
                  here too, so the panel's toolbar held a view toggle, a drawer
                  latch and a destructive rewrite at identical weight. Both of
                  the others act on the DRAFT rather than the view, and both now
                  live in the rail where the drafting tools are.

                  THE NAME DOES NOT CHANGE WITH THE ICON. It is a toggle, so the
                  state belongs in `aria-pressed`, not in a label that renames
                  itself — a button called "Preview" that is pressed reads as a
                  preview that is switched on, which is the opposite of what it
                  does. The icon shows where pressing takes you; the title says
                  it in words for anyone hovering. */}
              <button
                type="button"
                onClick={toggleEditing}
                disabled={!draft.contentMd || draft.streaming || revising}
                /* A DISC, like the rail's collapse toggle and the phone's menu
                   button — the shape this product gives a control that floats
                   over something rather than sitting in a row with others. It
                   carries its own fill and hairline because it now has article
                   text passing beneath it; `cs-tool` is drawn for a toolbar,
                   where the surface behind it is known to be empty. */
                className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-surface/90 text-ink-2 shadow-[var(--shadow-card)] backdrop-blur-sm transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-sunken aria-pressed:text-ink"
                aria-pressed={editing}
                aria-label="Edit the Markdown"
                title={editing ? "Preview the article" : "Edit the Markdown"}
              >
                {editing ? <Eye aria-hidden className="size-4" /> : <Pencil aria-hidden className="size-4" />}
              </button>
            </header>

            {draft.error && <p className="mb-2 mx-5 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger sm:mx-8" role="alert">{draft.error}</p>}

            {editing ? (
              /* The editor takes the same right margin as the article, so the
                 textarea stops short of the button rather than running under a
                 control you cannot click through. */
              <div className="px-5 pb-8 pt-5 sm:px-8 sm:pt-8">
                <textarea value={draft.contentMd} onChange={(event) => { setDraft((current) => ({ ...current, contentMd: event.target.value })); setDirty(true); }} className="cs-textarea min-h-[38rem] rounded-2xl text-sm leading-relaxed" aria-label="Article Markdown" />
              </div>
            ) : (
              /* LEFT, NOT CENTRED. `mx-auto` split the leftover width evenly, so
                 on a wide plate the first word sat a long way in from an edge
                 the article is otherwise aligned to — and nowhere near the
                 distance it sits from the top. It begins at the plate's own
                 margin now, the same 20 (32 above `sm`) in both directions, and
                 keeps `max-w` for the line length rather than for the position.
                 Separate `pl`/`pr` rather than `px` plus an override: two
                 utilities setting the same side resolve by emission order, not
                 by the order they are written in. */
              <div className="min-h-[38rem] max-w-[74ch] px-5 pb-16 pt-5 sm:px-8 sm:pb-24 sm:pt-8">
                {draft.contentMd ? <Markdown>{draft.contentMd}</Markdown> : <p className="py-20 text-center text-sm text-ink-2">Preparing the article…</p>}
                {(draft.streaming || revising) && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-full bg-accent align-text-bottom motion-reduce:animate-none" />}
              </div>
            )}
          </div>
        </article>

        {/* UNDER THE PLATE, WHERE A CAPTION GOES. This was the plate's subtitle,
            which put "Saved · Target 300–500 words" — a target you are working
            towards and a save that has already happened — above the article, in
            the position that introduces it. It reports on the thing, so it
            reads after it. */}
        <p className="mt-3 px-1 text-sm text-ink-3" aria-live="polite">
          {draft.streaming
            ? "Writing draft…"
            : revising
              ? "Applying revision…"
              : dirty || pending
                ? "Saving…"
                : draft.contentMd
                  ? `Saved · Target ${targetLength}`
                  : `Target ${targetLength}`}
        </p>
        </div>

        {/* top-32, the offset Publish already used. At top-6 the rail
            slid under the sticky stepper before it caught, which reads as
            the column moving rather than holding. */}
        {/* 72px: clear of the stepper, which occupies 0–60 when stuck, and
            still ABOVE where this column naturally starts (108). An offset
            below that start — top-32 was 128 — makes sticky snap the rail down
            twenty pixels at rest, so the two columns begin on different lines
            before anything has been scrolled. */}
        {/* THE RAIL IS A DESKTOP IDEA. On a phone it stacked under a four
            thousand pixel article, which put the button that leaves the stage
            below every word of it. Its two panels become a corner button and a
            pull-up sheet instead — same content, no vertical cost. */}
        <div className={`hidden space-y-6 lg:block lg:sticky lg:top-[4.5rem] ${RAIL_COLUMN}`}>
          <section className="cs-bezel">
            <div className="cs-bezel-core p-5">
              {/* NAME THE WORK, IN THE VERB THE READER WOULD USE. "Next step"
                  named the panel rather than the step, and was the heading on
                  this stage AND the one after it — the most prominent words in
                  the rail, identical on both, saying nothing either time.
                  "Images come next" fixed the second half and not the first: it
                  still announced a sequence instead of handing you a job.

                  Every panel in this rail is titled by what you do in it —
                  Revise, Brand check — so this one is too. It names the next
                  stage's WORK rather than repeating the button underneath it,
                  which already says where the button goes. */}
              <h3 className="font-heading text-[length:var(--text-h3)] font-medium tracking-tight text-ink">
                Add a cover image
              </h3>
              {/* Says why the button is unavailable rather than just being grey:
                  a disabled control with no explanation reads as broken when you
                  cannot see that a save is still in flight.

                  And when it IS available it answers the question people
                  actually have with a hand over that button — whether moving on
                  closes the draft for editing. It does not. The old line spent
                  itself repeating the heading instead. */}
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                {draft.streaming
                  ? "The draft is still being written."
                  : revising
                    ? "The revision is still being applied."
                    : dirty || pending
                      ? "Saving your edits."
                      : !draft.contentMd
                        ? "There is no draft to carry forward yet."
                        : "Saved. You can come back and edit it later."}
              </p>
              <button
                type="button"
                onClick={continueToImages}
                disabled={cannotContinue}
                className="cs-cta mt-4 w-full"
              >
                Continue to images
              </button>
            </div>
          </section>

          {/* SHOWN, NOT LATCHED. Revising is what this stage is FOR — the
              article is already written by the time you arrive — so the tools
              for it were behind a toggle that had to be found first, and the
              rail beside the article sat empty until you did. */}
          <aside
            className="cs-bezel"
            aria-label="AI revisions and version history"
          >
            <div className="cs-bezel-core">
              <div className="px-5 pb-4 pt-5">
                <h3 className="font-heading text-[length:var(--text-h3)] font-medium tracking-tight text-ink">Revise</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">One focused change at a time.</p>
              </div>

              {reviseBody}
            </div>
          </aside>
        </div>

        {/* The rail's two panels, for a screen with no room for a rail. The
            action carries no label, so its name lives in `aria-label` and its
            tooltip; the sheet is titled the same as the panel it replaces. */}
        <StageAction label="Continue to images" onClick={continueToImages} disabled={cannotContinue}>
          <ArrowRight aria-hidden className="size-5" />
        </StageAction>
        <StageSheet title="Revise" subtitle="One focused change at a time." flush>
          {reviseBody}
        </StageSheet>

        {/* A window.confirm was doing this — the browser's own dialog, with the
            page's title in it and an OK button, for the one action here that
            cannot be undone. */}
        <ConfirmDialog
          title="Regenerate the draft?"
          description="The current draft is replaced by a new one. Saved versions stay in the history."
          confirmLabel="Regenerate"
          open={confirmingRegenerate}
          onCancel={() => setConfirmingRegenerate(false)}
          onConfirm={() => {
            setConfirmingRegenerate(false);
            regenerate();
          }}
        />
      </div>
    </StageShell>
  );
}
