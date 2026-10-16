"use server";

import { unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { projects, categories } from "@/db/schema";
import type { ProjectInputs, Language, SelectedTopic } from "@/db/schema";
import { requireUser } from "@/lib/session";
import type { EditorialFormat } from "@/lib/editorial";
import { getBrand } from "@/lib/brand";
import { getArticleRules } from "@/lib/article-template";
import { buildSystemPrompt, getModels, runJson } from "@/lib/anthropic";
import { articleSetupTask } from "@/prompts/tasks";
import { loadDirections } from "@/lib/pipeline/topics";
import type { TopicIdea } from "@/lib/pipeline/views";
import {
  LABEL_KEYWORDS,
  LABEL_PILLARS,
  LABEL_TOPICS,
  LABEL_TYPES,
  canonicalKeyword,
  validateLabels,
  type ArticleLabels,
} from "@/lib/direction/labels";
import { proposeLabelsTask } from "@/prompts/direction";

/**
 * Decides whether free-text input is a brief (instructions to honor) or a topic
 * (a headline to research). Deliberately biased toward "brief": reading a brief
 * as a topic silently drops the editor's constraints, while reading a short
 * topic as a brief only means the brief is short.
 */
function readsAsBrief(text: string): boolean {
  const value = text.trim();
  if (value.length >= 180) return true;
  if (value.includes("\n")) return true;
  // Two or more sentence terminators mean prose, not a headline.
  if ((value.match(/[.!?](\s|$)/g) ?? []).length >= 2) return true;
  if (value.length >= 120) return true;
  // Instructional wording at moderate length: the editor is directing, not naming.
  return value.length > 60 && /\b(cover|covers|include|includes|explain|audience|readers?|should|make sure|focus on|avoid|tone|angle)\b/i.test(value);
}

function inferEditorialFormat(value: string): EditorialFormat {
  const text = value.toLowerCase();
  if (/\b(compare|comparison|versus|\bvs\.?\b)/.test(text)) return "comparison";
  if (/\b(profile|interview|studio|designer)\b/.test(text)) return "profile";
  if (/\b(trend|trending|popular)\b/.test(text)) return "trend";
  if (/\b(resource|free|website|tool|template)\b/.test(text)) return "resources";
  if (/\b(new|release|launch)\b/.test(text)) return "releases";
  if (/\b(best|top|roundup|collection)\b/.test(text)) return "roundup";
  return "explainer";
}

function extractEditorialPeriod(value: string): string | undefined {
  const match = value.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}\b/i);
  return match?.[0];
}

/** Session-checked wrapper. The work lives in @/lib/pipeline/topics. */
export type ArticleSetup = {
  inputKind: "topic" | "brief";
  directionId: string;
  directionName: string;
  workingTitle: string;
};

/** Resolves the fields the merged composer deliberately leaves implicit. */
export async function inferArticleSetupAction(input: {
  text: string;
  categoryId?: string;
}): Promise<ArticleSetup> {
  await requireUser();
  const text = input.text.trim();
  if (!text) throw new Error("Describe the article you want to create.");

  const directions = await loadDirections();
  const chosenDirection = directions.find((direction) => direction.id === input.categoryId);
  const inputKind = readsAsBrief(text) ? "brief" : "topic";
  const needDirection = !chosenDirection;
  const needTitle = inputKind === "brief";

  if (!needDirection && !needTitle) {
    return {
      inputKind,
      directionId: chosenDirection.id,
      directionName: chosenDirection.name,
      workingTitle: text,
    };
  }

  const [brand, articleRules, models] = await Promise.all([getBrand(), getArticleRules(), getModels()]);
  const { data } = await runJson<{ direction?: string; workingTitle?: string }>({
    model: models.research,
    system: buildSystemPrompt({
      brand,
      articleRules,
      category: null,
      language: "en",
      inputs: { articleMode: "editorial" },
    }),
    task: articleSetupTask({
      text,
      needDirection,
      needTitle,
      directionNames: directions.map((direction) => direction.name),
    }),
    schema: {
      type: "object",
      properties: {
        ...(needDirection ? { direction: { type: "string", enum: directions.map((direction) => direction.name) } } : {}),
        ...(needTitle ? { workingTitle: { type: "string" } } : {}),
      },
      required: [...(needDirection ? ["direction"] : []), ...(needTitle ? ["workingTitle"] : [])],
      additionalProperties: false,
    },
    maxTokens: 220,
    projectId: null,
    stage: "article_setup",
  });

  const inferredDirection = chosenDirection ?? directions.find(
    (direction) => direction.name.toLowerCase() === data.direction?.trim().toLowerCase()
  );
  const workingTitle = (needTitle ? data.workingTitle : text)?.trim();
  if (!inferredDirection || !workingTitle) {
    throw new Error("We could not confidently determine the article setup. Choose a content direction and try again.");
  }

  return {
    inputKind,
    directionId: inferredDirection.id,
    directionName: inferredDirection.name,
    workingTitle,
  };
}

/**
 * PREVIEW ONLY: propose labels for the proposed article direction, for the
 * editor to confirm. Never throws: when the model cannot be asked, or answers
 * with a combination that is not allowed, a safe default comes back with a
 * note, and the editor chooses.
 */
export async function proposeLabelsAction(input: {
  text: string;
  directionName?: string;
}): Promise<{ labels: ArticleLabels; note?: string }> {
  await requireUser();
  const fallbackKeywords = [canonicalKeyword(input.directionName ?? ""), "Design Process", "Visual Identity"]
    .filter((value, index, list): value is string => !!value && list.indexOf(value) === index)
    .slice(0, 2);
  const fallback: ArticleLabels = {
    pillar: "creative_insights",
    type: "explanation",
    topic: "branding",
    topic2: null,
    keywords: fallbackKeywords,
  };
  try {
    const models = await getModels();
    const { data } = await runJson<Record<string, unknown>>({
      model: models.research,
      system: "You label articles for a design publication. Answer with JSON only.",
      task: proposeLabelsTask({ text: input.text.trim().slice(0, 4000), directionName: input.directionName }),
      schema: {
        type: "object",
        properties: {
          pillar: { type: "string", enum: [...LABEL_PILLARS] },
          type: { type: "string", enum: [...LABEL_TYPES] },
          topic: { type: "string", enum: [...LABEL_TOPICS] },
          topic2: { type: "string", enum: ["", ...LABEL_TOPICS] },
          keywords: { type: "array", items: { type: "string", enum: [...LABEL_KEYWORDS] } },
        },
        required: ["pillar", "type", "topic", "topic2", "keywords"],
        additionalProperties: false,
      },
      maxTokens: 300,
      cache: false,
      projectId: null,
      stage: "article_labels",
    });
    const check = validateLabels(data);
    if (check.ok) return { labels: check.labels };
    return { labels: fallback, note: `The proposed labels were not allowed (${check.errors.join(" ")}). Choose them here.` };
  } catch (reason) {
    return {
      labels: fallback,
      note: `Labels could not be proposed (${reason instanceof Error ? reason.message : "unknown error"}). Choose them here.`,
    };
  }
}

/**
 * Create the article and say where it lives.
 *
 * RETURNS THE ADDRESS, NOT A REDIRECT. This ended in `redirect()`, which works
 * by throwing — and the form awaits it inside a try/catch, so the catch got
 * the throw first and put "NEXT_REDIRECT" on screen in red for the moment
 * before the navigation landed. The form now navigates itself, and a real
 * failure comes back as a message: a thrown error is redacted in production.
 */
export async function createProjectAction(
  formData: FormData,
): Promise<{ ok: true; href: string } | { ok: false; message: string }> {
  try {
    return { ok: true, href: await createProject(formData) };
  } catch (reason) {
    // Signed out meanwhile: `requireUser` redirects to /login, and that one must go through.
    unstable_rethrow(reason);
    return {
      ok: false,
      message: reason instanceof Error ? reason.message : "Could not create the article. Choose a direction and try again.",
    };
  }
}

async function createProject(formData: FormData): Promise<string> {
  const user = await requireUser();
  const db = await getDb();

  const categoryRaw = String(formData.get("categoryId") ?? "");
  // Content is English-only; ignore any submitted language.
  const language: Language = "en";

  const [validCategory] = categoryRaw
    ? await db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryRaw)).limit(1)
    : [];
  const categoryId = validCategory?.id ?? null;

  // A content direction is required — it becomes the article's category and its
  // publishing tags, without which the Hub can't accept the article.
  if (!categoryId) {
    throw new Error("Choose a content direction before generating a draft.");
  }

  const articleInput = String(formData.get("articleInput") ?? "").trim();
  const inputKind = String(formData.get("inputKind") ?? "topic");
  const workingTitle = String(formData.get("workingTitle") ?? "").trim();
  const chosenTopic = String(formData.get("chosenTopic") ?? "").trim();
  const chosenAngle = String(formData.get("chosenAngle") ?? "").trim();
  const chosenWhyTimely = String(formData.get("chosenWhyTimely") ?? "").trim();
  const chosenSearchIntent = String(formData.get("chosenSearchIntent") ?? "").trim();
  let chosenResearchSources: { name: string; url: string }[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("chosenResearchSources") ?? "[]")) as unknown;
    if (Array.isArray(parsed)) {
      chosenResearchSources = parsed.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const item = value as Record<string, unknown>;
        const name = typeof item.name === "string" ? item.name.trim() : "";
        const url = typeof item.url === "string" ? item.url.trim() : "";
        try {
          const target = new URL(url);
          return name && (target.protocol === "https:" || target.protocol === "http:") ? [{ name, url: target.toString() }] : [];
        } catch {
          return [];
        }
      }).slice(0, 3);
    }
  } catch {
    // Ignore malformed client data and perform normal article research.
  }
  const seedText = chosenTopic || workingTitle || articleInput;

  /* PREVIEW ONLY: labels for the proposed article direction. Checked again
     here, whatever the browser sent: an invalid combination is refused. */
  let labels: ArticleLabels | undefined;
  const labelsRaw = String(formData.get("labels") ?? "").trim();
  if (labelsRaw) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(labelsRaw);
    } catch {
      throw new Error("The article labels could not be read.");
    }
    const check = validateLabels(parsed);
    if (!check.ok) throw new Error(`These labels are not allowed: ${check.errors.join(" ")}`);
    labels = check.labels;
  }

  const inputs: ProjectInputs = {
    articleMode: "editorial",
    brief: inputKind === "brief" ? articleInput : undefined,
    editorialFormat: inferEditorialFormat(seedText),
    editorialPeriod: extractEditorialPeriod(seedText),
    editorialReader: "Designers and creative teams",
    editorialEntryCount: 10,
    ...(labels ? { labels } : {}),
  };

  let selectedTopic: SelectedTopic | null = null;
  if (chosenTopic) {
    selectedTopic = {
      title: chosenTopic,
      angle: chosenAngle || undefined,
      whyTimely: chosenWhyTimely || undefined,
      searchIntent: chosenSearchIntent || undefined,
      researchSources: chosenResearchSources.length ? chosenResearchSources : undefined,
      source: "suggested",
    };
  } else if (workingTitle && articleInput) {
    selectedTopic = inputKind === "brief"
      ? { title: workingTitle, angle: articleInput, source: "brief" }
      : { title: workingTitle, source: "custom" };
  }

  const [project] = await db
    .insert(projects)
    .values({
      categoryId,
      language,
      status: "draft",
      stage: selectedTopic ? 3 : 2,
      inputs,
      selectedTopic,
      createdBy: user.id,
    })
    .returning();

  const nextStage = selectedTopic ? 3 : 2;
  return `/pipeline/${project.id}?stage=${nextStage}`;
}
