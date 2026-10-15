/**
 * PREVIEW ONLY (branch preview/article-direction-v1): run one subject through
 * the CURRENT behaviour and the PROPOSED direction, and measure both.
 *
 * Headless, against a SEPARATE test database: run it from an empty working
 * folder with `drizzle` and `node_modules` linked in, and no DATABASE_URL, and
 * it makes its own embedded PGlite there (never Project Friday):
 *
 *   mkdir trial && cd trial
 *   ln -s <repo>/drizzle drizzle && ln -s <repo>/node_modules node_modules
 *   ANTHROPIC_API_KEY=… FAL_KEY=… [UNSPLASH_ACCESS_KEY=…] [HUB_BASE_URL=http://localhost:3000 HUB_API_KEY=…] \
 *   NODE_OPTIONS=--conditions=react-server <repo>/node_modules/.bin/tsx --tsconfig <repo>/tsconfig.json \
 *     <repo>/scripts/direction-trial.mts --name case-study --direction "Case Study" \
 *     --subject "…" --labels '{"pillar":"case_studies","type":"case_study","topic":"branding","keywords":["Visual Identity","Typography"]}' \
 *     [--brief "…"] [--mode both|current|direction] [--publish]
 *
 * The current run is the autopilot's own sequence (plan, draft, cover prompt,
 * reference, cover); the proposed run adds the labels, then fills every body
 * block by its suggested route, as one press of the suggested button would.
 * Results go to ./out/<name>-<mode>.json and .md. Cost is read back from
 * api_usage_log for the project.
 */
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { apiUsageLog, categories, images, projects, users, type ProjectInputs } from "@/db/schema";
import { preparePlanCore } from "@/lib/pipeline/plan";
import { generateDraftCore } from "@/lib/pipeline/draft";
import { generateImagePromptCore } from "@/lib/pipeline/image-prompt";
import { findReferenceImagesCore, generateImagesCore } from "@/lib/pipeline/images";
import { coverFromReferenceCore } from "@/lib/pipeline/sourced-cover";
import { drawBlockImageCore, findBlockImageCore, generateBlockImageCore, holdAsDraftReasons } from "@/lib/pipeline/image-blocks";
import { publishToHubCore } from "@/lib/pipeline/publish";
import { imageGenerationOptions } from "@/lib/image/registry";
import { loadProject } from "@/lib/projects";
import { validateLabels, type ArticleLabels } from "@/lib/direction/labels";
import { effectiveRoute } from "@/lib/direction/image-routing";
import { parseImageBlocks } from "@/lib/direction/image-blocks";
import { checkDraft } from "@/lib/direction/draft-checks";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const name = arg("name") ?? "trial";
const subject = arg("subject");
const direction = arg("direction");
const brief = arg("brief");
const mode = (arg("mode") ?? "both") as "both" | "current" | "direction";
const publish = args.includes("--publish");
if (!subject || !direction) throw new Error("--subject and --direction are required.");
const labelsCheck = validateLabels(JSON.parse(arg("labels") ?? "{}"));
if (mode !== "current" && !labelsCheck.ok) throw new Error(`Invalid --labels: ${labelsCheck.errors.join(" ")}`);
const labels = labelsCheck.ok ? labelsCheck.labels : null;

const outDir = path.join(process.cwd(), "out");
fs.mkdirSync(outDir, { recursive: true });

async function createProject(withLabels: ArticleLabels | null): Promise<string> {
  const db = await getDb();
  const [category] = await db.select().from(categories).where(eq(categories.name, direction!)).limit(1);
  if (!category) throw new Error(`No content direction named "${direction}".`);
  let [user] = await db.select().from(users).where(eq(users.email, "trial@designally.co")).limit(1);
  if (!user) [user] = await db.insert(users).values({ email: "trial@designally.co", name: "Local trial", role: "admin" }).returning();
  const inputs: ProjectInputs = {
    articleMode: "editorial",
    editorialReader: "Designers and creative teams",
    ...(brief ? { brief } : {}),
    ...(withLabels ? { labels: withLabels } : {}),
  };
  const [project] = await db
    .insert(projects)
    .values({
      categoryId: category.id,
      language: "en",
      stage: 3,
      inputs,
      selectedTopic: { title: subject!, source: "custom" },
      createdBy: user.id,
    })
    .returning();
  return project.id;
}

const timed = async <T,>(times: Record<string, number>, key: string, work: () => Promise<T>): Promise<T> => {
  const started = Date.now();
  try {
    return await work();
  } finally {
    times[key] = (times[key] ?? 0) + (Date.now() - started) / 1000;
  }
};

/** The autopilot's cover sequence: a cited page's picture, else a library photo, else generate. */
async function cover(projectId: string, log: string[]) {
  const drafted = await generateImagePromptCore(projectId, { variationCount: 1 });
  const found = await findReferenceImagesCore(projectId, { query: drafted.brief.photoQuery, limit: 2, oneOfEach: true });
  if (found.note) log.push(`cover search: ${found.note}`);
  const fromPage =
    found.references.find((item) => found.subjectIds?.includes(item.id)) ??
    found.references.find((item) => item.origin === "article_source");
  const fromLibrary = found.references.find((item) => item.origin === "open_license");
  for (const candidate of [fromPage, fromLibrary]) {
    if (!candidate) continue;
    try {
      const { image } = await coverFromReferenceCore(projectId, candidate.id);
      log.push(`cover: found (${candidate.origin}) ${candidate.sourceUrl ?? ""}`);
      return image.id;
    } catch (error) {
      log.push(`cover candidate refused: ${error instanceof Error ? error.message : error}`);
    }
  }
  const options = await imageGenerationOptions();
  if (options.length === 0) {
    log.push("cover: none (no image generator configured)");
    return null;
  }
  const reference = fromPage ?? fromLibrary ?? found.references[0];
  const option = (reference && options.find((o) => o.capabilities.referenceImages)) ?? options.find((o) => !o.capabilities.referenceImagesRequired) ?? options[0];
  const prompt = reference && option.capabilities.referenceImages
    ? await generateImagePromptCore(projectId, { variationCount: 1, referenceId: reference.id })
    : drafted;
  try {
    const run = await generateImagesCore(projectId, {
      prompt: prompt.prompt,
      optionId: option.optionId,
      aspectRatio: "16:9",
      variationCount: 1,
      referenceIds: reference && option.capabilities.referenceImages ? [reference.id] : [],
      variantPrompts: prompt.variants.map((variant) => variant.prompt),
    });
    log.push(`cover: generated (${option.label})`);
    return run.images[0]?.id ?? null;
  } catch (error) {
    log.push(`cover: not generated: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

async function runOne(which: "current" | "direction") {
  const times: Record<string, number> = {};
  const log: string[] = [];
  const started = Date.now();
  const projectId = await createProject(which === "direction" ? labels : null);
  await timed(times, "plan", () => preparePlanCore(projectId));
  await timed(times, "draft", () => generateDraftCore(projectId));
  const coverId = await timed(times, "cover", () => cover(projectId, log));
  const db = await getDb();
  if (coverId) {
    const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    await db.update(projects).set({ inputs: { ...row.inputs, coverImageId: coverId } }).where(eq(projects.id, projectId));
  }

  const blocks: Record<string, unknown>[] = [];
  if (which === "direction" && labels) {
    const loaded = await loadProject(projectId);
    const md = (loaded!.drafts.find((d) => d.isSelected) ?? loaded!.drafts[0])?.contentMd ?? "";
    for (const block of parseImageBlocks(md)) {
      const route = effectiveRoute(labels.type, block.suggestedRoute);
      const entry: Record<string, unknown> = { id: block.id, role: block.role, route, purpose: block.purpose, hint: block.searchHint };
      try {
        const result = await timed(times, `block:${route}`, () =>
          route === "find"
            ? findBlockImageCore(projectId, block.id)
            : route === "draw"
              ? drawBlockImageCore(projectId, block.id)
              : route === "generate"
                ? generateBlockImageCore(projectId, block.id)
                : Promise.resolve({ image: null, note: "Upload: waits for a person.", log: { route: "upload" as const, tried: [], judged: 0, rejected: 0 } }),
        );
        Object.assign(entry, {
          filled: Boolean(result.image),
          rights: result.image?.rights ?? null,
          credit: result.image?.credit ?? null,
          sourceUrl: result.image?.sourceUrl ?? null,
          judged: result.log.judged,
          rejected: result.log.rejected,
          note: result.note ?? null,
        });
      } catch (error) {
        Object.assign(entry, { filled: false, error: error instanceof Error ? error.message : String(error) });
      }
      blocks.push(entry);
    }
  }

  let published: unknown = null;
  if (publish) {
    try {
      published = await timed(times, "publish", () => publishToHubCore(projectId, "published"));
    } catch (error) {
      published = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  const loaded = await loadProject(projectId);
  const markdown = (loaded!.drafts.find((d) => d.isSelected) ?? loaded!.drafts[0])?.contentMd ?? "";
  const [usage] = await db
    .select({ cost: sql<string>`coalesce(sum(${apiUsageLog.costUsd}), 0)`, calls: sql<number>`count(*)` })
    .from(apiUsageLog)
    .where(eq(apiUsageLog.projectId, projectId));
  const byStage = await db
    .select({ stage: apiUsageLog.stage, cost: sql<string>`sum(${apiUsageLog.costUsd})`, calls: sql<number>`count(*)` })
    .from(apiUsageLog)
    .where(eq(apiUsageLog.projectId, projectId))
    .groupBy(apiUsageLog.stage);
  const imageRows = await db.select().from(images).where(eq(images.projectId, projectId));

  const result = {
    name,
    mode: which,
    projectId,
    subject,
    labels: which === "direction" ? labels : null,
    seconds: Math.round((Date.now() - started) / 1000),
    times,
    costUsd: Number(usage.cost),
    calls: Number(usage.calls),
    byStage,
    checks: checkDraft(markdown, labels?.type ?? null),
    cover: imageRows
      .filter((row) => row.position === null)
      .map((row) => ({ id: row.id, provider: row.provider, route: row.route, rights: row.rights, credit: row.credit, sourceUrl: row.sourceUrl })),
    blocks,
    heldAsDraft: loaded ? holdAsDraftReasons(loaded) : [],
    log,
    published,
  };
  fs.writeFileSync(path.join(outDir, `${name}-${which}.json`), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, `${name}-${which}.md`), markdown);
  console.log(JSON.stringify({ name, mode: which, seconds: result.seconds, costUsd: result.costUsd, checks: result.checks, blocks }, null, 2));
}

if (mode !== "direction") await runOne("current");
if (mode !== "current") await runOne("direction");
process.exit(0);
