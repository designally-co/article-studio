"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ExternalLink, LoaderCircle, Maximize2, Minimize2, Send, X } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { CopyButton } from "@/components/copy-button";
import { DropdownMenu } from "radix-ui";
import { RAIL_COLUMN, RAIL_CONTENT, RAIL_GRID, StageShell } from "./stage-shell";
import {
  STAGE_ACTION_SLOT,
  StageAction,
  StageSheet,
} from "./stage-mobile";
import { countMetrics } from "@/lib/text";
import { withReference } from "@/lib/outline";
import { markdownToPlainText } from "@/lib/plain";
import { type PublishMetadata } from "@/lib/publish-meta";
import {
  generateImagePromptAction,
  reviewBrandAlignmentAction,
  saveDraftContentAction,
} from "../actions";
import { publishToHubAction, ensurePublishDekAction } from "../publish-actions";
import { HubArticlePreview, HubPreviewFrame } from "./hub-article-preview";
import {
  generateImagesAction,
  deleteGeneratedImageAction,
  deleteImageReferenceAction,
  findReferenceImagesAction,
  coverFromReferenceAction,
  setCoverImageAction,
  updateCoverCreditAction,
  uploadImageReferenceAction,
} from "../image-actions";
import { IconDownload, IconTrash } from "@/components/icons";
import { ImageSettingsMenu, ReferenceMenu } from "./image-dock-menus";
import { AccentOrb } from "@/components/accent-orb";
import type { ImageAspectRatio } from "@/lib/image/providers";
import type { GeneratedImageView, UploadedReferenceView } from "@/lib/pipeline/views";
import type { CoverCredit } from "@/db/schema";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MAX_FOUND_REFERENCES } from "@/lib/image/reference-policy";
import type { BrandReviewResult } from "@/lib/brand-review";
import { type ArticleVisualBrief, type ImagePromptVariant } from "@/lib/image/visual-brief";

type ImageModelOption = {
  optionId: string;
  label: string;
  provider: string;
  model: string;
  /** Pairs a text-to-image entry with the editing entry in the same line. */
  family: string;
  strengths: string;
  capabilities: {
    aspectRatios: readonly ImageAspectRatio[];
    referenceImages: boolean;
    referenceImagesRequired?: boolean;
    maxReferenceImages: number;
    maxVariations: number;
  };
  indicativePricePerImage: number;
};

/**
 * How tall the image prompt grows before it scrolls and offers to expand.
 * Lower than the home composer's, because this dock is anchored to the bottom
 * of a page whose subject is the images above it — an auto-drafted prompt is
 * long enough to take a third of the viewport at the shared cap. Must match the
 * `max-h-40` on the field itself.
 */
const PROMPT_COLLAPSED_MAX = 160;

/* IN LINES ON A PHONE, NOT PIXELS. The screen there is the whole budget, and
   an auto-drafted prompt is the longest text on the stage: at the 160px cap
   the collapsed field took seven lines and the picture above it shrank to a
   thumbnail; let out, it took the rest. Four lines closed is enough to see
   what was written and that there is more; eight open is enough to read a
   paragraph and still leaves the picture room. Both must match the `lh`
   values on the field's classes, and the 4px is its own bottom padding. */
const PROMPT_LINES_COLLAPSED = 4;
const PROMPT_LINES_EXPANDED = 8;
const PROMPT_FIELD_PADDING = 4;

function isWideStage() {
  return window.matchMedia("(min-width: 64rem)").matches;
}
function promptLine(field: HTMLTextAreaElement) {
  return parseFloat(getComputedStyle(field).lineHeight) || 22;
}
/** The closed cap in px: four lines on a phone, the constant above `lg`. */
function promptCollapsedMax(field: HTMLTextAreaElement) {
  if (isWideStage()) return PROMPT_COLLAPSED_MAX;
  return Math.round(PROMPT_LINES_COLLAPSED * promptLine(field) + PROMPT_FIELD_PADDING);
}
/** The open cap in px: eight lines on a phone, unbounded above `lg`. */
function promptExpandedMax(field: HTMLTextAreaElement) {
  if (isWideStage()) return Infinity;
  return Math.round(PROMPT_LINES_EXPANDED * promptLine(field) + PROMPT_FIELD_PADDING);
}

/**
 * How tall a lone generated image is allowed to be.
 *
 * Applied as a max-*width* derived from the image's own ratio, not as a
 * max-height: a height cap fights the aspect-ratio box, and with `object-cover`
 * it crops — so a square was being trimmed at exactly the moment the editor is
 * deciding whether to publish it. Driving from height also keeps a 1:1 and a
 * 16:9 at the same visual weight instead of one towering over the other.
 */
const FEATURE_MAX_HEIGHT = 460;

export function PublishStage({
  projectId,
  title,
  publish,
  draftId,
  longForm,
  draftMd,
  coverImageUrl,
  coverAspectRatio,
  coverImageId,
  coverCredits,
  initialDek,
  published,
  images,
  imageReferences,
  imageConfig,
  options,
  initialView,
  anthropicReady,
  hubConfigured,
  publishedHubUrl,
  publishedHubAdminUrl,
  autoFindReferences,
}: {
  projectId: string;
  /** Article title — the masthead headline in the Hub preview. */
  title: string;
  /** Category (pillar) + tags (direction) for the external platform. */
  publish: PublishMetadata;
  draftId: string;
  longForm: boolean;
  draftMd: string;
  /** Cover image (first generated image) shown in the preview, if any. */
  coverImageUrl: string | null;
  /** Cover width / height — drives the hero's 50% overflow in the preview. */
  coverAspectRatio: number;
  /** The image that will travel to the Hub, already resolved by the route. */
  coverImageId: string | null;
  /** Credits owed for covers that are photographs, by image id. */
  coverCredits: Record<string, CoverCredit>;
  /** Cached dek, if one was generated on a previous visit. */
  initialDek: string | null;
  /** Whether the article is live on the Knowledge Hub. */
  published: boolean;
  images: GeneratedImageView[];
  /** References already attached to this article, from an earlier visit. */
  imageReferences: UploadedReferenceView[];
  imageConfig: { optionId: string; count: number; aspectRatio: string };
  options: ImageModelOption[];
  initialView: "images" | "complete";
  anthropicReady: boolean;
  /** Whether HUB_BASE_URL + HUB_API_KEY are set on the server. */
  hubConfigured: boolean;
  /** Existing Knowledge Hub URL if this article was already published there. */
  publishedHubUrl?: string;
  /** The same article in the Hub's CMS, where a draft can actually be seen. */
  publishedHubAdminUrl?: string;
  /** Look for reference photographs on arrival, once. The page decides when. */
  autoFindReferences: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const showCompletion = requestedView === "complete" || (!requestedView && initialView === "complete");

  function show(view: "images" | "complete") {
    router.replace(`/pipeline/${projectId}?stage=6&view=${view}`, { scroll: false });
  }

  if (showCompletion) {
    return (
      <StageShell title="Publish" wide hideHeader>
        <PublishComposer
          projectId={projectId}
          title={title}
          publish={publish}
          /* With the cover's credit where the Hub will list it, when the cover
             is someone's photograph — see `withReference`. */
          draftMd={
            coverImageId && coverCredits[coverImageId]
              ? withReference(draftMd, coverCredits[coverImageId])
              : draftMd
          }
          coverImageUrl={coverImageUrl}
          coverAspectRatio={coverAspectRatio}
          initialDek={initialDek}
          published={published}
          anthropicReady={anthropicReady}
          hubConfigured={hubConfigured}
          publishedHubUrl={publishedHubUrl}
          publishedHubAdminUrl={publishedHubAdminUrl}
        />
      </StageShell>
    );
  }

  return (
    <StageShell title="Generate images" wide flushBottom>
      <div>
        <ArticlePanel
          projectId={projectId}
          title={title}
          draftId={draftId}
          longForm={longForm}
          draftMd={draftMd}
          images={images}
          imageReferences={imageReferences}
          defaultOptionId={imageConfig.optionId}
          defaultCount={imageConfig.count}
          defaultAspectRatio={imageConfig.aspectRatio}
          options={options}
          anthropicReady={anthropicReady}
          autoFindReferences={autoFindReferences}
          coverImageId={coverImageId}
          coverCredits={coverCredits}
          tab="images"
          onNext={() => show("complete")}
        />
      </div>
    </StageShell>
  );
}

function ArticlePanel({
  projectId,
  title,
  draftId,
  longForm,
  draftMd,
  images,
  imageReferences,
  defaultOptionId,
  defaultCount,
  defaultAspectRatio,
  options,
  anthropicReady,
  coverImageId,
  coverCredits,
  autoFindReferences,
  tab,
  onNext,
}: {
  projectId: string;
  /** Only the images tab shows it; the content tab has the article itself. */
  title: string;
  draftId: string;
  longForm: boolean;
  draftMd: string;
  images: GeneratedImageView[];
  imageReferences: UploadedReferenceView[];
  defaultOptionId: string;
  defaultCount: number;
  defaultAspectRatio: string;
  options: ImageModelOption[];
  anthropicReady: boolean;
  coverImageId: string | null;
  coverCredits: Record<string, CoverCredit>;
  autoFindReferences: boolean;
  tab: "content" | "images";
  onNext: () => void;
}) {
  if (!draftMd) {
    return (
      <section className="cs-card overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <h3 className="font-heading text-[length:var(--text-h3)] font-medium tracking-tight text-ink">Final content</h3>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm text-ink-3">No draft was selected.</p>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      {tab === "content" ? (
        <>
      <ContentPanel draftId={draftId} draftMd={draftMd} longForm={longForm} />
          <div className="sticky bottom-0 flex justify-end border-t border-line bg-bg/95 py-4 backdrop-blur">
            <button type="button" onClick={onNext} className="cs-btn-primary">Continue to images</button>
          </div>
        </>
      ) : (
        <>
      <ImagePanel
        projectId={projectId}
        title={title}
        existing={images}
        initialReferences={imageReferences}
        defaultOptionId={defaultOptionId}
        defaultCount={defaultCount}
        defaultAspectRatio={defaultAspectRatio}
        options={options}
        anthropicReady={anthropicReady}
        autoFindReferences={autoFindReferences}
        coverImageId={coverImageId}
        coverCredits={coverCredits}
        onNext={onNext}
      />
        </>
      )}
    </div>
  );
}

/** The whole piece in one block — read it rendered, or edit the raw Markdown. */
function ContentPanel({
  draftId,
  draftMd,
  longForm,
}: {
  draftId: string;
  draftMd: string;
  longForm: boolean;
}) {
  const [md, setMd] = useState(draftMd);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [dirty, setDirty] = useState(false);
  const [saving, startSave] = useTransition();

  // Debounced autosave of edited text back to the selected draft.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      startSave(() => saveDraftContentAction(draftId, md));
    }, 900);
    return () => clearTimeout(t);
  }, [md, dirty, draftId]);

  const metrics = countMetrics(md);
  // Draft's editor shows a read time beside the count. Thai has no word
  // spacing, so estimate from characters there and from words elsewhere.
  const readMins = Math.max(
    1,
    Math.round(metrics.isThai ? metrics.chars / 400 : metrics.words / 200)
  );

  return (
    <section className="cs-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4">
        <span className="inline-flex h-6 items-center rounded-full bg-accent-soft px-2.5 font-heading text-xs font-medium text-accent-press">
          Draft
        </span>
        <span className="num text-[length:var(--text-sm)] text-ink-3">
          {metrics.label} · ~{readMins} min read
        </span>
        <span className="text-xs text-ink-3" aria-live="polite">{saving ? "Saving…" : dirty ? "Saved" : ""}</span>
        <div className="flex flex-1 justify-end gap-2">
          <button
            type="button"
            onClick={() => setMode((m) => (m === "edit" ? "preview" : "edit"))}
            className="cs-btn !h-9 text-sm"
          >
            {mode === "edit" ? "Preview" : "Edit"}
          </button>
          <CopyButton text={md} label="Copy Markdown" className="cs-btn !h-9 text-sm" />
          <CopyButton
            text={markdownToPlainText(md)}
            label="Copy plain text"
            className="cs-btn !h-9 text-sm"
          />
        </div>
      </div>
      {mode === "edit" ? (
        <div className="px-5 py-5">
          <textarea
            value={md}
            onChange={(e) => {
              setMd(e.target.value);
              setDirty(true);
            }}
            className={`cs-textarea text-sm ${longForm ? "min-h-[36rem]" : "min-h-[16rem]"}`}
          />
        </div>
      ) : (
        <div className={`overflow-y-auto px-6 py-5 ${longForm ? "max-h-[46rem]" : "max-h-[32rem]"}`}>
          <Markdown>{md}</Markdown>
        </div>
      )}
    </section>
  );
}

function ImagePanel({
  projectId,
  title,
  existing,
  initialReferences,
  defaultOptionId,
  defaultCount,
  defaultAspectRatio,
  options,
  anthropicReady,
  coverImageId,
  coverCredits,
  autoFindReferences,
  onNext,
}: {
  projectId: string;
  title: string;
  existing: GeneratedImageView[];
  initialReferences: UploadedReferenceView[];
  defaultOptionId: string;
  defaultCount: number;
  defaultAspectRatio: string;
  options: ImageModelOption[];
  anthropicReady: boolean;
  coverImageId: string | null;
  coverCredits: Record<string, CoverCredit>;
  autoFindReferences: boolean;
  onNext: () => void;
}) {
  const requestedOption = options.find((option) => option.optionId === defaultOptionId);
  /* A REFERENCE-CAPABLE MODEL BY DEFAULT. `options[0]` is registry order, which
     put a text-to-image model in the dock and made "supports text-to-image
     only" the first thing the stage said about itself. What the editor is
     usually doing here is making a picture FOR an article that already exists,
     and the reference models are the ones that can look at it.

     A saved choice on the project still wins; this is only the fallback. Note
     that these models also REQUIRE a reference, so the dock opens asking for
     one — which the Reference menu answers from the article in a press. */
  const initialOption =
    requestedOption ??
    options.find((option) => option.capabilities.referenceImages) ??
    options[0];
  const initialOptionId = initialOption?.optionId ?? "";
  const requestedInitialRatio = (defaultAspectRatio || "1:1") as ImageAspectRatio;
  const initialRatio = initialOption?.capabilities.aspectRatios.includes(requestedInitialRatio)
    ? requestedInitialRatio
    : initialOption?.capabilities.aspectRatios[0] ?? "1:1";
  const [prompt, setPrompt] = useState("");
  /*
   * The set Auto-draft produced, and the exact text it put in the field.
   *
   * Keeping both is what lets the editor's own words win: while the field still
   * holds `draftedPrompt`, the whole set is sent and each image carries a
   * different concept. The moment they change a word, that edit is the brief
   * and it governs every image — silently generating three other concepts
   * beside it would be ignoring what they just wrote.
   */
  const [variants, setVariants] = useState<ImagePromptVariant[]>([]);
  const [draftedPrompt, setDraftedPrompt] = useState("");
  // Designally house style is the official default; users can override it below.
  const [visualBrief, setVisualBrief] = useState<ArticleVisualBrief | null>(null);
  const [optionId, setOptionId] = useState(initialOptionId);
  const [count, setCount] = useState(
    Math.min(Math.max(defaultCount, 1), initialOption?.capabilities.maxVariations ?? 1)
  );
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>(initialRatio);
  /*
   * A set, not one image.
   *
   * The edit models accept ten and fourteen; this stage offered one, which was
   * the whole of what an editor could ground a generation in. Now that
   * references can also be FOUND — from the sources the article cites, and
   * from an open-licence pool — a set is the natural unit, and each member has
   * to be individually removable because nobody chose them by hand.
   */
  const [references, setReferences] = useState<UploadedReferenceView[]>(initialReferences);
  const [uploading, setUploading] = useState(false);
  const [finding, setFinding] = useState(false);
  /*
   * Which photograph the generation matches.
   *
   * Null means "the first", so the set works before anybody chooses and keeps
   * working when the chosen one is removed. Storing an id rather than an index
   * survives removal without silently pointing at a different picture.
   */
  const [chosenReferenceId, setChosenReferenceId] = useState<string | null>(null);
  const [findNote, setFindNote] = useState<string | null>(null);
  const [imgs, setImgs] = useState<GeneratedImageView[]>(existing);
  const [busy, setBusy] = useState<"prompt" | "gen" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [promptNeedsExpansion, setPromptNeedsExpansion] = useState(false);
  // Optimistic: the route resolves the cover on reload, but the choice has to
  // register the instant it is clicked or the control feels broken.
  const [chosenCoverId, setChosenCoverId] = useState<string | null>(coverImageId);
  /* A PHOTOGRAPH CAN BE THE COVER. The credit each one is owed, by image id,
     and the reference waiting on the editor's word that it may be published —
     see @/lib/pipeline/sourced-cover for why an open licence needs no such
     word and everything else does. */
  const [credits, setCredits] = useState<Record<string, CoverCredit>>(coverCredits);
  const [permissionFor, setPermissionFor] = useState<UploadedReferenceView | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  /* How far the phone's sheet has risen. The stage does not scroll, so the
     content moves by exactly that much rather than being covered — a tuned
     constant clears a sheet holding two thumbnails and hides the dock behind
     one holding six. Declared with the other hooks: this component returns
     early further down, and a hook after that runs on some renders and not
     others. */
  const [sheetLift, setSheetLift] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  /* THE ROOM THE PICTURE HAS, MEASURED. On a phone the stage is a clipped
     box, the dock takes what it needs from the bottom and the title from the
     top, and the picture gets what is left — which the constant cap below
     knows nothing about. A square capped at 460 was 342 tall on a 390 phone
     and centred in a slot half that, so it ran over the title above and
     under the dock below. The slot is observed and its height handed down as
     the cap instead; the dock growing (a long prompt, a reference row) makes
     the picture smaller, never the other way round. Above `lg` the page
     grows and the constant is the cap again. */
  const featureAreaRef = useRef<HTMLDivElement>(null);
  const [featureRoom, setFeatureRoom] = useState<number | null>(null);
  useEffect(() => {
    const area = featureAreaRef.current;
    if (!area) return;
    const wide = window.matchMedia("(min-width: 64rem)");
    const measure = () => {
      if (wide.matches) {
        setFeatureRoom(null);
        return;
      }
      const styles = getComputedStyle(area);
      const room = area.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
      setFeatureRoom(Math.max(0, Math.floor(room)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    wide.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      wide.removeEventListener("change", measure);
    };
  }, []);
  const selectedOption = useMemo(
    () => options.find((option) => option.optionId === optionId) ?? options[0],
    [optionId, options]
  );
  /*
   * What this model will actually accept.
   *
   * The set belongs to the article; how much of it can be sent belongs to the
   * model. A text-to-image entry takes none of it, and the editing entries cap
   * at ten and fourteen. Slicing here rather than at the server keeps what the
   * editor is told and what is sent as the same number.
   */
  /*
   * ONE photograph, never four.
   *
   * The editing endpoints accept ten and fourteen because they are built to
   * COMPOSITE — hand them four unrelated photographs and they blend the
   * subjects. That is the opposite of "make a picture like this one", where a
   * single clear example is the entire instruction. The rest of the set stays
   * attached and visible; it is simply not sent, and the dock says so.
   */
  const chosenReference = useMemo(
    () => references.find((item) => item.id === chosenReferenceId) ?? references[0] ?? null,
    [references, chosenReferenceId]
  );
  const usableReferences = useMemo(
    () =>
      selectedOption?.capabilities.referenceImages && chosenReference ? [chosenReference] : [],
    [chosenReference, selectedOption]
  );
  /** The chosen photograph — credited whether or not this model can send it. */
  const activeReference = chosenReference;
  /** The editing entry in the same model line, which is the one that takes references. */
  const referenceCapableSibling = useMemo(
    () =>
      options.find(
        (option) =>
          option.family === selectedOption?.family && option.capabilities.referenceImages
      ) ?? options.find((option) => option.capabilities.referenceImages),
    [options, selectedOption]
  );
  // Untouched since Auto-draft wrote it, so the other concepts still apply.
  const usingDraftedSet = variants.length > 1 && prompt === draftedPrompt;
  // Drafted for fewer images than are now requested — the extra slots repeat
  // the first concept unless the set is written again.
  const conceptsBehindCount = usingDraftedSet && count > variants.length;

  // Measured from the value, not from `onInput`. Auto-draft sets the prompt
  // programmatically, and `onInput` only fires for user typing — so the longest
  // prompts on this stage, the generated ones, never triggered a measurement and
  // the expand control never appeared. Keying on `prompt` covers both sources.
  // The write happens inside the frame callback rather than the effect body, so
  // it is not a synchronous setState in an effect.
  useEffect(() => {
    const field = promptRef.current;
    if (!field) return;
    const frame = requestAnimationFrame(() => {
      field.style.height = "auto";
      const collapsedMax = promptCollapsedMax(field);
      const needsExpansion = field.scrollHeight > collapsedMax;
      setPromptNeedsExpansion(needsExpansion);
      field.style.height = `${Math.min(field.scrollHeight, promptExpanded ? promptExpandedMax(field) : collapsedMax)}px`;
    });
    return () => cancelAnimationFrame(frame);
  }, [prompt, promptExpanded]);

  function selectModel(nextOptionId: string) {
    const next = options.find((option) => option.optionId === nextOptionId);
    setOptionId(nextOptionId);
    if (!next) return;
    if (!next.capabilities.aspectRatios.includes(aspectRatio)) {
      setAspectRatio(next.capabilities.aspectRatios[0] ?? "1:1");
    }
    // The references are not deleted — they stay on the article, and picking a
    // model that can use them again brings them straight back. Silently
    // discarding found material because of a dropdown would be the wrong
    // trade.
    if (!next.capabilities.referenceImages) setFindNote(null);
    setCount((current) => Math.min(current, next.capabilities.maxVariations));
  }

  async function uploadReference(file: File) {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const uploaded = await uploadImageReferenceAction(projectId, formData);
      setReferences((current) => [...current, uploaded]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reference upload failed.");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setUploading(false);
    }
  }

  /**
   * Attach references drawn from the article's own cited sources, and from an
   * open-licence pool where those come up short.
   *
   * Switching the model afterwards is deliberate. Only the editing endpoints
   * accept a reference, so finding four images and leaving a text-to-image
   * model selected would present the editor with material the next click
   * silently ignores. The swap is announced rather than hidden.
   */
  async function findReferences() {
    setFinding(true);
    setError(null);
    setFindNote(null);
    try {
      const result = await findReferenceImagesAction(projectId, {
        // `photoQuery` describes the SITUATION — "designer working at desk
        // laptop" — which is what a stock library can actually answer. The
        // subject and named subjects returned pictures OF the topic: a logo, a
        // screenshot, a product page. Falls back to them only when no brief has
        // been drafted yet.
        query:
          visualBrief?.photoQuery?.trim() || undefined,
      });
      setReferences(result.references);
      const notes: string[] = [];
      if (result.note) notes.push(result.note);
      if (
        result.references.length > 0 &&
        !selectedOption?.capabilities.referenceImages &&
        referenceCapableSibling
      ) {
        setOptionId(referenceCapableSibling.optionId);
        setCount((current) => Math.min(current, referenceCapableSibling.capabilities.maxVariations));
        notes.push(`Switched to ${referenceCapableSibling.label}, which is the model that reads references.`);
      }
      setFindNote(notes.join(" ") || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not look for reference images.");
    } finally {
      setFinding(false);
    }
  }

  /* FOUND ON ARRIVAL WHEN NOBODY CHOSE THE TOPIC. An article that started from
     a suggestion — a shortcut card, a generated idea, a routine — reaches this
     stage without anyone having thought about its picture, so the same search
     the Find item runs starts by itself, once. The server records that it ran,
     so removing what it found does not bring the search back next visit. */
  const autoFound = useRef(false);
  useEffect(() => {
    if (!autoFindReferences || !anthropicReady) return;
    if (!options.some((option) => option.capabilities.referenceImages)) return;
    /* Started from a timer callback rather than the effect body, so the search's
       own state updates are not a synchronous setState in an effect. The guard
       is inside the callback too: in development React mounts, cleans up and
       mounts again, and a guard set before the cancelled timer would stop the
       second one from ever running. */
    const timer = setTimeout(() => {
      if (autoFound.current) return;
      autoFound.current = true;
      void findReferences();
    }, 0);
    return () => clearTimeout(timer);
    // Once on arrival; the search itself persists server-side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFindReferences, anthropicReady]);

  async function removeReference(id: string) {
    const previous = references;
    setReferences((current) => current.filter((item) => item.id !== id));
    // Back to "the first" rather than to a photograph that no longer exists.
    if (chosenReferenceId === id) setChosenReferenceId(null);
    try {
      await deleteImageReferenceAction(id);
    } catch (e) {
      setReferences(previous);
      setError(e instanceof Error ? e.message : "Could not remove that reference.");
    }
  }

  async function draftPrompt() {
    setBusy("prompt");
    setError(null);
    try {
      const result = await generateImagePromptAction(projectId, {
        variationCount: count,
        referenceId: chosenReference?.id,
      });
      setPrompt(result.prompt);
      setDraftedPrompt(result.prompt);
      setVariants(result.variants);
      setVisualBrief(result.brief);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to draft prompt.");
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    if (!prompt.trim() || !optionId) return;
    setBusy("gen");
    setError(null);
    try {
      const result = await generateImagesAction(projectId, {
        prompt,
        optionId,
        aspectRatio,
        variationCount: count,
        referenceIds: usableReferences.map((item) => item.id),
        variantPrompts: usingDraftedSet ? variants.map((variant) => variant.prompt) : undefined,
      });
      setImgs((prev) => [...result.images, ...prev]);
      if (result.failedCount > 0) {
        setError(
          `${result.failedCount} of ${count} images failed. ${result.failureReason ?? ""}`.trim()
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image generation failed.");
    } finally {
      setBusy(null);
    }
  }

  if (options.length === 0) {
    return (
      <p className="rounded-2xl bg-warn-soft px-5 py-4 text-sm leading-relaxed text-ink-2">
        <strong className="font-semibold text-ink">No image providers are configured.</strong>{" "}
        Add a key in Settings → Image providers to enable image generation.
      </p>
    );
  }

  const selectedCoverId = imgs.some((image) => image.id === chosenCoverId)
    ? chosenCoverId
    : imgs[0]?.id ?? null;

  function chooseCover(imageId: string) {
    setChosenCoverId(imageId);
    void setCoverImageAction(projectId, imageId).catch((reason) => {
      setChosenCoverId(coverImageId);
      setError(reason instanceof Error ? reason.message : "Could not set the cover image.");
    });
  }

  /* THE PHOTOGRAPH ITSELF, AS THE COVER. Made into an image beside the
     generated ones rather than a special case of the cover, so choosing,
     deleting and publishing it are the paths that already exist. A second
     press on the same photograph chooses the cover it already became. */
  async function coverFromReference(item: UploadedReferenceView, rightsConfirmed: boolean) {
    const already = imgs.find((image) => credits[image.id]?.referenceId === item.id);
    if (already) {
      chooseCover(already.id);
      return;
    }
    setCoverBusy(true);
    setError(null);
    try {
      const result = await coverFromReferenceAction(projectId, item.id, rightsConfirmed);
      setImgs((current) => [result.image, ...current]);
      setCredits((current) => ({ ...current, [result.image.id]: result.credit }));
      setChosenCoverId(result.image.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not make that photograph the cover.");
    } finally {
      setCoverBusy(false);
    }
  }

  function askCoverFromReference(item: UploadedReferenceView) {
    // An open licence is the permission; anything else is someone's to give.
    if (item.origin === "open_license" && item.license) void coverFromReference(item, false);
    else setPermissionFor(item);
  }

  const referenceMissing = Boolean(
    selectedOption?.capabilities.referenceImagesRequired && usableReferences.length === 0
  );
  const hasPrompt = prompt.trim().length > 0;
  // Blocked for a reason the editor cannot fix by typing — as opposed to simply
  // not having written a prompt yet, which is a resting state, not a fault.
  const generateBlocked = busy !== null || !optionId || referenceMissing;
  /* Falls back to the first rather than showing nothing: an image exists, so
     the middle of the stage should have one in it even before a choice. */
  const featured = imgs.find((img) => img.id === selectedCoverId) ?? imgs[0];

  /* A DECK ONLY WHERE THERE IS SOMETHING TO SAY. Empty, it says so, because a
     panel with nothing under it gives no reason. Plural, it says the tiles are
     a choice, which nothing about a grid of pictures announces.

     With exactly one there is no third fact of that kind: the panel holds one
     picture and you can see it, and every line tried here has either described
     that or advertised the button beside it. Nothing, then. */
  const imagesNote =
    imgs.length === 0
      ? "None yet."
      : imgs.length === 1
        ? null
        : `${imgs.length} images — choose the one to publish.`;
  const featuredCredit = featured ? credits[featured.id] : undefined;
  /* Only where the cover is someone's photograph: a generated image owes
     nobody a line. Keyed by image so switching covers starts from that one's
     own words rather than the last one's. */
  const creditEditor = featured && featuredCredit && (
    <CoverCreditEditor
      key={featured.id}
      projectId={projectId}
      imageId={featured.id}
      credit={featuredCredit}
      onSaved={(next) => setCredits((current) => ({ ...current, [featured.id]: next }))}
    />
  );

  /* ONE DEFINITION, TWO HOMES — the rail panel on a desktop, the body of a
     pull-up sheet on a phone. Written twice they would drift apart on the
     first change. */
  const imageGrid = imgs.length > 0 && (
    <ul className="mt-4 grid grid-cols-2 gap-3">
      {imgs.map((img) => (
        <li key={img.id}>
          <GeneratedImage
            img={img}
            sourced={Boolean(credits[img.id])}
            selected={img.id === featured?.id}
            onSelect={() => chooseCover(img.id)}
            onDeleted={() => setImgs((current) => current.filter((item) => item.id !== img.id))}
          />
        </li>
      ))}
    </ul>
  );

  return (
    // Always as tall as the space below the pipeline header, and a flex column
    // so the composer can be pushed to the end of it. Sticky alone only pins
    // while the page overflows, so with one or two images the dock stopped
    // wherever the content ended and appeared to move between visits.
    // `gap` rather than `space-y`: the composer's `mt-auto` has to win, and a
    // `space-y` margin on the same axis fights it.
    /* THE SAME TWO COLUMNS AS DRAFTS AND PUBLISH. This stage was one flex
       column: title and forward action on a row, then a four-across grid of
       every image, then the composer. So the picture you had actually CHOSEN
       was one tile among equals, and the forward action floated at the top of
       the page attached to nothing.

       The choice sits in the middle at size, the rest of the set is a rail of
       thumbnails beside it, and the forward action is in a panel like every
       other stage's. */
    /* LOCKED ON A PHONE. The stage is sized to the screen (see the section
       below), so the page has nothing to scroll — but a document that merely
       fits can still be dragged, and it bounced by the few pixels the sums
       leave. The marker is what the create page and the sign-in door carry
       (globals.css): root and body stop scrolling while this panel is on
       screen. It is on the panel and not the route, because Draft and
       Publish are documents and scroll like them. The sheet scrolls inside
       itself and is unaffected. */
    /* The picture's track is wider than the article's: a cover is judged at
       size, and the dock under it holds a prompt and a row of controls. */
    <div data-fits-viewport="" className={`${RAIL_GRID} lg:[--rail-content:56rem]`}>
      {/* NO PLATE HERE, unlike Draft and Publish. Those two hold a DOCUMENT —
          an article, a preview of one — and a plate is what a document sits on.
          This stage holds a picture and a box to describe it in, and both of
          those are already objects with edges of their own: the image has its
          frame, the dock has its border. Wrapping them put a card inside a card
          and a white panel on a white panel.

          Three things on the page ground instead, in reading order: what the
          picture is for, the picture, and the way to ask for another. */}
      {/* A SCREEN, NOT A PAGE. Draft and Publish are documents and scroll like
          them; this stage is three fixed things — what the picture is for, the
          picture, and the box to ask for another — and scrolling a screen whose
          content already fits is a gesture that does nothing but move the dock
          away from the thumb.

          Sized to the gap that is actually left: 48 for the bar the menu button
          and stepper share, 32 for the shell's own top padding, 70 for the
          closed sheet, and 12 so the dock is not welded to it — 162 in total.
          Getting that sum wrong by the 32 is what made the page scroll a little
          and the dock slide under the sheet, and it is the kind of wrong that
          only shows on the device.

          The 12 survives the lift for free: the content moves by exactly the
          sheet's travel, so whatever gap it has at rest it keeps when open.

          Clipped, so a tall image shrinks instead of pushing the dock off the
          bottom. Above `lg` it goes back to a minimum height and lets the page
          grow.

          `dvh`, NOT `svh`. Safari's small viewport is measured against its
          bottom bar at full height, and the bar is compact almost all of the
          time, so at 100svh the stage stopped some 40px short and the dock
          hung that far above the sheet. The page is locked here, so the bar
          never collapses on scroll and the dynamic unit is stable. */}
      <section
        className={`flex h-[calc(100dvh-10.125rem)] flex-col overflow-hidden transition-transform duration-(--duration-base) ease-(--ease-out) lg:h-auto lg:min-h-[calc(100svh-9rem)] lg:translate-y-0 lg:overflow-visible ${RAIL_CONTENT}`}
        style={sheetLift ? { transform: `translateY(-${sheetLift}px)` } : undefined}
      >
          {/* THE ARTICLE'S NAME, which this stage used to be the only one
              without. Draft shows the piece itself and Publish shows the
              preview, so both say what you are working on simply by showing
              it; here the subject is a picture, and without the headline there
              was nothing on the plate to say which article the picture is FOR.
              THE SAME TYPE AS THE DRAFT'S OWN HEADLINE — --text-h2, semibold,
              tracked in, in full ink. It was set as a small grey caption, on
              the reasoning that the stepper already names the stage, which
              confused two different jobs: the stage is named up there, but the
              ARTICLE is named nowhere, and it is the article that carries over
              from the screen before. Matching that screen's h1 is what makes it
              read as the same piece rather than as a note about one. */}
          <p className="font-heading text-[length:var(--text-h2)] font-medium leading-tight tracking-tight text-ink">
            {title}
          </p>

          {/* The picture takes the room that is left, centred in it, so the
              dock stays on the floor of the stage whether there is one image or
              none. */}
          <div ref={featureAreaRef} className="flex min-h-0 flex-1 items-center justify-center py-6">
            {featured ? (
              <GeneratedImage
                key={featured.id}
                img={featured}
                sourced={Boolean(featuredCredit)}
                feature
                maxHeight={featureRoom ?? undefined}
                selected
                onSelect={() => chooseCover(featured.id)}
                onDeleted={() => setImgs((current) => current.filter((item) => item.id !== featured.id))}
              />
            ) : (
              <p className="max-w-sm text-balance text-center text-sm leading-relaxed text-ink-2">
                No image yet. Describe one below, or auto-draft it from the article.
              </p>
            )}
          </div>

      <div className="space-y-2">
        {!anthropicReady && (
          <p id="auto-draft-requirement" className="text-sm text-ink-2">
            Configure <code>ANTHROPIC_API_KEY</code> in the server environment to use Auto-draft.
          </p>
        )}
        {referenceMissing && (
          /* SHORT ENOUGH FOR ONE LINE, AND CENTRED WHERE IT SITS ALONE. The old
             sentence named the condition ("needs… before it can generate"),
             which is the state the tinted Reference disc is already showing;
             what it did not say is what to do about it. It also ran to two
             lines on a phone, left-aligned under a centred image — a stray
             paragraph rather than a notice about the dock below it.

             Centred at every width: it belongs to the dock directly beneath
             it, and the dock is centred in this column on a desktop too. A
             left edge here would be one nothing else in the stage shares. */
          <p id="generate-requirement" className="text-center text-sm text-ink-2">
            Add a reference image to generate.
          </p>
        )}
        {/* What the editor is about to get is not obvious from a single prompt
            field: the field shows one prompt, but a drafted set sends a
            different concept to each image. Said plainly, and only when it
            changes the outcome. */}
        {usingDraftedSet && !conceptsBehindCount && (
          <p className="text-sm text-ink-2">
            {count} images, {count} different scenes — drafted from the article.
          </p>
        )}
        {conceptsBehindCount && (
          <p className="text-sm text-ink-2">
            {variants.length} of the {count} images will show different scenes. Auto-draft again
            for {count}.
          </p>
        )}
        {variants.length > 0 && !usingDraftedSet && count > 1 && (
          <p className="text-sm text-ink-2">Your edited prompt will be used for all {count} images.</p>
        )}
        {findNote && <p className="text-sm text-ink-2">{findNote}</p>}
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </div>

      <p className="sr-only" aria-live="polite">
        {busy === "prompt" ? "Drafting image prompt" : busy === "gen" ? "Generating images" : ""}
      </p>

      {/* ON THE FLOOR OF THE PLATE, not floating over the page.
          It used to be `sticky bottom-16` with a gradient scrim beneath it,
          because it sat on the page ground with images scrolling underneath and
          needed to hold itself clear of the bottom edge and mask what passed
          behind. Inside the plate there is nothing to hold clear of and nothing
          to mask: `mt-auto` puts it on the floor, and the picture above takes
          whatever height is left.

          Everything else is a setting on the prompt, so the settings compress
          into chips in the control row. Structure, growth and controls all
          mirror the composer on the home surface. */}
      <div className="mt-auto pt-4">
        {/*
          The reference photographs, shown as photographs.

          They were chips: a 28px circular crop beside a filename, in the same
          row as the model and ratio settings. That is the wrong shape twice
          over. A round 28px crop of a wide photograph shows almost none of it,
          and the one thing an editor needs to judge here is whether this is the
          picture the generation should look like — which is a question only the
          image can answer. And a photograph is not a setting on the prompt; it
          is material the prompt is written against, so it does not belong in
          the row where the count and the aspect ratio live.

          Square, 64px, above the dock. Squares because the crop is honest about
          being a crop — a circle implies an avatar — and above because that is
          the reading order: here is the picture, now here is what you are
          asking for. It sits on the page ground with no lift of its own: the
          Single-Object Rule gives the dock the only elevation above the fold,
          and a raised tray of thumbnails would compete with the thing it feeds.
        */}
        {references.length > 0 && (
          <section
            aria-label="Reference photographs"
            /* Indented onto the prompt's own text line, not the dock's outer
               edge: 6px of bezel plus the field's 16px gutter. The photograph
               and the sentence written against it are one column, and 22px of
               stagger between them reads as a mistake rather than as a margin.
               The Two-Gutter Rule, applied across the dock's edge instead of
               inside it. */
            className="mb-3 ps-[22px] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"
          >
            {/*
              Real radios, hidden but present.

              This is a choose-one-of-N, which is what a radio group is, so the
              native control does the work: arrow keys move between photographs,
              the group is one tab stop, and assistive technology announces the
              selection without a line of ARIA. A div with a click handler and
              `aria-pressed` would be re-implementing all of that, worse.
            */}
            <fieldset className="border-0 p-0">
              <legend className="sr-only">Which photograph the image should match</legend>
              {/* ONE ROW ON A PHONE, scrolled sideways. The stage there is a
                  box the height of the screen, and every row of thumbnails is
                  64px taken from the cover above it — eight references wrapped
                  to two rows and shrank the picture being judged. The padding
                  keeps each thumbnail's remove button inside the scroller,
                  which would otherwise clip it. A desktop has the height, and
                  wraps. */}
              <ul className="flex items-center gap-2 overflow-x-auto pe-1.5 pt-1.5 [scrollbar-width:none] lg:flex-wrap lg:overflow-visible lg:pe-0 lg:pt-0 [&::-webkit-scrollbar]:hidden">
                {references.map((item) => {
                  const chosen = item.id === chosenReference?.id;
                  const credit = item.sourceName
                    ? `${item.sourceName}${item.license ? ` — ${item.license}` : ""}`
                    : "Uploaded";
                  return (
                    <li key={item.id} className="group relative shrink-0">
                      <label className="block cursor-pointer">
                        <input
                          type="radio"
                          name="reference-choice"
                          className="peer sr-only"
                          checked={chosen}
                          onChange={() => setChosenReferenceId(item.id)}
                          aria-label={`Match this photograph: ${item.name}. ${credit}`}
                        />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.url}
                          alt={item.name}
                          width={64}
                          height={64}
                          decoding="async"
                          title={credit}
                          /* The unchosen sit back rather than disappear: the
                             whole point of showing them is that swapping is one
                             click, and a picture you cannot see is not a choice.
                             They come most of the way up on hover, which is the
                             affordance doing its own explaining. */
                          className={`size-16 rounded-xl border object-cover transition-[opacity,border-color,box-shadow] duration-(--duration-fast) ease-(--ease-out) peer-focus-visible:shadow-[var(--shadow-focus)] motion-reduce:transition-none ${
                            chosen
                              ? "border-line-strong opacity-100"
                              : "border-line opacity-45 hover:opacity-80"
                          }`}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void removeReference(item.id)}
                        aria-label={`Remove reference photograph: ${item.name}`}
                        /* 24px meets the WCAG 2.2 AA minimum target size. Held
                           back until the thumbnail is hovered or something inside
                           it takes focus, so three photographs do not read as
                           three delete buttons — but always present where hover
                           does not exist, since there is nothing to reveal it on
                           a touch screen. */
                        className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full border border-line bg-surface text-ink-3 opacity-0 shadow-[var(--shadow-card)] transition-[opacity,color,background-color] duration-(--duration-fast) ease-(--ease-out) group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-sunken hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] motion-reduce:transition-none [@media(hover:none)]:opacity-100"
                      >
                        <X aria-hidden className="size-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
            {/*
              One line doing two jobs that were previously two paragraphs and a
              badge: which photograph is actually in play, and who took it.

              ink-2 rather than ink-3: measured against the page ground, ink-3
              lands at 4.49:1 — a hair under the 4.5:1 that body text at this
              size needs.

              The photographer is a link because Unsplash's API terms ask for a
              credit back to the photograph, and a `title` attribute is not one.
            */}
            <p className="mt-2 text-xs leading-relaxed text-ink-2">
              {/*
                Three states, and the middle one is why this line exists at all.
                A dimmed photograph with no words beside it is the interface
                telling the editor something is wrong without saying what.
              */}
              {usableReferences.length === 0 ? (
                // Every thumbnail dimmed and no explanation is the worst of the
                // three. It happens whenever the chosen model reads text only,
                // which is a property of the dropdown, not of the photographs.
                <>Not used — {selectedOption?.label ?? "this model"} makes images from text alone. </>
              ) : (
                references.length > 1 && <>Matching this one of {references.length}. </>
              )}
              {activeReference?.sourceName ? (
                <>
                  {/* "Photo by" is a photographer's credit. A page's lead image
                      is the publisher's, and whether it may be published is
                      still open — said here, before anyone presses the button
                      after it. */}
                  {activeReference.origin === "article_source" ? "From" : "Photo by"}{" "}
                  {activeReference.sourceUrl ? (
                    <a
                      href={activeReference.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline decoration-line-strong underline-offset-2 transition-colors duration-(--duration-fast) hover:text-ink hover:decoration-current focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
                    >
                      {activeReference.sourceName}
                    </a>
                  ) : (
                    activeReference.sourceName
                  )}
                  {activeReference.license
                    ? ` · ${activeReference.license}`
                    : activeReference.origin === "article_source"
                      ? " · needs permission to publish"
                      : ""}
                </>
              ) : (
                <>Uploaded reference.</>
              )}
              {/* THE PICTURE ITSELF MAY BE THE BEST COVER. When a cited page
                  leads with the work, a generated likeness of it is the lesser
                  image — so the photograph can go to the middle as it is. */}
              {activeReference && (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => askCoverFromReference(activeReference)}
                    disabled={coverBusy || busy !== null}
                    className="font-medium text-ink underline decoration-line-strong underline-offset-2 transition-colors duration-(--duration-fast) hover:decoration-current focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-50"
                  >
                    {coverBusy ? "Making it the cover…" : "Use as cover"}
                  </button>
                </>
              )}
            </p>
          </section>
        )}

        {/* THE DOCK'S OWN SURFACE, like the one on Create. This was the only
            composer in the product dressed as a bezel — a sunken tray around a
            plate, 20px, with a resting shadow — while the Create dock is a
            white panel on a 12px radius and a hairline that deepens its shadow
            on focus. Two boxes you type an instruction into, built two
            different ways. The controls inside were already the dock's. */}
        {/* Capped at the width Create's dock uses, and for the same reason: a
            composer stretched to the full column is a very wide, very short
            box to read a sentence back in. */}
        <div className="cs-dock w-full max-w-3xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-4 motion-safe:duration-500">
          <label htmlFor="image-prompt" className="sr-only">Image prompt</label>
          <div className="cs-dock-input-viewport">
            <textarea
              ref={promptRef}
              id="image-prompt"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the image, or auto-draft one from the article…"
              /* FOUR LINES CLOSED, EIGHT OPEN, ON A PHONE. The stage there is
                 a clipped box the height of the screen, and the field's height
                 comes straight out of the picture's. An auto-drafted prompt
                 let fully out once ran past the top of the box and took the
                 collapse control with it. The caps are in `lh` so they are
                 lines whatever the type size, and PROMPT_LINES_* above must
                 say the same numbers. Above `lg` the page grows: 160 closed,
                 unbounded open. */
              className={`cs-dock-input ${promptNeedsExpansion ? "cs-dock-input--scrollable pr-12" : ""} ${promptExpanded ? "max-h-[calc(8lh+4px)] lg:max-h-none" : "max-h-[calc(4lh+4px)] lg:max-h-40"}`}
            />
          </div>
          {promptNeedsExpansion && (
            <button
              type="button"
              onClick={() => {
                const nextExpanded = !promptExpanded;
                setPromptExpanded(nextExpanded);
                requestAnimationFrame(() => {
                  const field = promptRef.current;
                  if (!field) return;
                  field.style.height = "auto";
                  field.style.height = `${Math.min(field.scrollHeight, nextExpanded ? promptExpandedMax(field) : promptCollapsedMax(field))}px`;
                  field.focus();
                });
              }}
              className="absolute right-3 top-3 grid size-9 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label={promptExpanded ? "Collapse image prompt" : "Expand image prompt"}
              aria-controls="image-prompt"
            >
              {promptExpanded ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}
            </button>
          )}

          <div className="cs-dock-controls flex-wrap gap-2">
            <ImageSettingsMenu
              models={options.map((o) => ({ value: o.optionId, label: o.label }))}
              model={optionId}
              onModel={selectModel}
              ratios={selectedOption?.capabilities.aspectRatios ?? []}
              ratio={aspectRatio}
              onRatio={(value) => setAspectRatio(value as ImageAspectRatio)}
              maxVariations={selectedOption?.capabilities.maxVariations ?? 1}
              count={count}
              onCount={setCount}
            />

            {/* ONLY WHERE IT DOES SOMETHING. Half the models cannot take a
                reference at all, and for those this disc opened a menu whose
                every option was inert — a control that exists to tell you it
                does not apply. The capability is already known here; the
                button follows it.

                It is the same reasoning the dock's own action follows a few
                lines below: show the one control that is live, rather than
                showing both and greying the one that is not. */}
            {selectedOption?.capabilities.referenceImages && (
            <ReferenceMenu
              canFind={references.length < MAX_FOUND_REFERENCES}
              finding={finding}
              onFind={() => void findReferences()}
              uploading={uploading}
              missing={referenceMissing}
              disabled={busy !== null}
              fileInput={
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploading}
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadReference(file);
                  }}
                />
              }
            />
            )}

            {/* ONE ACTION AT A TIME, and the prompt decides which. The two used
                to sit side by side with the inapplicable one greyed — a dock
                that always showed a control you could not use, and made you
                read both to find the live one. With nothing written, asking the
                system to write it is the only thing to do; once there is a
                prompt, sending it is. */}
            <div className="ml-auto flex items-center gap-2">
              {!hasPrompt ? (
                <button
                  type="button"
                  onClick={draftPrompt}
                  disabled={busy !== null || !anthropicReady}
                  aria-describedby={!anthropicReady ? "auto-draft-requirement" : undefined}
                  /* FILLED, like Create's Generate. It was the accent at its
                     palest with an outline holding it together — the shape of
                     a secondary action, on the one thing in this dock you are
                     being invited to press. The label and the orb go white
                     with it. */
                  className="cs-btn cs-dock-btn cs-dock-btn--wide shrink-0 border-transparent bg-accent text-white enabled:hover:border-transparent enabled:hover:bg-accent-hover"
                >
                  <AccentOrb tone="on-accent" />
                  <span className="whitespace-nowrap pl-2">
                    {busy === "prompt" ? "Drafting…" : "Auto-draft"}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={generate}
                  disabled={generateBlocked}
                  aria-describedby={referenceMissing ? "generate-requirement" : undefined}
                  className="cs-dock-btn-icon cs-btn-primary shrink-0"
                  aria-label={busy === "gen" ? "Generating images" : `Generate ${count} image${count > 1 ? "s" : ""}`}
                  title={busy === "gen" ? undefined : `Generate ${count} image${count > 1 ? "s" : ""}`}
                >
                  {busy === "gen"
                    ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
                    : <Send aria-hidden className="size-4" />}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      </section>

      {/* top-32, the offset Publish already used. At top-6 the rail
            slid under the sticky stepper before it caught, which reads as
            the column moving rather than holding. */}
        {/* Hidden on a phone: its two panels become a corner button and a
            pull-up sheet, so the rail costs no vertical space at all. */}
        <div className={`hidden space-y-6 lg:block lg:sticky lg:top-[4.5rem] ${RAIL_COLUMN}`}>
        <section className="cs-bezel">
          <div className="cs-bezel-core p-5">
            {/* Named by the work you do next, like every other panel in the
                rail — see the fuller note on the draft stage, where this same
                heading appeared word for word. */}
            <h3 className="font-heading text-[length:var(--text-h3)] font-medium tracking-tight text-ink">
              Review and publish
            </h3>
            {/* NAMED BY SELECTION, NOT BY POSITION. "The image in the middle is
                the one that publishes" tied the fact to a layout — true of the
                stage on a desktop, and of nothing in particular once the set
                is a grid in a sheet on a phone. Which image is chosen is a
                state, and the sentence should name the state.

                With no image there is a different thing to say, because
                nothing on screen says it: that you may go on without one. */}
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              {imgs.length === 0
                ? "You can publish without an image."
                : "The selected image will be published."}
            </p>
            {creditEditor}
            <button type="button" onClick={onNext} className="cs-cta mt-4 w-full">
              Continue to publish
            </button>
          </div>
        </section>

        {/* ALWAYS TWO PANELS, like Draft and Publish. This appeared only once a
            second image existed, so the rail was one card for most of the
            stage's life and then abruptly two — and the place your generated
            images were going to arrive was, until they arrived, nothing at all.
            It states what it holds, and says what is in it.

            The set is at thumbnail size. Picking one moves it to the middle;
            nothing else about the page changes. */}
        <section className="cs-bezel" aria-label="Images">
          <div className="cs-bezel-core p-5">
            {/* "Images", not "Generated images": a photograph used as the
                cover sits in this set too. */}
            <h3 className="font-heading text-[length:var(--text-h3)] font-medium tracking-tight text-ink">
              Images
            </h3>
            {imagesNote && (
              <p className="mt-1 text-sm leading-relaxed text-ink-2">{imagesNote}</p>
            )}
            {imageGrid}
          </div>
        </section>
      </div>

      {/* The rail's two panels, for a screen with no room for a rail. */}
      <StageAction label="Continue to publish" onClick={onNext}>
        <ArrowRight aria-hidden className="size-5" />
      </StageAction>
      <StageSheet title="Images" subtitle={imagesNote ?? undefined} onOpenChange={setSheetLift}>
        {creditEditor}
        {imageGrid}
      </StageSheet>

      <ConfirmDialog
        open={permissionFor !== null}
        title="Use this image as the cover?"
        confirmLabel="I have permission"
        tone="primary"
        description={
          permissionFor?.origin === "upload" ? (
            <>
              An uploaded picture belongs to whoever made it. Use it only if you made it, or they
              have given permission. It will be credited in the article&rsquo;s References, and you
              can edit the wording.
            </>
          ) : (
            <>
              This picture belongs to {permissionFor?.sourceName ?? "the page it came from"}. Use it
              only if their press terms allow editorial use, or they have given permission. It will
              be credited in the article&rsquo;s References, and you can edit the wording.
            </>
          )
        }
        onCancel={() => setPermissionFor(null)}
        onConfirm={() => {
          const item = permissionFor;
          setPermissionFor(null);
          if (item) void coverFromReference(item, true);
        }}
      />
    </div>
  );
}

/**
 * The line a sourced cover is credited with, and where it links.
 *
 * Drafted from the source when the photograph became the cover, and editable
 * because the draft is only as good as the page's metadata: a studio's site
 * name may be "Home", and the credit a press kit asks for may be worded its
 * own way. Saved when a field is left, so there is no button to forget.
 */
function CoverCreditEditor({ projectId, imageId, credit, onSaved }: {
  projectId: string;
  imageId: string;
  credit: CoverCredit;
  onSaved: (credit: CoverCredit) => void;
}) {
  const [label, setLabel] = useState(credit.label);
  const [url, setUrl] = useState(credit.url);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string }>({
    kind: "idle",
  });

  async function save() {
    if (label.trim() === credit.label && url.trim() === credit.url) return;
    setStatus({ kind: "saving" });
    try {
      const next = await updateCoverCreditAction(projectId, imageId, { label, url });
      onSaved(next);
      setStatus({ kind: "saved" });
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "The credit could not be saved." });
    }
  }

  // From React, not the image id: the editor is drawn twice — in the rail and
  // in the phone's sheet — and two fields sharing an id share one label.
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const urlId = `${fieldId}-url`;
  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-sm font-medium text-ink">Cover credit</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">
        Added to the article&rsquo;s References when it publishes.
      </p>
      <label htmlFor={labelId} className="mt-3 block text-xs font-medium text-ink-2">
        Credit line
      </label>
      <input
        id={labelId}
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        onBlur={() => void save()}
        maxLength={240}
        className="cs-input mt-1 !h-10 text-sm"
      />
      <label htmlFor={urlId} className="mt-3 block text-xs font-medium text-ink-2">
        Link
      </label>
      <input
        id={urlId}
        type="url"
        inputMode="url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        onBlur={() => void save()}
        placeholder="https://"
        className="cs-input mt-1 !h-10 text-sm"
      />
      <p className="mt-2 min-h-4 text-xs text-ink-2" aria-live="polite">
        {status.kind === "saving"
          ? "Saving…"
          : status.kind === "saved"
            ? "Saved."
            : status.kind === "error"
              ? <span className="text-danger">{status.message}</span>
              : credit.rightsConfirmedBy
                ? `Permission confirmed by ${credit.rightsConfirmedBy}.`
                : credit.license
                  ? `${credit.license}.`
                  : null}
      </p>
    </div>
  );
}

function GeneratedImage({ img, sourced = false, feature = false, maxHeight, selected, onSelect, onDeleted }: {
  img: GeneratedImageView;
  /** A photograph used as it is, not a generated variation. */
  sourced?: boolean;
  /** The only image: shown large, but capped so a square cannot run away. */
  feature?: boolean;
  /** The room the featured image actually has, when the stage is clipped
   *  to the screen. Lowers the cap; never raises it. */
  maxHeight?: number;
  /** True when this image is the one that will reach the Hub. */
  selected: boolean;
  onSelect: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [ratioW, ratioH] = img.aspectRatio.split(":").map(Number);
  const ratio = ratioW && ratioH ? ratioW / ratioH : 1;
  // What to call it wherever it is named: a photograph has no variation number.
  const name = sourced ? "the cover photograph" : `variation ${img.variationNo}`;
  const Name = sourced ? "The cover photograph" : `Variation ${img.variationNo}`;

  async function remove() {
    if (!window.confirm(`Delete ${sourced ? "this photograph" : `generated image variation ${img.variationNo}`}? This cannot be undone.`)) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteGeneratedImageAction(img.id);
      onDeleted();
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "The image could not be deleted.");
      setDeleting(false);
    }
  }

  return (
    <figure
      style={feature ? { maxWidth: Math.round(Math.min(FEATURE_MAX_HEIGHT, maxHeight ?? FEATURE_MAX_HEIGHT) * ratio) } : undefined}
      /* THE FEATURED IMAGE WEARS NO RING. The accent ring answers "which of
         these is chosen", which is a question a grid asks and a single picture
         cannot: the one in the middle of the plate is there BECAUSE it is
         chosen, so ringing it states the obvious in the loudest colour the
         product has, around the one thing on the screen meant to be looked at
         on its own terms. The rail's thumbnails keep it, because that is where
         the choosing happens. */
      className={`group overflow-hidden rounded-lg transition-shadow duration-(--duration-base) ease-(--ease-spring) ${
        feature
          ? "shadow-[var(--shadow-plate)]"
          : selected
            ? "shadow-[0_0_0_2px_var(--accent),var(--shadow-plate)]"
            : "shadow-[0_0_0_1px_var(--border)] hover:shadow-[0_0_0_1px_var(--border-strong)]"
      }`}
    >
      <div className="relative">
        {/* The whole frame is the control: one image publishes, so picking it is
            a choice between cards, not a checkbox on each. Unselected tiles carry
            no label — a grid of "Use this" says the same thing as many times as
            there are images. The tint on hover is the affordance instead. */}
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="absolute inset-0 z-10 cursor-pointer transition-colors duration-(--duration-fast) ease-(--ease-spring) hover:bg-ink/5 focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_3px_var(--orange-200)]"
        >
          <span className="sr-only">
            {selected ? `${Name} will be published` : `Publish ${name}`}
          </span>
        </button>
        {/* NO "PUBLISHING" BADGE. It was an orange pill laid over the top-left
            corner of the very picture it was describing — on the featured
            image, which is the only one large enough to read, that meant a
            label sitting on the subject at the size the subject is meant to be
            judged at. The 2px accent ring around the frame already says which
            one is chosen, the rail beside it says so again by highlighting the
            same thumbnail, and the button's own screen-reader text still names
            the state for anyone who cannot see either. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img.url}
          alt={sourced ? "Cover photograph" : `Generated companion image, variation ${img.variationNo}`}
          loading="lazy"
          decoding="async"
          className="w-full object-cover"
          style={{ aspectRatio: img.aspectRatio.replace(":", " / ") }}
        />
        {/* Per-image actions ride on the image and appear on intent. As a
            permanent caption strip they added a row of chrome to every tile,
            which is what made a grid of nine unmanageable. */}
        <div className="cs-reveal absolute right-2 top-2 z-20 flex items-center gap-1">
          <a
            href={img.url}
            download
            className="grid size-9 place-items-center rounded-full bg-surface/90 text-ink-2 shadow-sm backdrop-blur-sm transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
            aria-label={`Download ${name}`}
          >
            <IconDownload width={15} height={15} />
          </a>
          <button
            type="button"
            onClick={remove}
            disabled={deleting}
            className="grid size-9 place-items-center rounded-full bg-surface/90 text-danger-ink shadow-sm backdrop-blur-sm transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-50"
            aria-label={deleting ? `Deleting ${name}` : `Delete ${name}`}
          >
            <IconTrash width={15} height={15} />
          </button>
        </div>

        {/* NO CAPTION, ANYWHERE. "fal-ai/nano-banana-2/edit · 1:1 · v1" is the
            provider's routing string, and it was laid across the bottom of the
            picture — the same text on every image in the set, over the one
            thing on the stage you are meant to be looking at. Which model made
            it is a setting, and settings live in the dock's Settings menu. */}
      </div>

      {deleteError && <p className="bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">{deleteError}</p>}

    </figure>
  );
}

/**
 * The Publish stage: a faithful preview of the article as it will appear on the
 * Knowledge Hub (left) beside the publish action rail (right). The rail is the
 * decision surface; the preview answers "what am I shipping?". Stacks to
 * preview-then-rail on narrow screens.
 */
function PublishComposer({
  projectId,
  title,
  publish,
  draftMd,
  coverImageUrl,
  coverAspectRatio,
  initialDek,
  published,
  anthropicReady,
  hubConfigured,
  publishedHubUrl,
  publishedHubAdminUrl,
}: {
  projectId: string;
  title: string;
  publish: PublishMetadata;
  draftMd: string;
  coverImageUrl: string | null;
  coverAspectRatio: number;
  initialDek: string | null;
  published: boolean;
  anthropicReady: boolean;
  hubConfigured: boolean;
  publishedHubUrl?: string;
  publishedHubAdminUrl?: string;
}) {
  const [dek, setDek] = useState<string | null>(initialDek);
  // Pending from first render when there's no cached dek — avoids a synchronous
  // setState inside the effect below.
  const [dekPending, setDekPending] = useState(!initialDek);

  // Generate the dek once when the stage opens so the preview shows the real
  // subtitle; it's cached server-side and reused verbatim at publish time.
  useEffect(() => {
    if (dek) return;
    let active = true;
    ensurePublishDekAction(projectId)
      .then((value) => {
        if (active && value) setDek(value);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setDekPending(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const readMinutes = Math.max(1, Math.round(countMetrics(draftMd).words / 220));

  return (
    /* The widest track of the three: the Hub preview is a whole page scaled
       into it, and it is only legible given room. */
    <div className={`${RAIL_GRID} lg:[--rail-content:64rem]`}>
      {/* No label above the preview: it renders the Hub's own masthead and
          chrome, which says what it is more convincingly than a caption. */}
      {/* THE PREVIEW SCROLLS, NOT THE PAGE — which is the only way to get the
          scrollbar out from over the sheet. A native scrollbar always paints
          on top of everything, fixed elements included, so while the DOCUMENT
          was the scroller its bar ran the full height of the phone and straight
          down across the sheet: there is no z-index that puts it behind. Making
          this column the scroll container ends the track where the column ends,
          which is exactly the sheet's top edge.

          IT RUNS TO THE BOTTOM OF THE DISPLAY, UNDERNEATH THE SHEET. Stopping
          it 12px short drew a hard edge across the page with a strip of ground
          below it, which read as the preview having been cut off rather than as
          there being more of it — the same mistake the stepper avoids at the
          top, where the article visibly goes on beneath the blur. So the column
          takes everything below the bar (48) and the shell's own padding (32),
          and the sheet lies over its foot.

          The scrollbar goes, rather than crossing the sheet on its way down. A
          native bar always paints on top of everything, fixed elements
          included, so those are the only two options: end the track early, or
          have no track. Nothing here is aimed at with a pointer, and both the
          sheet's own scroller and the stepper already made the same call.

          The padding is the closed sheet plus a little, so the last line of the
          article can be scrolled out from under it rather than stranded there.

          AND IT REACHES UP BEHIND THE STEPPER, the same way the draft does. A
          scroll box that begins below the bar can never send anything under it:
          the article simply stopped at the bar's lower edge, so the blur had
          nothing to blur and read as a plain band. The negative margin puts the
          top of the SCROLL AREA at the top of the display — behind a bar that
          outranks it on --z-sticky — and the matching top padding puts the
          first line back where it was at rest. Same position when still, and
          the article now goes out of focus as it slides underneath.

          The two numbers are one number said twice: 48 for the bar and 32 for
          the shell's own top padding, which is where this column used to
          start.

          `dvh`, NOT `svh`, for the height: Safari's small viewport stops some
          40px short of its compact bottom bar, so the scroll box ended above
          the sheet's ledge with a band of ground showing under it instead of
          running beneath the sheet. `dvh` is the screen as it is now. */}
      <div className={`-mt-20 h-dvh overflow-y-auto pb-[4.75rem] pt-20 [scrollbar-width:none] lg:mt-0 lg:h-auto lg:overflow-visible lg:pb-0 lg:pt-0 [&::-webkit-scrollbar]:hidden ${RAIL_CONTENT}`}>
        <HubPreviewFrame>
          <HubArticlePreview
            title={title}
            dek={dek}
            dekPending={dekPending}
            tags={publish.tags}
            coverImageUrl={coverImageUrl}
            coverAspectRatio={coverAspectRatio}
            bodyMarkdown={draftMd}
            meta={`${readMinutes} min read`}
          />
        </HubPreviewFrame>
      </div>

      {/* Clears the floating pill (68px) and its scrim, which is only fully
          transparent at 112px — top-24 parked the rail behind a partial veil. */}
      <div className={`contents lg:block lg:sticky lg:top-[4.5rem] ${RAIL_COLUMN}`}>
        <PublishRail
          projectId={projectId}
          publish={publish}
          published={published}
          anthropicReady={anthropicReady}
          hubConfigured={hubConfigured}
          publishedHubUrl={publishedHubUrl}
          publishedHubAdminUrl={publishedHubAdminUrl}
        />
      </div>
    </div>
  );
}

/**
 * The steps a publish actually moves through, in order. As with preparation
 * there is no progress channel back — publishToHubAction is one call — so this
 * advances on elapsed time and the labels name work attempted, never a result
 * claimed. The cover upload really is conditional server-side (no image, or a
 * failed upload, does not block the publish), which is why its note says so.
 */
const PUBLISH_STEPS = [
  { at: 0, label: "Preparing the article", note: "Title, dek and body." },
  { at: 2, label: "Uploading the cover", note: "Skipped if there is no image." },
  { at: 6, label: "Sending it to the Hub", note: "Converting and saving." },
] as const;

/**
 * The working state for a publish.
 *
 * It replaces the buttons rather than sitting beneath them. Leaving a disabled
 * CTA on screen was the whole problem: the only feedback a publish gave was
 * that button going grey, which reads as a dead control rather than work in
 * progress — and the "Publishing…" label lived on the confirm panel, which
 * send() unmounts on the same tick, so nobody ever saw it.
 */
/**
 * The CMS page for a draft saved before its CMS address was recorded.
 *
 * Only its public URL is on record, and that page 404s for a draft. The slug is
 * the last segment of it, and the CMS list filtered to that slug is one click
 * from the article.
 */
function cmsUrlForHubPage(publicUrl: string): string | undefined {
  try {
    const url = new URL(publicUrl);
    const slug = url.pathname.split("/").filter(Boolean).pop();
    if (!slug) return undefined;
    return `${url.origin}/admin/collections/articles?where[slug][equals]=${encodeURIComponent(slug)}`;
  } catch {
    return undefined;
  }
}

function PublishingPanel({ status }: { status: "draft" | "published" }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // The last step holds until the action resolves and this panel unmounts, so
  // the rail cannot show a finish the server has not reached.
  let active = 0;
  for (let i = 0; i < PUBLISH_STEPS.length; i++) if (elapsed >= PUBLISH_STEPS[i].at) active = i;

  return (
    <div className="rounded-2xl bg-sunken p-3.5" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink">
          {status === "published" ? "Publishing to the Hub" : "Saving a draft to the Hub"}
        </p>
        <span className="font-mono text-xs tabular-nums text-ink-3" aria-label={`${elapsed} seconds elapsed`}>
          {`0:${String(elapsed % 60).padStart(2, "0")}`}
        </span>
      </div>

      <ol className="mt-3 space-y-2.5">
        {PUBLISH_STEPS.map((step, i) => {
          const state = i < active ? "done" : i === active ? "active" : "pending";
          return (
            <li key={step.label} className="flex gap-3">
              <span className="relative mt-[5px] flex size-2 shrink-0 items-center justify-center">
                {state === "active" && (
                  <span className="cs-ping absolute inline-flex size-2 rounded-full bg-accent" aria-hidden="true" />
                )}
                <span
                  className="relative inline-flex size-2 rounded-full transition-all duration-(--duration-slow) ease-(--ease-spring)"
                  style={{
                    background:
                      state === "pending" ? "transparent" : state === "done" ? "var(--ink-300)" : "var(--accent)",
                    boxShadow: state === "pending" ? "inset 0 0 0 1.5px var(--ink-200)" : "none",
                  }}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block text-xs font-medium transition-colors duration-(--duration-slow) ease-(--ease-spring)"
                  style={{
                    color:
                      state === "pending"
                        ? "var(--ink-400)"
                        : state === "done"
                          ? "var(--ink-secondary)"
                          : "var(--accent-press)",
                  }}
                >
                  {step.label}
                </span>
                {state === "active" && (
                  <>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{step.note}</span>
                    {/* Indeterminate: there is no real percentage to report. */}
                    <span
                      className="mt-2 block h-[3px] w-full overflow-hidden rounded-full"
                      style={{ background: "var(--accent-tint)" }}
                      aria-hidden="true"
                    >
                      <span className="cs-sweep block h-full w-1/4 rounded-full" style={{ background: "var(--accent)" }} />
                    </span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-3.5 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-3">
        Keep this tab open — it finishes here and shows you the link.
      </p>
    </div>
  );
}

/**
 * The action rail beside the preview: article status, the taxonomy it will
 * publish under, the publish actions (live — inline-confirmed — or a Hub draft
 * to review the Thai translation first), and a quiet brand review with inline
 * findings. Category/tags derive from the content direction; the dek and Thai
 * translation are handled Hub-side.
 */
function PublishRail({
  projectId,
  publish,
  published,
  anthropicReady,
  hubConfigured,
  publishedHubUrl,
  publishedHubAdminUrl,
}: {
  projectId: string;
  publish: PublishMetadata;
  published: boolean;
  anthropicReady: boolean;
  hubConfigured: boolean;
  publishedHubUrl?: string;
  publishedHubAdminUrl?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"draft" | "published" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [coverWarning, setCoverWarning] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; adminUrl?: string; status: string } | undefined>(
    publishedHubUrl
      ? {
          url: publishedHubUrl,
          adminUrl: publishedHubAdminUrl ?? cmsUrlForHubPage(publishedHubUrl),
          status: published ? "published" : "draft",
        }
      : undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [reviewing, startReview] = useTransition();
  const [review, setReview] = useState<BrandReviewResult | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const canPublish = publish.tags.length > 0;
  const disabled = busy !== null || !hubConfigured || !canPublish;
  const isLive = published || result?.status === "published";

  async function send(status: "draft" | "published") {
    setError(null);
    setCoverWarning(null);
    setConfirming(false);
    setBusy(status);
    try {
      const r = await publishToHubAction(projectId, status);
      // The action reports failure as data; a thrown server-action error is
      // redacted in production and says nothing about what the Hub refused.
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setResult({ url: r.url, adminUrl: r.adminUrl, status: r.status });
      /* The article went up; the cover may not have. Not an error — the publish
         succeeded — so it is said beside the result rather than in place of it. */
      setCoverWarning(r.coverWarning ?? null);
      // The action no longer revalidates — doing so re-rendered the route
      // inside its own response and reported a failure for a publish that had
      // already succeeded. This refresh is a separate request with its own
      // budget, and it runs only once the publish is known to be good.
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Publishing to the Hub failed.");
    } finally {
      setBusy(null);
    }
  }

  function reviewArticle() {
    setReviewError(null);
    startReview(async () => {
      try {
        setReview(await reviewBrandAlignmentAction(projectId));
      } catch (cause) {
        setReviewError(cause instanceof Error ? cause.message : "The brand review could not be completed.");
      }
    });
  }

  const findings = review?.checks.filter((check) => check.status === "review") ?? [];

  /* ONE DEFINITION, TWO HOMES — the rail panel on a desktop, the sheet's body
     on a phone. It was written out twice, which is how the standing subline
     came to appear both as the sheet's own subtitle and again inside it. The
     subline stays with the rail, because the sheet has a place for it already. */
  const brandBody = (
    <>
          {!anthropicReady && <p className="mt-2 text-sm text-ink-2">Configure Anthropic to run the review.</p>}
          {reviewError && <p className="mt-2 text-sm text-danger" role="alert">{reviewError}</p>}
          {review && (
            <div className="mt-3" aria-live="polite">
              <p className={`text-sm font-medium ${findings.length ? "text-ink" : "text-ok-ink"}`}>
                {findings.length ? review.summary : "No issues need attention."}
              </p>
              {findings.length > 0 && (
                <ul className="mt-3 space-y-3 border-t border-line pt-3">
                  {findings.map((check, index) => (
                    <li key={`${check.criterion}-${index}`}>
                      <p className="text-sm font-semibold text-ink">{check.criterion}</p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-2">{check.finding}</p>
                      <p className="mt-1.5 text-sm font-medium text-accent-ink">Suggested edit: {check.suggestion}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={reviewArticle}
            disabled={reviewing || !anthropicReady}
            /* The same treatment as Apply revision: this is its panel's own
               action, and an outlined button is what that weight looks like
               here. `cs-tool` is the borderless one, which the rail keeps for
               the quiet action at the foot of a panel — Regenerate the draft. */
            className="cs-btn mt-4 w-full justify-center"
          >
            {reviewing ? "Reviewing…" : review ? "Check again" : "Run brand check"}
          </button>
    </>
  );

  return (
    <>
      <div aria-labelledby="publish-heading" className="hidden space-y-4 lg:block">
      {/* Where it lands and the act of sending it are one decision, so they are
          one block: taxonomy above the rule, actions below it. Publishing is
          public and the draft save is not, so the two stop being full-width
          buttons that differ only by fill. */}
      <section className="cs-bezel">
        <div className="cs-bezel-core p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="publish-heading" className="font-heading text-[length:var(--text-h3)] font-medium tracking-tight text-ink">Publish to the Hub</h2>
            {isLive ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 text-xs font-semibold text-ok-ink">
                <span className="size-1.5 rounded-full bg-ok" aria-hidden="true" />
                Published
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-sunken px-2.5 py-1 text-xs font-semibold text-ink-2">
                Draft
              </span>
            )}
          </div>
          {/* THE SUBLINE EVERY OTHER PANEL HAS, at the length they all are: one
              sentence. The first pass ran to two, and the second of them —
              "This article is live" — was already on the badge beside the
              heading. What is left says the thing the buttons cannot, which is
              that pressing is public and immediate. */}
          {/* Only before it is live. Once published, the badge beside the
              heading says so and the button says "Republish" — a sentence
              underneath restating that republishing republishes was the panel
              talking for the sake of having a subline. */}
          {!isLive && (
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              Publishing makes it public straight away.
            </p>
          )}
          {/* The pillar + tag are deliberately not shown here. The Hub owns the
              taxonomy (and it has changed — pillars merged/renamed), so echoing a
              category/tag on the CG side only risks contradicting what the editor
              sees once the article is live. The tag is still sent on publish and
              still renders in the faithful Hub preview beside this rail. */}
          {!canPublish && (
            <p className="mt-2 text-sm text-ink-2">No content direction set — add one to publish.</p>
          )}

          <div className="mt-4 space-y-3 border-t border-line pt-4">
          {/* While it runs, the working state stands in for the controls. A
              disabled CTA left on screen was read as a frozen app rather than
              as work in progress. */}
          {busy ? (
            <PublishingPanel status={busy} />
          ) : (
            <>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={disabled || confirming}
            /* `justify-between` and `group` were both for the disc that used
               to ride this button's right edge. With the disc gone, spacing
               "between" one child leaves the label at the start — the only
               left-aligned button in the product. */
            className="cs-cta w-full"
          >
            {isLive ? "Republish to Hub" : "Publish to Hub"}
          </button>

          {/* The confirmation opens below the trigger rather than replacing it.
              Replacing it in place put "Publish live" under a cursor that had
              just clicked, one stray double-click from making an article
              public. */}
          {confirming && (
            <div
              className="space-y-3 rounded-2xl bg-sunken p-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200"
              aria-live="polite"
            >
              <p className="text-sm leading-relaxed text-ink-2">
                Goes live and public on the Hub, auto-translated to Thai — editable in the Hub after.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirming(false)} disabled={busy !== null} className="cs-btn flex-1">
                  Cancel
                </button>
                <button type="button" onClick={() => void send("published")} disabled={busy !== null} className="cs-btn-primary flex-1">
                  Publish live
                </button>
              </div>
            </div>
          )}

          {/* Outlined, like every other panel action in the pipeline — Apply
              revision, Regenerate the draft, Run brand check. This was the last
              borderless one, which made the only alternative to publishing look
              like the least of the buttons rather than the other choice.

              "instead" went with it. The word was doing the work the position
              already does: it sits directly under the publish button, so what
              it is an alternative TO is not in question. */}
          <button type="button" onClick={() => void send("draft")} disabled={disabled} className="cs-btn w-full justify-center">
            Save as a Hub draft
          </button>
            </>
          )}

          {/* The badge above already says what state it is in, so this stops
              restating it and becomes the one thing it can uniquely offer: the
              way there. A real icon rather than an arrow glyph, and it says out
              loud that it leaves the app. */}
          {result?.url && !confirming && !busy && (
            <a
              /* A DRAFT GOES TO THE CMS. Its public page 404s until it is
                 published, so "Review the Hub draft" opened a page that could
                 only say it did not exist. Decided by the status of the LAST
                 save, not by whether the article was ever live: a live article
                 saved back to draft has no public page either. */
              href={result.status === "published" ? result.url : result.adminUrl ?? result.url}
              target="_blank"
              rel="noopener noreferrer"
              /* THE SAME BUTTON AS THE REST OF THE RAIL — 44px, the scale's
                 8px, full width — instead of a 40px pill, which was the last
                 rounded-full control on the stage.

                 Washed accent rather than green. Green was carrying "it
                 worked", which the badge above already says; this is the way
                 THERE, and the accent wash is what the product uses for an
                 action offered without claiming the primary slot — the same
                 treatment as Generate and Auto-draft in the dock. */
              className="cs-btn w-full justify-center gap-2 border-[var(--orange-200)] bg-accent-soft text-accent-press hover:border-[var(--orange-300)] hover:bg-[var(--orange-200)]"
            >
              {result.status === "published" ? "Open on the Hub" : "Open in the CMS"}
              <ExternalLink aria-hidden className="size-4" strokeWidth={1.8} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
          {!hubConfigured && (
            <p className="text-sm text-ink-2">
              Set <code>HUB_BASE_URL</code> and <code>HUB_API_KEY</code> to enable publishing.
            </p>
          )}
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          {/* PUBLISHED, BUT WITHOUT ITS PICTURE. Caution rather than danger: the
              article is live and the link above works. This exists because the
              cover failed silently for ten days — articles arrived at the Hub
              with no image and nothing said so, and a missing cover is
              indistinguishable from one nobody asked for. */}
          {coverWarning && !error && (
            <p className="text-sm text-warn" role="status">
              {coverWarning}
            </p>
          )}
          </div>
        </div>
      </section>

      {/* Sits below the publish block. The check reads the finished article
          against the brand profile; running it before publishing is still the
          useful order, so its findings stay open above the fold once run. */}
      <section className="cs-bezel">
        <div className="cs-bezel-core p-5">
          {/* THE ACTION IS UNDER THE TEXT, not opposite the heading. "Run" was
              a small control floated to the right of a title, so the sentence
              explaining what it does sat BELOW the button that does it — you
              read the label, then the reason, in that order. It also left the
              panel's only action at a different width and altitude from every
              other panel in the rail. Full width at the foot, like Regenerate
              in the Revise panel. */}
          <h3 className="font-heading text-[length:var(--text-h3)] font-medium tracking-tight text-ink">Brand check</h3>
          {!review && anthropicReady && !reviewing && (
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              Reads the finished article against the brand profile before it goes out.
            </p>
          )}
          {brandBody}
        </div>
      </section>
      </div>

      {/* THE RAIL'S TWO PANELS, FOR A PHONE. Publishing is the one forward
          action that is a question rather than a step — live, or a Hub draft? —
          so its corner button opens a menu and asks, which is also the
          confirmation the full-size panel gets from its inline one. */}
      <div className={STAGE_ACTION_SLOT}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            /* A PILL THAT SAYS "PUBLISH", NOT A PAPER PLANE. The other stages'
               corner discs are steps — an arrow onward — but this one is the
               act the whole pipeline ends in, and a glyph left it to be
               guessed. 44 tall like every button on a phone, the accent, and
               the word; it still opens the menu that asks live or draft. The
               word is the button's name, so it needs no separate label. */
            className="inline-flex h-11 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold whitespace-nowrap text-white shadow-[var(--shadow-card)] transition-colors duration-(--duration-fast) ease-(--ease-out) enabled:hover:bg-accent-hover data-[state=open]:bg-accent-hover disabled:cursor-not-allowed disabled:bg-chrome-active disabled:text-ink-3 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
            disabled={disabled}
          >
            {busy ? (
              <>
                <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
                Publishing…
              </>
            ) : isLive ? (
              "Republish"
            ) : (
              "Publish"
            )}
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="bottom"
              align="end"
              sideOffset={8}
              collisionPadding={12}
              /* AS WIDE AS ITS LONGEST LABEL. A fixed 17rem made a menu of two
                 short phrases into a panel two thirds the width of the phone,
                 with the words stranded along its left edge. `w-max` lets the
                 items size it and the viewport cap stops it running off a
                 narrow screen. */
              className="z-(--z-nav-dropdown) w-max max-w-[calc(100vw-1.5rem)] rounded-2xl bg-surface p-2 shadow-[var(--shadow-pop)] outline-none duration-(--motion-enter) ease-(--ease-out) data-closed:duration-(--motion-exit) data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 motion-reduce:animate-none"
            >
              <DropdownMenu.Item
                className="flex min-h-11 cursor-default select-none items-center rounded-lg px-3 text-base text-ink outline-none data-highlighted:bg-sunken"
                onSelect={() => send("published")}
              >
                {isLive ? "Republish to Hub" : "Publish to Hub"}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="flex min-h-11 cursor-default select-none items-center rounded-lg px-3 text-base text-ink outline-none data-highlighted:bg-sunken"
                onSelect={() => send("draft")}
              >
                Save as a Hub draft
              </DropdownMenu.Item>
              {!isLive && (
                /* Fixed width so the sentence WRAPS inside the menu the items
                   sized, rather than being the thing that sizes it. */
                <p className="w-40 px-3 pb-1 pt-2 text-xs leading-relaxed text-ink-3">
                  Publishing makes it public straight away.
                </p>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <StageSheet
        title="Brand check"
        /* ONE SHORT LINE, like every other deck. The old sentence explained
           when the check runs, which the button below it already says. */
        subtitle="Checked against your brand profile."
      >
        {brandBody}
      </StageSheet>
    </>
  );
}
