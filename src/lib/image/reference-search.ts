import "server-only";
import { getModels, runJson, type PromptImage } from "@/lib/anthropic";
import { IMAGE_SYSTEM_PROMPT } from "@/prompts/system";
import { referenceJudgeTask, referenceSearchPlanTask } from "@/prompts/tasks";
import {
  downloadHit,
  downloadPreview,
  fingerprint,
  hasUnsplashKey,
  searchOpenverse,
  searchUnsplash,
  type ReferenceCandidate,
  type ReferenceHit,
} from "./reference-sources";

/**
 * Finding a RELATED photograph, not an identical one.
 *
 * The search this replaces sent one query — the brief's photo query, or the
 * article's headline when there was no brief — and attached whatever came back
 * first. A headline finds nothing ("No photographs came back for 'Why
 * Micro-Animations Are Becoming the New Standard for Brand Websites'"), and a
 * single literal query finds the wrong world: an article about motion in design
 * is answered with people running under motion blur.
 *
 * So it is three steps, each answering one question:
 *
 *   1. PLAN — what would a related photograph show? A ladder of searches from
 *      the best kind (the work being done: an animation timeline on a monitor)
 *      to the acceptable kind (the subject without the work: animated graphic
 *      shapes), and the wrong readings to steer clear of.
 *   2. SEARCH — fill a small pool from the top of the ladder down, reading
 *      result metadata only.
 *   3. JUDGE — look at every candidate's preview and rule best, acceptable or
 *      reject. Only the survivors are downloaded, best first.
 *
 * Both model calls use the research model (Haiku by default): each is a short,
 * bounded judgement, and they have to fit inside a sixty-second function
 * alongside everything else a Find or an autopilot step does.
 */

export type ReferenceSearchPlan = {
  queries: { text: string; tier: "best" | "acceptable" }[];
  avoid: string[];
};

type Verdict = "best" | "acceptable" | "reject";

export type RelatedReferenceSearch = {
  candidates: ReferenceCandidate[];
  /** The searches actually sent, in order. */
  queries: string[];
  /** How many distinct results came back across them. */
  found: number;
  /** How many of those the judge turned down. */
  rejected: number;
  /** False when no plan could be written and there was no brief query to fall back on. */
  planned: boolean;
  /** False when the judge could not run. */
  judged: boolean;
};

/**
 * How many results the judge sees. Enough that a strict judge still leaves
 * something; few enough that fetching their previews and judging them fits in
 * the time a step has.
 */
const POOL_SIZE = 12;

/**
 * Results taken from each search. Small on purpose: at four apiece the pool
 * draws on three searches rather than one, so it usually holds some of the
 * acceptable tier as well — and a judge who turns down every "best" result
 * still has something to choose from.
 */
const PER_QUERY = 4;

const PLAN_TIMEOUT_MS = 15_000;
const JUDGE_TIMEOUT_MS = 20_000;

const clean = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Step one: decide what a related photograph would show, and what it must not. */
export async function planReferenceSearch(params: {
  projectId: string;
  title: string;
  angle?: string;
  article?: string;
  seedQuery?: string;
}): Promise<ReferenceSearchPlan> {
  const { research } = await getModels();
  const { data } = await runJson<ReferenceSearchPlan>({
    model: research,
    system: IMAGE_SYSTEM_PROMPT,
    task: referenceSearchPlanTask({
      title: params.title,
      angle: params.angle,
      article: params.article,
      seedQuery: clean(params.seedQuery, 80) || undefined,
    }),
    schema: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              tier: { type: "string", enum: ["best", "acceptable"] },
            },
            required: ["text", "tier"],
            additionalProperties: false,
          },
        },
        avoid: { type: "array", items: { type: "string" } },
      },
      required: ["queries", "avoid"],
      additionalProperties: false,
    },
    maxTokens: 600,
    timeoutMs: PLAN_TIMEOUT_MS,
    // A heal doubles the call; this runs inside a step with a deadline.
    allowHeal: false,
    // The system prompt is under the research model's cache minimum.
    cache: false,
    projectId: params.projectId,
    stage: "reference_search_plan",
    validate: (raw) => {
      const input = raw as { queries?: { text?: unknown; tier?: unknown }[]; avoid?: unknown[] };
      const seen = new Set<string>();
      const queries = (Array.isArray(input.queries) ? input.queries : [])
        .map((query) => ({
          text: clean(query?.text, 60),
          tier: query?.tier === "acceptable" ? ("acceptable" as const) : ("best" as const),
        }))
        .filter((query) => {
          const key = query.text.toLowerCase();
          if (!query.text || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 6);
      if (queries.length === 0) throw new Error("queries must contain at least one search");
      // Best before acceptable whatever order they came in; the sort is stable,
      // so the model's order within a tier is kept.
      queries.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "best" ? -1 : 1));
      const avoid = (Array.isArray(input.avoid) ? input.avoid : [])
        .map((phrase) => clean(phrase, 80))
        .filter(Boolean)
        .slice(0, 5);
      return { queries, avoid };
    },
  });
  return data;
}

/** Step three: look at each candidate and rule on it. */
async function judgeHits(params: {
  projectId: string;
  title: string;
  angle?: string;
  plan: ReferenceSearchPlan;
  hits: ReferenceHit[];
  previews: PromptImage[];
}): Promise<Verdict[]> {
  const { research } = await getModels();
  const { data } = await runJson<{ verdicts: Verdict[] }>({
    model: research,
    system: IMAGE_SYSTEM_PROMPT,
    task: referenceJudgeTask({
      title: params.title,
      angle: params.angle,
      best: params.plan.queries.filter((query) => query.tier === "best").map((query) => query.text),
      acceptable: params.plan.queries
        .filter((query) => query.tier === "acceptable")
        .map((query) => query.text),
      avoid: params.plan.avoid,
      captions: params.hits.map((hit) => hit.caption),
    }),
    images: params.previews,
    schema: {
      type: "object",
      properties: {
        verdicts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              candidate: { type: "integer" },
              verdict: { type: "string", enum: ["best", "acceptable", "reject"] },
            },
            required: ["candidate", "verdict"],
            additionalProperties: false,
          },
        },
      },
      required: ["verdicts"],
      additionalProperties: false,
    },
    maxTokens: 800,
    timeoutMs: JUDGE_TIMEOUT_MS,
    allowHeal: false,
    cache: false,
    projectId: params.projectId,
    stage: "reference_judge",
    validate: (raw) => {
      const list = (raw as { verdicts?: { candidate?: unknown; verdict?: unknown }[] }).verdicts;
      // Anything the judge did not rule on is turned down: silence is not approval.
      const verdicts: Verdict[] = params.hits.map(() => "reject");
      for (const item of Array.isArray(list) ? list : []) {
        const n = Number(item?.candidate);
        if (!Number.isInteger(n) || n < 1 || n > params.hits.length) continue;
        if (item.verdict === "best" || item.verdict === "acceptable") verdicts[n - 1] = item.verdict;
      }
      return { verdicts };
    },
  });
  return data.verdicts;
}

/**
 * Plan, search, judge, and download what survives — up to `limit` photographs,
 * best first.
 */
export async function findRelatedReferences(params: {
  projectId: string;
  title: string;
  angle?: string;
  /** The opening of the article, so the plan reads what it is about rather than guessing from a headline. */
  article?: string;
  /** The image brief's own query, when one has been drafted. A hint to the plan, and the fallback without one. */
  seedQuery?: string;
  limit: number;
}): Promise<RelatedReferenceSearch> {
  const result: RelatedReferenceSearch = {
    candidates: [],
    queries: [],
    found: 0,
    rejected: 0,
    planned: true,
    judged: false,
  };
  if (params.limit <= 0) return result;

  // ---- 1. plan --------------------------------------------------------------

  let plan: ReferenceSearchPlan;
  try {
    plan = await planReferenceSearch(params);
  } catch {
    /* NEVER THE HEADLINE. Without a plan the brief's own query is still a
       description of a picture, so it is used on its own. Without that too,
       there is nothing worth sending: a headline is what found nothing before. */
    const seed = clean(params.seedQuery, 60);
    if (!seed) return { ...result, planned: false };
    plan = { queries: [{ text: seed, tier: "best" }], avoid: [] };
  }

  // ---- 2. search ------------------------------------------------------------

  type PoolEntry = { hit: ReferenceHit; tier: "best" | "acceptable" };
  const pool: PoolEntry[] = [];
  const seenKeys = new Set<string>();
  const seenSources = new Set<string>();

  const fill = async (search: typeof searchUnsplash, queries: ReferenceSearchPlan["queries"]) => {
    // Sequential, top of the ladder first, stopping when the pool is full: the
    // Unsplash key is rate limited per hour, and the lower rungs are only
    // needed when the upper ones come back thin.
    for (const query of queries) {
      if (pool.length >= POOL_SIZE) break;
      result.queries.push(query.text);
      for (const hit of await search(query.text, PER_QUERY)) {
        if (pool.length >= POOL_SIZE) break;
        if (seenKeys.has(hit.key) || seenSources.has(hit.sourceUrl)) continue;
        seenKeys.add(hit.key);
        seenSources.add(hit.sourceUrl);
        pool.push({ hit, tier: query.tier });
      }
    }
  };

  if (hasUnsplashKey()) await fill(searchUnsplash, plan.queries);
  /* Openverse where there is no key, and where Unsplash had nothing at all —
     acceptable rungs FIRST there. It is an archive of openly licensed work, not
     a library of people at screens: measured on an article about motion on
     brand websites, it returned nothing for "loading spinner animation screen"
     and results for the subject matter itself. Three searches, because its
     anonymous rate limit is small. */
  if (pool.length === 0) {
    const archiveOrder = [
      ...plan.queries.filter((query) => query.tier === "acceptable"),
      ...plan.queries.filter((query) => query.tier === "best"),
    ];
    await fill(searchOpenverse, archiveOrder.slice(0, 3));
  }
  result.found = pool.length;
  if (pool.length === 0) return result;

  // ---- 3. judge -------------------------------------------------------------

  /* The small rendition first, the file itself where that fails: Openverse's
     thumbnail endpoint answers an image request with 406, while the file it
     stands for is an ordinary JPEG. A file over the preview cap is left out. */
  const previews = await Promise.all(
    pool.map(
      async (entry) =>
        (await downloadPreview(entry.hit.previewUrl)) ??
        (entry.hit.imageUrl !== entry.hit.previewUrl ? await downloadPreview(entry.hit.imageUrl) : null)
    )
  );
  const visible = pool
    .map((entry, index) => ({ ...entry, preview: previews[index] }))
    .filter((entry): entry is PoolEntry & { preview: PromptImage } => entry.preview !== null);

  let ranked: ReferenceHit[] = [];
  if (visible.length > 0) {
    try {
      const verdicts = await judgeHits({
        projectId: params.projectId,
        title: params.title,
        angle: params.angle,
        plan,
        hits: visible.map((entry) => entry.hit),
        previews: visible.map((entry) => entry.preview),
      });
      result.judged = true;
      const best = visible.filter((_, index) => verdicts[index] === "best").map((entry) => entry.hit);
      const acceptable = visible
        .filter((_, index) => verdicts[index] === "acceptable")
        .map((entry) => entry.hit);
      result.rejected = visible.length - best.length - acceptable.length;
      ranked = [...best, ...acceptable];
    } catch {
      /* The judge could not run. The results the plan aimed highest at are
         still far closer than anything the old single query found, so those —
         and only those — are kept, unjudged. The lower rungs are exactly where
         a wrong reading gets in. */
      ranked = visible.filter((entry) => entry.tier === "best").map((entry) => entry.hit);
    }
  }

  // ---- 4. download ----------------------------------------------------------

  const bytes = new Set<string>();
  for (const hit of ranked) {
    if (result.candidates.length >= params.limit) break;
    const candidate = await downloadHit(hit);
    if (!candidate) continue;
    const print = fingerprint(candidate.data);
    if (bytes.has(print)) continue;
    bytes.add(print);
    result.candidates.push(candidate);
  }
  return result;
}
