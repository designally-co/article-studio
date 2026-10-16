"use client";

import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Brush, ImagePlus, LoaderCircle, Search, Sparkles, Trash2, WandSparkles, X } from "lucide-react";
import type { ImageBlock } from "@/lib/direction/image-blocks";
import { BLOCK_ROUTES, effectiveRoute, type BlockRoute } from "@/lib/direction/image-routing";
import type { LabelType } from "@/lib/direction/labels";
import type { BlockImageView } from "@/lib/pipeline/views";
import {
  clearBlockAction,
  draftBlockPromptAction,
  draftCoverPromptAction,
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

/** An action under way on a picture, for the box to act out. */
type Activity = "find" | "generate" | "draw" | "upload" | "auto" | null;

const ACTIVITY_LABEL: Record<Exclude<Activity, null>, string> = {
  find: "Finding a picture…",
  generate: "Generating a picture…",
  draw: "Drawing a figure…",
  upload: "Uploading…",
  auto: "Adding a picture…",
};

/** The activity for a box: the first, automatic fill, else the button being run. */
function activityOf(autoWorking: boolean, busy: string | null): Activity {
  if (autoWorking) return "auto";
  return busy === "find" || busy === "generate" || busy === "draw" || busy === "upload" ? busy : null;
}

type BoxAction = {
  route: BlockRoute;
  label: string;
  busy: boolean;
  suggested?: boolean;
  onClick: () => void;
};

type Drafted = { ok: true; value: string } | { ok: false; message: string };

/** A name for one fill, so Cancel can stop that fill and no other. */
function newTicket(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The fill under way in one box. Cancel forgets it (and tells the server), so
 * its late answer is dropped; a new fill replaces it the same way.
 */
function useFillTicket(projectId: string) {
  const current = useRef<string | null>(null);
  return useMemo(
    () => ({
      start() {
        const ticket = newTicket();
        current.current = ticket;
        return ticket;
      },
      /** True when this is still the fill the box is waiting for. */
      finish(ticket: string) {
        if (current.current !== ticket) return false;
        current.current = null;
        return true;
      },
      cancel() {
        if (current.current) sendCancel(projectId, current.current);
        current.current = null;
      },
    }),
    [projectId],
  );
}

/* A plain request, not a server action: a page's server actions run one at a
   time, so a Cancel action would wait for the fill it is meant to stop. */
function sendCancel(projectId: string, ticket: string) {
  void fetch(`/api/pipeline/${projectId}/cancel-fill`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
  }).catch(() => undefined);
}

/**
 * THE ONE IMAGE BOX, for the cover and for every slot in the article (build
 * session, 2026-10-15: "simplify the image box"). No header, no status tag,
 * no dividers, no visible name (it read as a button; it stays as the box's
 * accessible name). Everything sits on the picture: the actions bottom-left,
 * Remove top-right, Generate's and Draw's prompt box at the bottom, and,
 * while something runs, what it is and Cancel in the middle. A message
 * appears under it only when something needs the editor's attention.
 */
function ImageBox({
  name,
  dataAttrs,
  image,
  alt,
  actions,
  disabled,
  activity,
  onCancel,
  onRemove,
  removeBusy,
  panel,
  children,
  note,
  onFile,
}: {
  name: string;
  dataAttrs: Record<string, string>;
  image: BlockImageView | null;
  alt: string;
  actions: BoxAction[];
  disabled: boolean;
  /** What is being done to the picture right now, animated in the box; null when nothing is. */
  activity: Activity;
  /** Stops the find, generate or draw under way; absent when nothing can be stopped. */
  onCancel?: () => void;
  onRemove?: () => void;
  removeBusy: boolean;
  /** Generate's or Draw's prompt box, in place of the actions while it is open. */
  panel?: ReactNode;
  children?: ReactNode;
  note: string | null;
  /** Upload: the box opens its own file picker and hands the file here. */
  onFile: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  /* EVERY ACTION SITS ON THE IMAGE, bottom-left, whether there is a picture
     yet or not (build session, 2026-10-15); Remove sits top-right. Pills that
     read over any picture: white glass, the suggested route in ink. */
  const buttons = (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Fill the ${name.toLowerCase()}`}>
      {actions.map((action) => {
        const Icon = ROUTE_ICON[action.route];
        return (
          <button
            key={action.route}
            type="button"
            disabled={disabled}
            title={action.suggested ? `${action.label} (suggested)` : action.label}
            aria-label={action.label}
            aria-pressed={action.suggested}
            onClick={action.route === "upload" ? () => fileInput.current?.click() : action.onClick}
            className={`${ON_IMAGE} transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-60 ${
              action.suggested ? "!bg-ink !text-surface" : "hover:bg-surface"
            }`}
          >
            <Icon aria-hidden className="size-3.5" />
            {/* Icons only on a phone, where four labelled pills cover the picture. */}
            <span className={action.busy ? "" : "hidden sm:inline"}>{action.busy ? `${action.label}…` : action.label}</span>
          </button>
        );
      })}
    </div>
  );
  /* "do not say remove slot, remove image, just say remove" (build session,
     2026-10-15): one word, whatever it takes away. */
  const removeButton = onRemove && (
    <button type="button" disabled={disabled} onClick={onRemove} className={`${ON_IMAGE} transition-colors hover:text-danger-ink disabled:opacity-60`}>
      <Trash2 aria-hidden className="size-3.5" />
      {removeBusy ? "Removing…" : "Remove"}
    </button>
  );
  /* WHILE AN ACTION RUNS, THE PICTURE SAYS WHICH (build session, 2026-10-15):
     the illustration acts it out, over the old picture if there is one, with
     Cancel under it ("finding image must have cancel button"). */
  const acting = activity && (
    <div className="absolute inset-0 grid place-items-center bg-sunken/85 backdrop-blur-[2px]">
      <div className="flex flex-col items-center gap-2">
        <EmptyPicture activity={activity} />
        <p className="-mt-4 text-xs font-medium text-ink-2" role="status">
          {ACTIVITY_LABEL[activity]}
        </p>
        {onCancel && (
          <button type="button" onClick={onCancel} className={`${ON_IMAGE} mt-1 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]`}>
            <X aria-hidden className="size-3.5" />
            Cancel
          </button>
        )}
      </div>
    </div>
  );
  const below = Boolean(children || note);

  return (
    <figure className="not-prose my-8" aria-label={name} {...dataAttrs}>
      <div className="relative overflow-hidden rounded-2xl bg-sunken">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- a stored image served by the app's own route
          <img src={image.url} alt={alt} className={`block h-auto w-full bg-white ${panel ? "min-h-56" : ""} object-cover`} />
        ) : (
          // The empty picture: the same layer, waiting to be filled, with a quiet mark of a picture.
          <div className={`grid w-full place-items-center ${panel ? "min-h-56 aspect-[16/9]" : "aspect-[16/9]"}`}>
            {!panel && <EmptyPicture activity={null} />}
          </div>
        )}
        {acting}
        {!activity && removeButton && <span className="absolute right-3 top-3">{removeButton}</span>}
        {!activity && <div className="absolute bottom-3 left-3 right-3">{panel ?? buttons}</div>}
      </div>
      {below && (
        <div className="mt-3 space-y-2 text-sm text-ink-2">
          {children}
          {note && (
            <p role="status" className="text-xs">
              {note}
            </p>
          )}
        </div>
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
}) {
  const suggested = effectiveRoute(type, block.suggestedRoute);
  const [busy, setBusy] = useState<BlockRoute | "remove" | null>(null);
  const [panel, setPanel] = useState<"generate" | "draw" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const ticket = useFillTicket(projectId);
  const slot = block.id.replace(/^img-/, "");

  async function fill(route: "find" | "generate" | "draw", prompt?: string) {
    const mine = ticket.start();
    setBusy(route);
    setNote(null);
    setPanel(null);
    const result = await fillBlockAction(projectId, block.id, route, prompt, mine);
    // Cancelled, or another fill started since: this answer is no longer wanted.
    if (!ticket.finish(mine)) return;
    setBusy(null);
    if (!result.ok) return setNote(result.message);
    if (result.value.image) onImage(block.id, result.value.image);
    setNote(result.value.image ? null : (result.value.note ?? null));
  }

  function cancel() {
    ticket.cancel();
    setBusy(null);
  }

  async function upload(file: File) {
    setBusy("upload");
    setNote(null);
    const data = new FormData();
    data.set("file", file);
    const result = await uploadBlockImageAction(projectId, block.id, data);
    setBusy(null);
    if (!result.ok) setNote(result.message);
    else if (result.value.image) onImage(block.id, result.value.image);
  }

  /* A FILLED SLOT LOSES ITS PICTURE AND KEEPS ITS PLACE; only an empty slot's
     Remove takes it out of the article (build session, 2026-10-15). */
  async function remove() {
    if (!image) return onRemove(block.id);
    setBusy("remove");
    setNote(null);
    const result = await clearBlockAction(projectId, block.id);
    setBusy(null);
    if (!result.ok) return setNote(result.message);
    onImage(block.id, null);
  }

  const actions: BoxAction[] = BLOCK_ROUTES.map((route) => ({
    route,
    label: ROUTE_LABEL[route],
    busy: busy === route,
    suggested: !image && route === suggested,
    onClick: () => (route === "generate" || route === "draw" ? setPanel(route) : route === "upload" ? undefined : void fill(route)),
  }));

  return (
    <ImageBox
      name={`Image ${slot}`}
      dataAttrs={{ "data-image-block": block.id }}
      image={image}
      alt={image?.alt || block.alt}
      actions={actions}
      disabled={busy !== null || locked || autoWorking}
      activity={activityOf(autoWorking, busy)}
      onCancel={busy === "find" || busy === "generate" || busy === "draw" ? cancel : undefined}
      onRemove={() => void remove()}
      removeBusy={busy === "remove"}
      onFile={(file) => void upload(file)}
      note={note}
      panel={
        panel ? (
          <PromptPanel
            key={panel}
            route={panel}
            onClose={() => setPanel(null)}
            onRun={(prompt) => void fill(panel, prompt)}
            onDraft={() => draftBlockPromptAction(projectId, block.id, panel)}
          />
        ) : null
      }
    >
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
  const [panel, setPanel] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ticket = useFillTicket(projectId);

  async function remove() {
    setBusy("remove");
    setNote(null);
    const result = await removeCoverAction(projectId);
    setBusy(null);
    if (!result.ok) return setNote(result.message);
    onImage(null);
  }

  async function run(route: "find" | "generate" | "upload", file?: File, prompt?: string) {
    const mine = ticket.start();
    setBusy(route);
    setNote(null);
    setPanel(false);
    let result;
    if (route === "upload" && file) {
      const data = new FormData();
      data.set("file", file);
      result = await uploadCoverAction(projectId, data);
    } else {
      result = await fillCoverAction(projectId, route as "find" | "generate", prompt, mine);
    }
    if (!ticket.finish(mine)) return;
    setBusy(null);
    if (!result.ok) return setNote(result.message);
    if (result.value.image) onImage(result.value.image);
    setNote(result.value.image ? null : (result.value.note ?? null));
  }

  function cancel() {
    ticket.cancel();
    setBusy(null);
  }

  /* With a cover, the buttons say they replace it. */
  const actions: BoxAction[] = (["find", "generate", "upload"] as const).map((route) => ({
    route,
    label: !image ? ROUTE_LABEL[route] : route === "find" ? "Find another" : route === "generate" ? "Generate new" : "Upload new",
    busy: busy === route,
    suggested: false,
    onClick: () => (route === "generate" ? setPanel(true) : route === "upload" ? undefined : void run("find")),
  }));

  return (
    <ImageBox
      name="Cover"
      dataAttrs={{ "data-cover-card": "", "data-suggested-route": routes[0] ?? "" }}
      image={image}
      alt={image?.alt || "The article's cover"}
      actions={actions}
      disabled={busy !== null || locked || autoWorking}
      activity={activityOf(autoWorking, busy)}
      onCancel={busy === "find" || busy === "generate" ? cancel : undefined}
      onRemove={image ? () => void remove() : undefined}
      removeBusy={busy === "remove"}
      onFile={(file) => void run("upload", file)}
      note={note}
      panel={
        panel ? (
          <PromptPanel
            route="generate"
            onClose={() => setPanel(false)}
            onRun={(prompt) => void run("generate", undefined, prompt)}
            onDraft={() => draftCoverPromptAction(projectId)}
          />
        ) : null
      }
    >
      {image?.credit && <p className="text-xs">{image.credit} (credited in References)</p>}
    </ImageBox>
  );
}

/**
 * GENERATE'S AND DRAW'S PROMPT, INSIDE THE PICTURE (build session, 2026-10-15:
 * "the generate or draw action must be inside the image box. not under").
 * The editor writes what to make, or presses Write prompt to have it written
 * from the article ("for generate and draw, there must be auto draft prompt
 * function") and changes it before anything is made. Left empty, the prompt
 * is written from the article when the picture is made.
 */
function PromptPanel({
  route,
  onRun,
  onClose,
  onDraft,
}: {
  route: "generate" | "draw";
  onRun: (prompt: string) => void;
  onClose: () => void;
  onDraft: () => Promise<Drafted>;
}) {
  const [prompt, setPrompt] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = ROUTE_ICON[route];
  const plain =
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-60";

  async function draft() {
    setDrafting(true);
    setError(null);
    const result = await onDraft();
    setDrafting(false);
    if (result.ok) setPrompt(result.value);
    else setError(result.message);
  }

  return (
    <form
      className="rounded-2xl bg-surface/95 p-2 shadow-[var(--shadow-card)] backdrop-blur-sm"
      onSubmit={(event) => {
        event.preventDefault();
        onRun(prompt);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <textarea
        autoFocus
        rows={3}
        value={prompt}
        disabled={drafting}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onRun(prompt);
          }
        }}
        placeholder={
          drafting
            ? "Writing a prompt from the article…"
            : route === "generate"
              ? "Describe the picture, or press Write prompt"
              : "Describe the figure, or press Write prompt"
        }
        aria-label={route === "generate" ? "Describe the picture to generate" : "Describe the figure to draw"}
        className="block max-h-32 w-full resize-none bg-transparent px-2 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:outline-none"
      />
      {error && (
        <p role="status" className="px-2 pb-1 text-xs text-danger-ink">
          {error}
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => void draft()} disabled={drafting} className={`${plain} bg-sunken text-ink hover:bg-line`}>
          {drafting ? (
            <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <WandSparkles aria-hidden className="size-3.5" />
          )}
          {drafting ? "Writing…" : prompt ? "Write again" : "Write prompt"}
        </button>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className={`${plain} text-ink-2 hover:bg-sunken hover:text-ink`}>
          Cancel
        </button>
        <button type="submit" disabled={drafting} className={`${plain} bg-ink text-surface hover:opacity-90`}>
          <Icon aria-hidden className="size-3.5" />
          {ROUTE_LABEL[route]}
        </button>
      </div>
    </form>
  );
}

/**
 * The picture not there yet (build session, 2026-10-15: "use interesting
 * graphic for the empty image stage"): three prints stacked at an angle, the
 * front one a hill under an orange sun, framed by a printer's crop marks, the
 * proofing marks of the studio. Drawn in the app's own tokens.
 *
 * It also acts out what is happening ("add the related motion animation for
 * finding the image and also for other actions"): a loupe sweeps the prints
 * while finding, sparks and a shine while generating, the hill drawing itself
 * while drawing, the print rising into place while uploading. Every motion is
 * in CSS and stops when the person has asked for reduced motion.
 */
function EmptyPicture({ activity }: { activity: Activity }) {
  const clip = useId();
  const shine = useId();
  const line = "var(--color-line-strong)";
  const ink = "var(--color-ink-3)";
  const mode = activity ?? "idle";
  return (
    <svg
      aria-hidden
      viewBox="0 0 220 150"
      className="cs-empty-picture -mt-8 h-28 w-auto sm:h-32"
      data-activity={mode}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        <clipPath id={clip}>
          <rect x="66" y="40" width="88" height="56" rx="3" />
        </clipPath>
        <linearGradient id={shine} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* the prints behind */}
      <g className="cs-ep-back-a" transform="rotate(-9 110 78)">
        <rect x="58" y="30" width="104" height="80" rx="6" fill="var(--color-surface)" stroke={line} strokeWidth="1.5" />
      </g>
      <g className="cs-ep-back-b" transform="rotate(7 110 78)">
        <rect x="58" y="30" width="104" height="80" rx="6" fill="var(--color-surface)" stroke={line} strokeWidth="1.5" />
      </g>
      {/* the front print */}
      <g className="cs-empty-picture-front">
        <rect x="58" y="32" width="104" height="80" rx="6" fill="var(--color-surface)" stroke={ink} strokeWidth="1.5" />
        <rect x="66" y="40" width="88" height="56" rx="3" fill="var(--color-sunken)" />
        <g clipPath={`url(#${clip})`}>
          <circle className="cs-ep-sun" cx="134" cy="56" r="8" fill="var(--color-accent)" opacity="0.9" />
          <path className="cs-ep-hill-fill" d="M58 104 L88 66 L104 80 L116 70 L162 104 Z" fill="var(--color-accent-soft)" />
          <path className="cs-ep-hill" pathLength={1} d="M58 104 L88 66 L104 80 L116 70 L162 104" stroke={ink} strokeWidth="1.25" />
          {(mode === "generate" || mode === "auto") && (
            <rect className="cs-ep-shine" x="40" y="36" width="40" height="64" fill={`url(#${shine})`} transform="skewX(-18)" />
          )}
        </g>
        <path d="M74 104 H118" stroke={line} strokeWidth="2" />
      </g>
      {/* crop marks */}
      <g className="cs-ep-crop" stroke={ink} strokeWidth="1.25">
        <path d="M46 26 H38 M50 22 V14" />
        <path d="M174 26 H182 M170 22 V14" />
        <path d="M46 124 H38 M50 128 V136" />
        <path d="M174 124 H182 M170 128 V136" />
      </g>
      {/* a spark: the picture on its way */}
      <path className="cs-empty-picture-spark" d="M186 52 Q188 60 196 62 Q188 64 186 72 Q184 64 176 62 Q184 60 186 52 Z" fill="var(--color-accent)" />
      {mode === "generate" && (
        <>
          <path className="cs-ep-spark-2" d="M40 40 Q41 45 46 46 Q41 47 40 52 Q39 47 34 46 Q39 45 40 40 Z" fill="var(--color-accent)" />
          <path className="cs-ep-spark-3" d="M172 112 Q173 116 177 117 Q173 118 172 122 Q171 118 167 117 Q171 116 172 112 Z" fill="var(--color-accent)" />
        </>
      )}
      {mode === "find" && (
        <g className="cs-ep-loupe">
          <circle cx="110" cy="70" r="13" fill="var(--color-surface)" fillOpacity="0.55" stroke="var(--color-ink-2)" strokeWidth="2.5" />
          <path d="M119.5 79.5 L130 90" stroke="var(--color-ink-2)" strokeWidth="4" />
        </g>
      )}
      {mode === "draw" && (
        <g className="cs-ep-pen">
          <path d="M0 0 L5 -14 L11 -12 L6 2 Z" fill="var(--color-ink-2)" />
          <path d="M0 0 L2 -5 L5 -4 Z" fill="var(--color-accent)" />
        </g>
      )}
      {mode === "upload" && (
        <g className="cs-ep-arrow" stroke="var(--color-accent)" strokeWidth="2.5">
          <path d="M110 22 V4 M102 12 L110 4 L118 12" />
        </g>
      )}
      <circle cx="30" cy="70" r="2.5" fill={line} />
      <circle cx="200" cy="96" r="2" fill={line} />
    </svg>
  );
}
