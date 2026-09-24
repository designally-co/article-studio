import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { articlesStartedBefore, coverImage, loadProject } from "@/lib/projects";
import { rotateAspectRatio } from "@/lib/autopilot/views";
import { publishMetadata } from "@/lib/publish-meta";
import { isAnthropicConfigured } from "@/lib/anthropic";
import { isHubConfigured } from "@/lib/hub";
import { imageGenerationOptions } from "@/lib/image/registry";
import { Stepper } from "@/components/stepper";
import { TopBlur } from "@/components/page-bar";
import { PrepareDraftStage } from "./stages/prepare-draft-stage";
import { DraftsStage } from "./stages/drafts-stage";
import { PublishStage } from "./stages/publish-stage";

export const dynamic = "force-dynamic";
/** The research plan, image generation and publishing all run as actions on
 *  this page, and each can outlast the platform default. See the note on the
 *  Create page. */
export const maxDuration = 60;

/** Every pipeline tab used to read "Designally Content Studio", so two open
 *  articles were indistinguishable from the tab strip alone. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const loaded = await loadProject(id);
  const name = loaded?.project.selectedTopic?.title?.trim();
  return { title: `${name || "Untitled article"} · Article Studio` };
}

/** Parse an aspect-ratio string ("16:9", "3:2", "1:1") to width/height. Falls
 * back to 3:2 when unset or malformed; clamped to a sane range. */
function parseAspectRatio(raw: string | undefined): number {
  const m = raw?.match(/^\s*(\d+(?:\.\d+)?)\s*[:/xX]\s*(\d+(?:\.\d+)?)\s*$/);
  const ratio = m ? Number(m[1]) / Number(m[2]) : NaN;
  if (!Number.isFinite(ratio) || ratio <= 0) return 1.5;
  return Math.min(3, Math.max(0.4, ratio));
}

export default async function PipelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string; view?: string }>;
}) {
  const { id } = await params;
  const { stage: stageParam, view: viewParam } = await searchParams;
  const loaded = await loadProject(id);
  if (!loaded) notFound();

  const reached = loaded.project.stage;
  const requested = stageParam ? parseInt(stageParam, 10) : reached;
  const current = Math.min(
    Math.max(Number.isNaN(requested) ? reached : requested, 1),
    reached,
  );

  const anthropicReady = await isAnthropicConfigured();
  const imageOptions = await imageGenerationOptions();
  const title = loaded.project.selectedTopic?.title;
  const published = loaded.project.status === "published";
  // Only one image reaches the Hub, and `coverImage` is the single answer to
  // which one — shared with publishing, which used to decide separately and
  // disagree.
  const cover = coverImage(loaded);
  /* THE SHAPE AN UNCHOSEN COVER STARTS AT. It was always 1:1, so a Hub page of
     hand-made articles was a column of squares, while routines already rotated
     wide, classic, portrait and square. The same rotation now applies here, by
     the article's place among all of them. A shape the editor has generated at
     is saved on the article and wins. A photograph used as the cover as it is
     keeps its own shape and is not affected by any of this. */
  const imageAspectRatio =
    loaded.project.inputs.imageAspectRatio ??
    rotateAspectRatio(null, await articlesStartedBefore(loaded.project.createdAt));
  // Cover aspect ratio (width / height) — drives the preview hero's 50% overflow.
  const coverAspectRatio = parseAspectRatio(
    cover?.aspectRatio ?? imageAspectRatio,
  );
  const finalizeView: "images" | "complete" =
    viewParam === "images" || viewParam === "complete"
      ? viewParam
      : published
        ? "complete"
        : "images";

  return (
    /* The 48px menu strip is a SIBLING of this page, not part of it, so
       `min-h-screen` here asked for a full viewport BELOW a bar that had
       already taken 48 of it — every stage was 48px taller than the phone and
       scrolled by exactly that much with nothing in the gap. */
    <div className="flex min-h-[calc(100dvh-3rem)] flex-col lg:min-h-screen">
      {/* A floating pill carrying only the stepper. Each stage names the article
          in its own body, so repeating it in the chrome said nothing the content
          was not already saying; the browser tab carries identity for anyone
          scanning across windows. */}
      {/* Offset below the app's mobile header rather than pinned over it — both
          were at 0 in one scroll root, which put the stepper on top of the
          hamburger. The pill itself stays: it is progress, not a title bar. */}
      {/* NO ISLAND. The steps sat on a blurred glass pill with an inset ring
          and a shadow, over a gradient scrim painted to stop the page colliding
          with it — a floating surface, and the scrim existed only to manage the
          consequences of floating. On the page itself, on the same gutter as
          everything else, it needs neither. */}
      {/* BESIDE THE MENU BUTTON, NOT UNDER IT. The rail's button claims a 48px
          line at the top of a phone and only its own width of it; this pulls
          the stepper up onto that same line, so the top of the screen is one
          row — a button, then the progress — instead of two bands of chrome
          stacked above an article.

          `py-2` rather than `py-3` is what makes the heights agree: 8 + the
          32px pill + 8 is the 48 the button's line is tall. They both stick to
          the top, so a disagreement here would show as a step of background
          against the button while scrolling. Above `lg` the rail is a sidebar,
          there is no button, and the row goes back to its own line. */}
      <div className="sticky top-0 z-(--z-sticky) mx-auto -mt-12 w-full max-w-7xl px-3 py-2 sm:px-8 lg:mt-0 lg:px-12 lg:py-3 xl:px-16">
        <TopBlur />
        <Stepper
          projectId={id}
          current={current}
          reached={reached}
          finalizeView={finalizeView}
        />
      </div>

      <div className="flex-1">
        {current <= 3 && (
          <PrepareDraftStage
            projectId={id}
            selected={loaded.project.selectedTopic ?? null}
            anthropicReady={anthropicReady}
          />
        )}
        {(current === 4 || current === 5) && (
          <DraftsStage
            projectId={id}
            drafts={loaded.drafts.map((d) => ({
              id: d.id,
              variationNo: d.variationNo,
              contentMd: d.contentMd,
              isSelected: d.isSelected,
            }))}
            refinements={loaded.refinements.map((revision) => ({
              id: revision.id,
              userMessage: revision.userMessage,
              resultMd: revision.resultMd,
            }))}
            targetLength={loaded.articleRules.length}
            anthropicReady={anthropicReady}
          />
        )}
        {current === 6 && (
          <PublishStage
            projectId={id}
            title={title ?? "Untitled project"}
            publish={publishMetadata(loaded.category?.name)}
            draftId={
              (loaded.drafts.find((d) => d.isSelected) ?? loaded.drafts[0])
                ?.id ?? ""
            }
            longForm={loaded.articleRules.longForm}
            draftMd={
              (loaded.drafts.find((d) => d.isSelected) ?? loaded.drafts[0])
                ?.contentMd ?? ""
            }
            coverImageUrl={cover ? `/api/images/${cover.id}` : null}
            coverAspectRatio={coverAspectRatio}
            coverImageId={cover?.id ?? null}
            coverCredits={loaded.project.inputs.coverCredits ?? {}}
            initialDek={loaded.project.inputs.publishDek ?? null}
            published={published}
            images={loaded.images.map((img) => ({
              id: img.id,
              url: `/api/images/${img.id}`,
              provider: img.provider,
              model: img.model,
              aspectRatio: img.aspectRatio,
              variationNo: img.variationNo,
            }))}
            imageReferences={loaded.imageReferences.map((ref) => ({
              id: ref.id,
              url: `/api/image-references/${ref.id}`,
              name: ref.originalName,
              width: ref.width,
              height: ref.height,
              origin: ref.origin,
              sourceUrl: ref.sourceUrl,
              sourceName: ref.sourceName,
              license: ref.license,
            }))}
            imageConfig={{
              optionId: loaded.project.inputs.imageProvider
                ? `${loaded.project.inputs.imageProvider}::${loaded.project.inputs.imageApiKeyId ?? ""}`
                : "",
              count: loaded.project.inputs.imageCount ?? 1,
              aspectRatio: imageAspectRatio,
            }}
            options={imageOptions}
            initialView={finalizeView}
            anthropicReady={anthropicReady}
            /* Look for reference photographs on arrival when nobody chose this
               topic by hand — it came from a suggestion, a shortcut card or a
               routine — and nobody has looked yet. Once per article: see
               `referencesSearchedAt`. */
            autoFindReferences={
              (loaded.project.selectedTopic?.source === "suggested" ||
                loaded.project.selectedTopic?.source === "edited") &&
              !loaded.project.inputs.referencesSearchedAt &&
              loaded.imageReferences.length === 0 &&
              loaded.images.length === 0 &&
              !published
            }
            hubConfigured={isHubConfigured()}
            publishedHubUrl={
              (loaded.project.publishedTo as Record<string, string> | null)
                ?.knowledgeHub
            }
            publishedHubAdminUrl={
              (loaded.project.publishedTo as Record<string, string> | null)
                ?.knowledgeHubAdmin
            }
          />
        )}
      </div>
    </div>
  );
}
