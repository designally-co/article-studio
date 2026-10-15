"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { Brush, ImagePlus, LoaderCircle, Search, Sparkles, Trash2 } from "lucide-react";
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
 * PREVIEW ONLY: the image boxes of the proposed article direction (the cover
 * and the slots in the article), drawn in place in the draft.
 */

const ROUTE_LABEL: Record<BlockRoute, string> = { find: "Find", generate: "Generate", draw: "Draw", upload: "Upload" };
const ROUTE_ICON = { find: Search, generate: Sparkles, draw: Brush, upload: ImagePlus } as const;

/** A pill that sits on top of the picture: readable over any image. */
const ON_IMAGE =
  "inline-flex items-center gap-1.5 rounded-full bg-surface/90 px-3 py-1.5 text-xs font-medium text-ink shadow-[var(--shadow-card)] backdrop-blur-sm";

type BoxAction = {
  route: BlockRoute;
  label: string;
  busy: boolean;
  suggested?: boolean;
  onClick: () => void;
};

/**
 * THE ONE IMAGE BOX, for the cover and for every slot in the article (build
 * session, 2026-10-15: "simplify the image box"). No header, no status tag,
 * no dividers. With a picture: its name sits on the picture's top-left and
 * Remove on its top-right, and the ways to replace it sit under it. Empty:
 * only the ways to fill it, centred in the box. A message appears only when
 * something needs the editor's attention.
 */
function ImageBox({
  name,
  dataAttrs,
  image,
  alt,
  actions,
  disabled,
  working,
  onRemove,
  removeLabel,
  removeBusy,
  children,
  prompt,
  note,
  onFile,
}: {
  name: string;
  dataAttrs: Record<string, string>;
  image: BlockImageView | null;
  alt: string;
  actions: BoxAction[];
  disabled: boolean;
  /** Shown in place of the buttons while the first, automatic fill works on it. */
  working: boolean;
  onRemove?: () => void;
  removeLabel: string;
  removeBusy: boolean;
  children?: ReactNode;
  prompt?: ReactNode;
  note: string | null;
  /** Upload: the box opens its own file picker and hands the file here. */
  onFile: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const buttons = (
    <div className={`flex flex-wrap gap-1.5 ${image ? "" : "justify-center"}`} role="group" aria-label={`Fill the ${name.toLowerCase()}`}>
      {actions.map((action) => {
        const Icon = ROUTE_ICON[action.route];
        return (
          <button
            key={action.route}
            type="button"
            disabled={disabled}
            title={action.suggested ? "Suggested" : undefined}
            aria-pressed={action.suggested}
            onClick={action.route === "upload" ? () => fileInput.current?.click() : action.onClick}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-40 ${
              action.suggested ? "bg-ink text-surface" : "bg-surface text-ink-2 hover:bg-deep"
            }`}
          >
            <Icon aria-hidden className="size-3.5" />
            {action.busy ? `${action.label}…` : action.label}
          </button>
        );
      })}
    </div>
  );
  const removeButton = onRemove && (
    <button type="button" disabled={disabled} onClick={onRemove} className={`${ON_IMAGE} transition-colors hover:text-danger-ink disabled:opacity-40`}>
      <Trash2 aria-hidden className="size-3.5" />
      {removeBusy ? "Removing…" : removeLabel}
    </button>
  );
  const workingLabel = (
    <p className="inline-flex items-center gap-2 text-sm text-ink-2" role="status">
      <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
      Adding a picture…
    </p>
  );

  return (
    <figure className="not-prose my-8 overflow-hidden rounded-2xl bg-sunken" aria-label={name} {...dataAttrs}>
      <div className="relative">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- a stored image served by the app's own route
          <img src={image.url} alt={alt} className="block h-auto w-full bg-white" />
        ) : (
          <div className="grid min-h-52 place-items-center px-6 pb-8 pt-14">{working ? workingLabel : buttons}</div>
        )}
        <span className={`${ON_IMAGE} pointer-events-none absolute left-3 top-3`}>{name}</span>
        {removeButton && <span className="absolute right-3 top-3">{removeButton}</span>}
      </div>
      {image && <div className="px-4 pt-3">{working ? workingLabel : buttons}</div>}
      {prompt}
      {children && <div className="space-y-2 px-4 pt-3 text-sm text-ink-2">{children}</div>}
      {note && (
        <p role="status" className="px-4 pt-3 text-xs text-ink-2">
          {note}
        </p>
      )}
      <div className="h-4" />
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
          if (file) onFile(file);
        }}
      />
    </figure>
  );
}

/**
 * PREVIEW ONLY: one in-body image slot, in place in the draft (proposed
 * article direction). The type's rule chose its first, automatic picture and
 * is marked as the suggested route; every route stays the editor's to use.
 * Rights are never asked: they are recorded automatically.
 */
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
  const suggested = effectiveRoute(type, block.suggestedRoute);
  const [busy, setBusy] = useState<BlockRoute | "remove" | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const slot = block.id.replace(/^img-/, "");

  function fill(route: "find" | "generate" | "draw", prompt?: string) {
    setBusy(route);
    setNote(null);
    setPromptOpen(false);
    startTransition(async () => {
      const result = await fillBlockAction(projectId, block.id, route, prompt);
      setBusy(null);
      if (!result.ok) return setNote(result.message);
      if (result.value.image) onImage(block.id, result.value.image);
      setNote(result.value.image ? null : (result.value.note ?? null));
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

  /* A FILLED SLOT LOSES ITS PICTURE AND KEEPS ITS PLACE; only an empty slot's
     Remove takes it out of the article (build session, 2026-10-15). */
  function remove() {
    if (!image) return onRemove(block.id);
    setBusy("remove");
    setNote(null);
    startTransition(async () => {
      const result = await clearBlockAction(projectId, block.id);
      setBusy(null);
      if (!result.ok) return setNote(result.message);
      onImage(block.id, null);
    });
  }

  const actions: BoxAction[] = BLOCK_ROUTES.map((route) => ({
    route,
    label: ROUTE_LABEL[route],
    busy: busy === route,
    suggested: !image && route === suggested,
    onClick: () => (route === "generate" ? setPromptOpen((open) => !open) : route === "upload" ? undefined : fill(route)),
  }));

  return (
    <ImageBox
      name={`Image ${slot}`}
      dataAttrs={{ "data-image-block": block.id }}
      image={image}
      alt={image?.alt || block.alt}
      actions={actions}
      disabled={pending || locked || autoWorking}
      working={autoWorking}
      onRemove={remove}
      removeLabel={image ? "Remove" : "Remove slot"}
      removeBusy={busy === "remove"}
      onFile={upload}
      note={note}
      prompt={promptOpen ? <PromptRow onCancel={() => setPromptOpen(false)} onGenerate={(prompt) => fill("generate", prompt)} /> : null}
    >
      {onEdit ? (
        /* The caption the reader sees, and the purpose Find, Generate and Draw
           work from. Saved with the article when the field is left. */
        <>
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
        </>
      ) : (
        block.caption && <p className="text-ink">{block.caption}</p>
      )}
      {image?.credit && (
        <p className="text-xs">
          {image.sourceUrl ? (
            <a href={image.sourceUrl} target="_blank" rel="noreferrer" className="underline">
              {image.credit}
            </a>
          ) : (
            image.credit
          )}{" "}
          (credited in References)
        </p>
      )}
    </ImageBox>
  );
}

/**
 * PREVIEW ONLY: the cover, at the top of the draft (proposed direction: the
 * steps are Draft and Publish, so the cover is chosen here too).
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

  function remove() {
    setBusy("remove");
    setNote(null);
    startTransition(async () => {
      const result = await removeCoverAction(projectId);
      setBusy(null);
      if (!result.ok) return setNote(result.message);
      onImage(null);
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
      setNote(result.value.image ? null : (result.value.note ?? null));
    });
  }

  /* With a cover, the buttons say they replace it. */
  const actions: BoxAction[] = (["find", "generate", "upload"] as const).map((route) => ({
    route,
    label: !image ? ROUTE_LABEL[route] : route === "find" ? "Find another" : route === "generate" ? "Generate new" : "Upload new",
    busy: busy === route,
    suggested: false,
    onClick: () => (route === "generate" ? setPromptOpen((open) => !open) : route === "upload" ? undefined : run("find")),
  }));

  return (
    <ImageBox
      name="Cover"
      dataAttrs={{ "data-cover-card": "", "data-suggested-route": routes[0] ?? "" }}
      image={image}
      alt={image?.alt || "The article's cover"}
      actions={actions}
      disabled={pending || locked || autoWorking}
      working={autoWorking}
      onRemove={image ? remove : undefined}
      removeLabel="Remove"
      removeBusy={busy === "remove"}
      onFile={(file) => run("upload", file)}
      note={note}
      prompt={promptOpen ? <PromptRow onCancel={() => setPromptOpen(false)} onGenerate={(prompt) => run("generate", undefined, prompt)} /> : null}
    >
      {image?.credit && <p className="text-xs">{image.credit} (credited in References)</p>}
    </ImageBox>
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
      className="flex flex-col gap-2 px-4 pt-3 sm:flex-row sm:items-center"
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
