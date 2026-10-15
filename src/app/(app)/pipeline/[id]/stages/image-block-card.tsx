"use client";

import { useRef, useState, useTransition } from "react";
import { Brush, ImagePlus, Search, Sparkles, Trash2 } from "lucide-react";
import type { ImageBlock } from "@/lib/direction/image-blocks";
import { BLOCK_ROUTES, effectiveRoute, type BlockRoute } from "@/lib/direction/image-routing";
import type { LabelType } from "@/lib/direction/labels";
import type { BlockImageView } from "@/lib/pipeline/views";
import {
  clearBlockAction,
  fillBlockAction,
  fillCoverAction,
  removeCoverAction,
  uploadBlockImageAction,
  uploadCoverAction,
} from "../block-actions";

/**
 * PREVIEW ONLY: one in-body image block, drawn in place in the draft
 * (proposed article direction).
 *
 * It says what the picture is for, shows the picture once there is one, and
 * offers the four ways to fill it with the type's suggested route first. The
 * editor is never asked about rights: they are recorded automatically (own for
 * generated, drawn and uploaded pictures; licensed for online images, which are
 * credited in References). A
 * route the article's type forbids is shown but cannot be pressed, and says
 * why: the editor should see that a case study never generates, not wonder
 * where the button went.
 */

const ROUTE_LABEL: Record<BlockRoute, string> = { find: "Find", generate: "Generate", draw: "Draw", upload: "Upload" };
const ROUTE_ICON = { find: Search, generate: Sparkles, draw: Brush, upload: ImagePlus } as const;

export function ImageBlockCard({
  projectId,
  block,
  type,
  image,
  locked,
  onImage,
  onRemove,
  onEdit,
  autoWorking = false,
}: {
  /** The first, automatic fill is working on this block right now. */
  autoWorking?: boolean;
  projectId: string;
  block: ImageBlock;
  type: LabelType;
  image: BlockImageView | null;
  /** True while the draft has unsaved edits: the server reads the saved draft. */
  locked: boolean;
  onImage: (blockId: string, image: BlockImageView | null) => void;
  onRemove: (blockId: string) => void;
  /** Inside the editor: change the block's caption or purpose. */
  onEdit?: (block: ImageBlock) => void;
}) {
  /* THE TYPE ONLY SUGGESTS. Its rule chose the first, automatic picture; from
     then on every route is the editor's to use (build session, 2026-10-15). */
  const suggested = effectiveRoute(type, block.suggestedRoute);
  const [busy, setBusy] = useState<BlockRoute | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const status = autoWorking
    ? "Adding a picture…"
    : !image
      ? "Empty: needs a picture"
      : `Filled by ${ROUTE_LABEL[image.route ?? "upload"]}`;

  function fill(route: "find" | "generate" | "draw", prompt?: string) {
    setBusy(route);
    setNote(null);
    setPromptOpen(false);
    startTransition(async () => {
      const result = await fillBlockAction(projectId, block.id, route, prompt);
      setBusy(null);
      if (!result.ok) {
        setNote(result.message);
        return;
      }
      const { image: next, note: why, log } = result.value;
      if (next) onImage(block.id, next);
      const tried = log.judged ? ` Checked ${log.judged}, turned down ${log.rejected}.` : "";
      setNote(why ? `${why}${tried}` : tried.trim() || null);
    });
  }

  function upload(file: File) {
    setBusy("upload");
    setNote(null);
    const data = new FormData();
    data.set("file", file);
    startTransition(async () => {
      const result = await uploadBlockImageAction(projectId, block.id, data);
      setBusy(null);
      if (!result.ok) setNote(result.message);
      else if (result.value.image) onImage(block.id, result.value.image);
    });
  }

  function clearImage() {
    setNote(null);
    startTransition(async () => {
      const result = await clearBlockAction(projectId, block.id);
      if (!result.ok) return setNote(result.message);
      onImage(block.id, null);
      setNote("Image removed. Add a new one with the buttons above.");
    });
  }


  return (
    <figure
      className="not-prose my-8 overflow-hidden rounded-2xl border border-line bg-sunken"
      aria-label={`Image block ${block.id}`}
      data-image-block={block.id}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">
          {block.id} · {block.role ?? "image"}
        </span>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            !image ? "bg-warn-soft text-ink" : "bg-accent-soft text-accent-press"
          }`}
        >
          {status}
        </span>
      </div>

      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- a stored image served by the app's own route
        <img src={image.url} alt={image.alt || block.alt} className="block h-auto w-full bg-white" />
      ) : onEdit ? (
        <div className="grid min-h-28 place-items-center px-6 py-6 text-center text-sm text-ink-3">
          <p>No picture yet. Say what it should show, then Find, Draw or Upload.</p>
        </div>
      ) : (
        <div className="grid min-h-40 place-items-center px-6 py-8 text-center text-sm text-ink-2">
          <p>
            <span className="font-medium text-ink">Purpose:</span> {block.purpose || "Not stated."}
          </p>
        </div>
      )}

      <figcaption className="space-y-1 px-4 pt-3 text-sm text-ink-2">
        {onEdit ? (
          /* INSIDE THE EDITOR THE WORDS ARE EDITABLE TOO: the caption the reader
             sees, and the purpose Find and Draw work from. Saved with the
             article when the field is left. */
          <div className="space-y-2">
            <BlockField
              key={`caption:${block.caption}`}
              label="Caption"
              value={block.caption}
              placeholder="The caption the reader sees under the picture"
              onCommit={(caption) => onEdit({ ...block, caption, alt: block.alt || caption })}
            />
            <BlockField
              key={`purpose:${block.purpose}`}
              label="Purpose"
              value={block.purpose}
              placeholder="What the reader should understand from this picture"
              onCommit={(purpose) => onEdit({ ...block, purpose })}
            />
          </div>
        ) : (
          <p className="text-ink">{block.caption || "No caption yet."}</p>
        )}
        {image?.credit && <p className="text-xs">{image.credit}</p>}
        {image?.sourceUrl && (
          <p className="truncate text-xs">
            Source:{" "}
            <a href={image.sourceUrl} target="_blank" rel="noreferrer" className="underline">
              {image.sourceUrl}
            </a>
          </p>
        )}
        {image && !onEdit && (
          <p className="text-xs">
            <span className="font-medium text-ink">Purpose:</span> {block.purpose}
          </p>
        )}
      </figcaption>

      <div className="flex flex-wrap items-center gap-1.5 px-4 py-3" role="group" aria-label={`Fill ${block.id}`}>
        {BLOCK_ROUTES.map((route) => {
          const Icon = ROUTE_ICON[route];
          const isSuggested = route === suggested;
          return (
            <button
              key={route}
              type="button"
              disabled={pending || locked || autoWorking}
              title={locked ? "Saving the draft first…" : isSuggested ? "Suggested for this block" : undefined}
              aria-pressed={isSuggested}
              onClick={() =>
                route === "upload"
                  ? fileInput.current?.click()
                  : route === "generate"
                    ? setPromptOpen((open) => !open)
                    : fill(route)
              }
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-40 ${
                isSuggested ? "bg-ink text-surface" : "bg-surface text-ink-2 hover:bg-deep"
              }`}
            >
              <Icon aria-hidden className="size-3.5" />
              {busy === route ? `${ROUTE_LABEL[route]}…` : ROUTE_LABEL[route]}
            </button>
          );
        })}
        <button
          type="button"
          disabled={pending}
          /* A FILLED BLOCK LOSES ITS PICTURE AND KEEPS ITS PLACE, so a new one can
             be added there. Only an empty block's Remove takes the slot out of
             the article (build session, 2026-10-15). */
          onClick={() => (image ? clearImage() : onRemove(block.id))}
          className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-2 text-xs font-medium text-ink-2 transition-colors hover:text-danger-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-40"
        >
          <Trash2 aria-hidden className="size-3.5" />
          {image ? "Remove image" : "Remove slot"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) upload(file);
          }}
        />
      </div>
      {promptOpen && <PromptRow onCancel={() => setPromptOpen(false)} onGenerate={(prompt) => fill("generate", prompt)} />}
      {note && (
        <p role="status" className="border-t border-line px-4 py-2.5 text-xs text-ink-2">
          {note}
        </p>
      )}
    </figure>
  );
}

/**
 * PREVIEW ONLY: the cover, at the top of the draft (proposed direction: the
 * steps are Draft and Publish, so the cover is chosen here too). Find,
 * Generate and Upload, as the article's type allows.
 */
export function CoverCard({
  projectId,
  routes,
  image,
  locked,
  onImage,
  autoWorking = false,
}: {
  projectId: string;
  /** The cover routes this type's rule uses; the first is marked as suggested. Every route stays available. */
  routes: BlockRoute[];
  image: BlockImageView | null;
  locked: boolean;
  onImage: (image: BlockImageView | null) => void;
  /** The first, automatic fill is working on the cover right now. */
  autoWorking?: boolean;
}) {
  const [busy, setBusy] = useState<BlockRoute | "remove" | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const COVER_ROUTES: BlockRoute[] = ["find", "generate", "upload"];
  /* ONCE THERE IS A COVER, every button says it replaces it, and Remove takes
     it away: an editor looking at a cover they do not want must see a way out. */
  const label = (route: BlockRoute) =>
    !image ? ROUTE_LABEL[route] : route === "find" ? "Find another" : route === "generate" ? "Generate new" : "Upload new";

  function remove() {
    setBusy("remove");
    setNote(null);
    startTransition(async () => {
      const result = await removeCoverAction(projectId);
      setBusy(null);
      if (!result.ok) return setNote(result.message);
      onImage(null);
      setNote("Removed. Add a new cover with Find, Generate or Upload.");
    });
  }

  function run(route: "find" | "generate" | "upload", file?: File, prompt?: string) {
    setBusy(route);
    setNote(null);
    setPromptOpen(false);
    startTransition(async () => {
      let result;
      if (route === "upload" && file) {
        const data = new FormData();
        data.set("file", file);
        result = await uploadCoverAction(projectId, data);
      } else {
        result = await fillCoverAction(projectId, route as "find" | "generate", prompt);
      }
      setBusy(null);
      if (!result.ok) return setNote(result.message);
      if (result.value.image) onImage(result.value.image);
      setNote(result.value.note ?? null);
    });
  }

  return (
    <figure className="not-prose mb-8 overflow-hidden rounded-2xl border border-line bg-sunken" aria-label="Cover image" data-cover-card="">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Cover</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${image ? "bg-accent-soft text-accent-press" : "bg-warn-soft text-ink"}`}>
          {autoWorking ? "Adding a cover…" : image ? `Chosen: ${image.route?.replace("cover-", "") ?? image.provider}` : "No cover yet"}
        </span>
      </div>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- a stored image served by the app's own route
        <img src={image.url} alt={image.alt || "The article's cover"} className="block h-auto w-full bg-white" />
      ) : (
        <div className="grid min-h-28 place-items-center px-6 py-6 text-center text-sm text-ink-2">
          <p>The cover goes to the Hub with the article.</p>
        </div>
      )}
      {image?.credit && (
        <figcaption className="px-4 pt-3 text-xs text-ink-2">
          {image.credit} (credited in References)
        </figcaption>
      )}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-3" role="group" aria-label="Choose the cover">
        {COVER_ROUTES.map((route) => {
          const Icon = ROUTE_ICON[route];
          return (
            <button
              key={route}
              type="button"
              disabled={pending || locked || autoWorking}
              title={route === routes[0] ? "Suggested for this type" : undefined}
              onClick={() =>
                route === "upload"
                  ? fileInput.current?.click()
                  : route === "generate"
                    ? setPromptOpen((open) => !open)
                    : run("find")
              }
              className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-2 text-xs font-medium text-ink-2 transition-colors hover:bg-deep focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon aria-hidden className="size-3.5" />
              {busy === route ? `${label(route)}…` : label(route)}
            </button>
          );
        })}
        {image && (
          <button
            type="button"
            disabled={pending || locked}
            onClick={remove}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-2 text-xs font-medium text-ink-2 transition-colors hover:text-danger-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-40"
          >
            <Trash2 aria-hidden className="size-3.5" />
            {busy === "remove" ? "Removing…" : "Remove"}
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) run("upload", file);
          }}
        />
      </div>
      {promptOpen && <PromptRow onCancel={() => setPromptOpen(false)} onGenerate={(prompt) => run("generate", undefined, prompt)} />}
      {note && (
        <p role="status" className="border-t border-line px-4 py-2.5 text-xs text-ink-2">
          {note}
        </p>
      )}
    </figure>
  );
}

/** One editable line of a block: kept locally while typed, saved when left. */
function BlockField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
}) {
  // Reset from outside by the parent's `key`, not an effect.
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.replace(/\s+/g, " ").trim();
    if (next !== value) onCommit(next);
  };
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
      {label}
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            (event.target as HTMLInputElement).blur();
          }
        }}
        className="cs-input h-9 rounded-lg bg-surface text-sm font-normal text-ink"
      />
    </label>
  );
}

/** Generate's own box: the editor's words for the picture, or nothing to have them written. */
function PromptRow({ onGenerate, onCancel }: { onGenerate: (prompt: string) => void; onCancel: () => void }) {
  const [prompt, setPrompt] = useState("");
  return (
    <form
      className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row sm:items-center"
      onSubmit={(event) => {
        event.preventDefault();
        onGenerate(prompt);
      }}
    >
      <input
        autoFocus
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="Describe the picture, or leave empty to write it from the article"
        aria-label="Describe the picture to generate"
        className="cs-input h-9 flex-1 rounded-lg bg-surface text-sm"
      />
      <div className="flex gap-2">
        <button type="submit" className="cs-btn h-9 px-3 text-sm">
          Generate
        </button>
        <button type="button" onClick={onCancel} className="cs-btn h-9 px-3 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
