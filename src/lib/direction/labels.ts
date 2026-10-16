/**
 * Article labels for the proposed article direction (preview only).
 *
 * TEMPORARY, AND ARTICLE STUDIO ONLY. This is the label set from the Labs page
 * "Proposal: one article direction with in-body images", built on the branch
 * `preview/article-direction-v1` to test the proposal end to end. It is not an
 * approved direction. The Hub's taxonomy is untouched: publishing still sends
 * the one content-direction tag it always has.
 *
 * A project carries labels in `inputs.labels`. A project WITHOUT labels keeps
 * the current behaviour in every stage, which is what lets one article be run
 * both ways and compared.
 *
 * A plain module with relative imports only, so `node --test` can load it.
 */
import { CONTENT_DIRECTIONS } from "../content-pillars";

export const LABEL_PILLARS = ["creative_insights", "all_things_ai", "case_studies", "guides_workflows"] as const;
export const LABEL_TYPES = [
  "news",
  "explanation",
  "commentary",
  "case_study",
  "tutorial",
  "business_guide",
  "resources",
] as const;
export const LABEL_TOPICS = ["branding", "visual_design", "websites_ux", "ai", "creative_business"] as const;

export type LabelPillar = (typeof LABEL_PILLARS)[number];
export type LabelType = (typeof LABEL_TYPES)[number];
export type LabelTopic = (typeof LABEL_TOPICS)[number];

export type ArticleLabels = {
  pillar: LabelPillar;
  type: LabelType;
  topic: LabelTopic;
  /** A second topic. Only All Things AI may carry one (e.g. ai + branding). */
  topic2?: LabelTopic | null;
  /** 2 to 4 of the Hub's existing tags, spelled as the Hub spells them. */
  keywords: string[];
};

export const PILLAR_NAMES: Record<LabelPillar, string> = {
  creative_insights: "Creative Insights",
  all_things_ai: "All Things AI",
  case_studies: "Case Studies",
  guides_workflows: "Guides & Workflows",
};

export const TYPE_NAMES: Record<LabelType, string> = {
  news: "News",
  explanation: "Explanation",
  commentary: "Commentary",
  case_study: "Case study",
  tutorial: "Tutorial",
  business_guide: "Business guide",
  resources: "Resources",
};

export const TOPIC_NAMES: Record<LabelTopic, string> = {
  branding: "Branding",
  visual_design: "Visual design",
  websites_ux: "Websites & UX",
  ai: "AI",
  creative_business: "Creative business",
};

/**
 * Which types and topics each pillar allows. From the proposal:
 *   creative_insights → explanation, commentary × branding, visual_design, websites_ux, creative_business
 *   all_things_ai     → news, explanation, tutorial, commentary, resources × ai (+ optional topic_2)
 *   case_studies      → case_study × any topic
 *   guides_workflows  → tutorial, business_guide, resources × branding, visual_design, websites_ux, creative_business
 */
export const ALLOWED_COMBINATIONS: Record<
  LabelPillar,
  { types: readonly LabelType[]; topics: readonly LabelTopic[]; secondTopic: boolean }
> = {
  creative_insights: {
    types: ["explanation", "commentary"],
    topics: ["branding", "visual_design", "websites_ux", "creative_business"],
    secondTopic: false,
  },
  all_things_ai: {
    types: ["news", "explanation", "tutorial", "commentary", "resources"],
    topics: ["ai"],
    secondTopic: true,
  },
  case_studies: {
    types: ["case_study"],
    topics: LABEL_TOPICS,
    secondTopic: false,
  },
  guides_workflows: {
    types: ["tutorial", "business_guide", "resources"],
    topics: ["branding", "visual_design", "websites_ux", "creative_business"],
    secondTopic: false,
  },
};

/** The keywords an article may carry: the Hub's existing 34 tags, exactly. */
export const LABEL_KEYWORDS: readonly string[] = CONTENT_DIRECTIONS.map((direction) => direction.name);

export const MIN_KEYWORDS = 2;
export const MAX_KEYWORDS = 4;

/**
 * The target length per type, and the range a draft is checked against.
 * Targets from the proposal; the ranges are the targets with room either side,
 * and news uses the proposal's own 400–550.
 */
export const LENGTH_BY_TYPE: Record<LabelType, { target: number; min: number; max: number }> = {
  news: { target: 500, min: 400, max: 550 },
  commentary: { target: 600, min: 500, max: 700 },
  explanation: { target: 700, min: 600, max: 800 },
  resources: { target: 700, min: 600, max: 800 },
  tutorial: { target: 900, min: 780, max: 1020 },
  business_guide: { target: 900, min: 780, max: 1020 },
  case_study: { target: 950, min: 820, max: 1080 },
};

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

/** Case-insensitive lookup of a keyword in the Hub's tag list; null when it is not a tag. */
export function canonicalKeyword(value: string): string | null {
  const needle = value.trim().toLowerCase();
  return LABEL_KEYWORDS.find((keyword) => keyword.toLowerCase() === needle) ?? null;
}

export type LabelCheck = { ok: true; labels: ArticleLabels } | { ok: false; errors: string[] };

/**
 * Check a set of labels against the allowed combinations. Rejects anything the
 * proposal does not allow, with one plain sentence per problem.
 */
export function validateLabels(input: unknown): LabelCheck {
  const errors: string[] = [];
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  const pillar = raw.pillar;
  const type = raw.type;
  const topic = raw.topic;
  const topic2Raw = raw.topic2 ?? raw.topic_2;
  const topic2 = topic2Raw === "" || topic2Raw === undefined ? null : topic2Raw;

  if (!isOneOf(LABEL_PILLARS, pillar)) errors.push(`Unknown pillar: ${String(pillar)}.`);
  if (!isOneOf(LABEL_TYPES, type)) errors.push(`Unknown type: ${String(type)}.`);
  if (!isOneOf(LABEL_TOPICS, topic)) errors.push(`Unknown topic: ${String(topic)}.`);
  if (topic2 !== null && !isOneOf(LABEL_TOPICS, topic2)) errors.push(`Unknown second topic: ${String(topic2)}.`);

  if (isOneOf(LABEL_PILLARS, pillar)) {
    const rule = ALLOWED_COMBINATIONS[pillar];
    if (isOneOf(LABEL_TYPES, type) && !rule.types.includes(type)) {
      errors.push(`${PILLAR_NAMES[pillar]} does not allow the type "${type}". Allowed: ${rule.types.join(", ")}.`);
    }
    if (isOneOf(LABEL_TOPICS, topic) && !rule.topics.includes(topic)) {
      errors.push(`${PILLAR_NAMES[pillar]} does not allow the topic "${topic}". Allowed: ${rule.topics.join(", ")}.`);
    }
    if (topic2 !== null) {
      if (!rule.secondTopic) {
        errors.push(`Only All Things AI may carry a second topic.`);
      } else if (topic2 === topic) {
        errors.push(`The second topic must differ from the first.`);
      }
    }
  }

  const keywordsRaw = Array.isArray(raw.keywords) ? raw.keywords : [];
  const keywords: string[] = [];
  for (const value of keywordsRaw) {
    const canonical = typeof value === "string" ? canonicalKeyword(value) : null;
    if (!canonical) {
      errors.push(`"${String(value)}" is not one of the Hub's tags.`);
      continue;
    }
    if (!keywords.includes(canonical)) keywords.push(canonical);
  }
  if (keywords.length < MIN_KEYWORDS || keywords.length > MAX_KEYWORDS) {
    errors.push(`Choose ${MIN_KEYWORDS} to ${MAX_KEYWORDS} keywords (got ${keywords.length}).`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    labels: {
      pillar: pillar as LabelPillar,
      type: type as LabelType,
      topic: topic as LabelTopic,
      topic2: (topic2 as LabelTopic | null) ?? null,
      keywords,
    },
  };
}

/** One line for prompts and logs: "All Things AI · tutorial · AI + Branding · Typography, Motion". */
export function describeLabels(labels: ArticleLabels): string {
  const topics = [labels.topic, labels.topic2].filter((value): value is LabelTopic => !!value);
  return [
    PILLAR_NAMES[labels.pillar],
    TYPE_NAMES[labels.type],
    topics.map((value) => TOPIC_NAMES[value]).join(" + "),
    labels.keywords.join(", "),
  ].join(" · ");
}
