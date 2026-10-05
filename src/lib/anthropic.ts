import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "@/db";
import {
  DEFAULT_RESEARCH_MODEL,
  DEFAULT_DRAFTING_MODEL,
  TEXT_MODELS,
  modelLabel,
  type TextModelOption,
} from "@/lib/models";
import { appSettings } from "@/db/schema";
import type { InferSelectModel } from "drizzle-orm";
import type {
  brandProfiles,
  categories,
  Language,
  ProjectInputs,
  FormatRules,
} from "@/db/schema";
import {
  SYSTEM_PROMPT,
  JSON_CONTRACT,
  BRAND_INSIGHT_MODE_RULES,
  EDITORIAL_MODE_RULES,
  RESEARCH_RULES,
  PROMPT_VERSION,
} from "@/prompts/system";
import {
  buildBrandLayer,
  buildFormatLayer,
  buildContextLayer,
} from "@/prompts/layers";
import { BUSINESS_PROFILE } from "@/lib/ai/brand";
import { SchemaValidationError } from "@/lib/ai/schemas";
import { logUsage } from "./cost";
import { extractJson } from "./json";
type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

type Brand = InferSelectModel<typeof brandProfiles>;
type Category = InferSelectModel<typeof categories>;

export type PipelineContext = {
  brand: Brand;
  articleRules: FormatRules;
  category: Category | null;
  language: Language;
  inputs: ProjectInputs;
};

/**
 * Builds a client per call from the server environment. Anthropic credentials
 * are intentionally not user-managed in Settings.
 */
async function anthropicClient(): Promise<Anthropic> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
  }
  return new Anthropic({ apiKey });
}

export async function isAnthropicConfigured(): Promise<boolean> {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function getModels(): Promise<{ research: string; drafting: string; image: string }> {
  const db = await getDb();
  const rows = await db.select().from(appSettings);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const drafting = map["model.drafting"] ?? DEFAULT_DRAFTING_MODEL;
  return {
    research: map["model.research"] ?? DEFAULT_RESEARCH_MODEL,
    drafting,
    /* Its own setting, because the best model for looking at a reference and
       briefing a picture need not be the one every article is written with —
       and the drafting model is paid for on every draft. Unset, it follows the
       drafting model, which is what wrote image prompts before. */
    image: map["model.image"] || drafting,
  };
}

/** How long the list of models is trusted before Anthropic is asked again. */
const MODEL_LIST_TTL_MS = 60 * 60 * 1000;
let modelListCache: { at: number; options: TextModelOption[] } | null = null;

/**
 * Every text model this key can use, newest first, from Anthropic's Models API
 * — so a model released after this code was written is offered without a
 * deploy. Asked at most once an hour; when it cannot be asked (no key, no
 * network, an error) the list in `TEXT_MODELS` stands in.
 */
export async function availableTextModels(): Promise<TextModelOption[]> {
  if (modelListCache && Date.now() - modelListCache.at < MODEL_LIST_TTL_MS) return modelListCache.options;
  const fallback = TEXT_MODELS.map((id) => ({ id, label: modelLabel(id) }));
  if (!process.env.ANTHROPIC_API_KEY) return fallback;
  try {
    const client = await anthropicClient();
    const options: TextModelOption[] = [];
    for await (const model of client.models.list({ limit: 100 }, { timeout: 8000, maxRetries: 0 })) {
      options.push({ id: model.id, label: model.display_name || modelLabel(model.id) });
    }
    if (options.length === 0) return fallback;
    modelListCache = { at: Date.now(), options };
    return options;
  } catch {
    return fallback;
  }
}

/**
 * How a model is asked to answer without a long think first.
 *
 * Thinking is turned OFF where a model allows it, so drafting streams text
 * immediately and a short budget is spent on the answer. Models differ:
 *
 *   off      `{type: "disabled"}` — Opus 5, Sonnet 5, and the 4.x Opus and
 *            Sonnet models; or `{type: "between_tools"}`, Sonnet 5.5's way of
 *            saying the same (it rejects "disabled").
 *   default  Haiku and older: no thinking unless asked, so nothing is sent.
 *   light    Thinking cannot be turned off — Opus 5.5, Fable — so effort is
 *            set low and the token budget gets room for the thinking, which
 *            counts against it; without that room a short answer is cut off.
 *   plain    As light, for a model that also rejects `effort`.
 *
 * A MODEL THIS CODE HAS NEVER SEEN starts as light, which every current model
 * accepts. And if a model rejects its plan — a future one that stops accepting
 * "disabled", say — the call is made once more with the next plan down, and
 * that plan is remembered for the model. The dropdown offers whatever
 * Anthropic releases (see `availableTextModels`), so this cannot be a list
 * that has to be kept up to date by hand.
 */
type ThinkingPlan =
  | { kind: "off"; thinking: { type: "disabled" } | { type: "between_tools" } }
  | { kind: "default" }
  | { kind: "light" }
  | { kind: "plain" };

/** Output tokens added for a model that will think however it is asked. */
const THINKING_ROOM = 4000;

function defaultPlan(model: string): ThinkingPlan {
  if (/haiku|claude-3/.test(model)) return { kind: "default" };
  if (/^claude-sonnet-5-5(-\d{8})?$/.test(model)) return { kind: "off", thinking: { type: "between_tools" } };
  if (/^claude-(opus|sonnet)-(5|4(-\d+)?)(-\d{8})?$/.test(model)) {
    return { kind: "off", thinking: { type: "disabled" } };
  }
  return { kind: "light" };
}

const learnedPlans = new Map<string, ThinkingPlan>();

/** The plan to try after `plan` was rejected with `message`, or null to give up. */
function nextPlan(plan: ThinkingPlan, message: string): ThinkingPlan | null {
  if (plan.kind === "off" && /thinking/i.test(message)) return { kind: "light" };
  if (plan.kind === "light" && /effort/i.test(message)) return { kind: "plain" };
  return null;
}

/** The request fields a plan sets: thinking, effort, and the output budget. */
function planFields(plan: ThinkingPlan, maxTokens: number) {
  switch (plan.kind) {
    case "off":
      // `between_tools` is newer than this SDK's types; the API takes it.
      return { thinking: plan.thinking as unknown as Anthropic.ThinkingConfigParam, effort: undefined, maxTokens };
    case "default":
      return { thinking: undefined, effort: undefined, maxTokens };
    case "light":
      return { thinking: undefined, effort: "low" as const, maxTokens: maxTokens + THINKING_ROOM };
    case "plain":
      return { thinking: undefined, effort: undefined, maxTokens: maxTokens + THINKING_ROOM };
  }
}

/** Run a call with the model's plan, falling back once if the model rejects it. */
async function withThinkingPlan<T>(model: string, run: (plan: ThinkingPlan) => Promise<T>): Promise<T> {
  const plan = learnedPlans.get(model) ?? defaultPlan(model);
  try {
    return await run(plan);
  } catch (error) {
    const next = error instanceof Anthropic.BadRequestError ? nextPlan(plan, error.message) : null;
    if (!next) throw error;
    learnedPlans.set(model, next);
    return run(next);
  }
}

/** A safety decline arrives as a normal reply with nothing in it; say so. */
function refused(stopReason: string | null): never | void {
  if (stopReason === "refusal") {
    throw new Error("Claude declined this request (a safety filter). Try again, or choose another model in Settings.");
  }
}

/** Web search tool version valid across all current models (incl. Haiku). */
function webSearchTool(maxUses: number) {
  return {
    type: "web_search_20250305" as const,
    name: "web_search" as const,
    max_uses: Math.min(5, Math.max(1, Math.floor(maxUses))),
  };
}

/**
 * Two-layer system prompt for the Sonnet stages:
 *  - `shared`  — role + brand guideline + article template. Byte-identical
 *                across outline/draft/refine within a project, and the
 *                role+brand head is identical across projects.
 *  - `context` — per-project inputs. Stable across the 3 drafts + every refine
 *                of one project.
 *
 * Each gets its own cache breakpoint (see `cachedSystem`), so a call reads the
 * shared prefix from cache even when it's the first call of its stage — which
 * is what lets "outline → 3 drafts → refine" show cache reads on every call
 * after the first, not just repeats of the same stage.
 */
export type SystemLayers = { shared: string; context: string };

export function buildSystemLayers(ctx: PipelineContext): SystemLayers {
  const shared = [
    SYSTEM_PROMPT,
    ctx.inputs.articleMode === "editorial" ? EDITORIAL_MODE_RULES : BRAND_INSIGHT_MODE_RULES,
    buildBrandLayer(ctx.brand),
    buildFormatLayer(ctx.articleRules, ctx.category, ctx.language),
  ]
    .filter(Boolean)
    .join("\n\n");
  return { shared, context: buildContextLayer(ctx.inputs) };
}

/** Flattened single string (used where two-block caching isn't needed). */
export function buildSystemPrompt(ctx: PipelineContext): string {
  const { shared, context } = buildSystemLayers(ctx);
  return [shared, context].filter(Boolean).join("\n\n");
}

/**
 * Research-stage system prompt (Haiku): business profile + research rules only,
 * NOT the brand guideline (spec §8). Returned uncached — it's well under
 * Haiku 4.5's 4,096-token minimum cacheable prefix, so a cache_control marker
 * would be silently ignored and we'd pay full input rate anyway.
 */
export function buildResearchSystem(): string {
  return `${BUSINESS_PROFILE}\n\n${RESEARCH_RULES}`;
}

/**
 * Wrap a system prompt into cache-marked text blocks. A string yields one
 * block; `SystemLayers` yields two (shared prefix + per-project context), each
 * with its own breakpoint. `cache: false` (research) attaches no markers.
 * `extraLast` is appended to the final block (e.g. the JSON contract).
 */
function cachedSystem(
  system: string | SystemLayers,
  opts?: { cache?: boolean; extraLast?: string }
): Anthropic.TextBlockParam[] {
  const cache = opts?.cache ?? true;
  const mark = cache ? { cache_control: { type: "ephemeral" as const } } : {};

  // The final block carries any appended text (e.g. the JSON contract). Empty
  // text blocks can't take cache_control, so build the raw texts, drop empties,
  // then mark what remains.
  const texts =
    typeof system === "string" ? [system] : [system.shared, system.context];
  if (opts?.extraLast) {
    const last = texts.length - 1;
    texts[last] = texts[last] ? `${texts[last]}\n\n${opts.extraLast}` : opts.extraLast;
  }

  return texts
    .filter((text) => text.trim().length > 0)
    .map((text) => ({ type: "text" as const, text, ...mark }));
}

/** Concatenate text blocks from a message response. */
/**
 * The answer after the last search, when the model searched.
 *
 * With web search on, the reply interleaves the model's own commentary ("Let me
 * look for the studio's case study…"), the searches and their results, and the
 * answer at the end. Joined together, the commentary comes first, and a bracket
 * in it is where the JSON scan would start.
 */
function afterLastSearch(content: Anthropic.ContentBlock[]): Anthropic.ContentBlock[] {
  const last = content.map((block) => block.type as string).lastIndexOf("web_search_tool_result");
  return last === -1 ? content : content.slice(last + 1);
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * An image to show the model, alongside the task text.
 *
 * The Messages API takes images as content blocks in the user turn, image
 * first. `media_type` must be one of the four the API accepts; anything else is
 * dropped rather than sent, because a rejected block fails the whole call.
 */
export type PromptImage = { base64: string; mediaType: string };

const VISION_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** The user turn: images first, then the text that refers to them. */
function userContent(text: string, images?: PromptImage[]) {
  const usable = (images ?? []).filter((image) => VISION_TYPES.has(image.mediaType));
  if (usable.length === 0) return text;
  return [
    ...usable.map((image) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: image.mediaType as "image/png", data: image.base64 },
    })),
    { type: "text" as const, text },
  ];
}

/**
 * Structured (JSON) generation. The model's shape is guaranteed natively via
 * `output_config.format`; an optional `validate` (a Zod parse) enforces rules
 * JSON Schema can't express — e.g. English-only image prompts. On a validation
 * failure we retry ONCE with the error appended as a user message; a second
 * failure throws a typed `SchemaValidationError` (never a partial result).
 * Every call (including the retry) writes a telemetry row.
 */
export async function runJson<T>(params: {
  model: string;
  system: string | SystemLayers;
  task: string;
  schema: Record<string, unknown>;
  /** Images to show the model, e.g. a reference photograph to describe. */
  images?: PromptImage[];
  maxTokens: number;
  webSearch?: boolean | { maxUses: number };
  timeoutMs?: number;
  /**
   * Retry once at 1.6x the token budget when a response is cut off by
   * `max_tokens`. On by default, and worth knowing about: `timeoutMs` is a
   * ceiling per CALL, so a heal makes a runJson cost up to twice its timeout.
   * Callers on a fixed function budget that cannot absorb that doubling set
   * this false and take a clear error instead of a silent 504.
   */
  allowHeal?: boolean;
  projectId: string | null;
  stage: string;
  /** Set false for the research stage (system is under Haiku's cache minimum). */
  cache?: boolean;
  /** Post-parse validator (e.g. a Zod `.parse`). Throws on invalid input. */
  validate?: (data: unknown) => T;
}): Promise<{ data: T; usage: Usage }> {
  // Ceiling for the truncation self-heal. Non-streaming stays well under the
  // ~16k mark where SDK HTTP timeouts become a risk.
  const MAX_TOKENS_CEILING = 12000;
  let retries = 0;

  const attempt = async (extra: string | undefined, maxTokens: number): Promise<
    { raw: unknown; usage: Usage } | { truncated: true; usage: Usage }
  > => {
    const client = await anthropicClient();
    const startedAt = performance.now();
    const msg = await withThinkingPlan(params.model, (plan) => {
      const fields = planFields(plan, maxTokens);
      return client.messages.create({
        model: params.model,
        max_tokens: fields.maxTokens,
        ...(fields.thinking ? { thinking: fields.thinking } : {}),
        system: cachedSystem(params.system, { cache: params.cache, extraLast: JSON_CONTRACT }),
        ...(params.webSearch ? { tools: [webSearchTool(typeof params.webSearch === "object" ? params.webSearch.maxUses : 5)] } : {}),
        output_config: {
          format: {
            type: "json_schema",
            schema: params.schema,
          },
          ...(fields.effort ? { effort: fields.effort } : {}),
        },
        messages: [
          {
            role: "user",
            content: userContent(extra ? `${params.task}\n\n${extra}` : params.task, params.images),
          },
        ],
      }, { timeout: params.timeoutMs ?? 120000, maxRetries: 0 });
    });

    await logUsage({
      projectId: params.projectId,
      stage: params.stage,
      model: params.model,
      usage: msg.usage,
      promptVersion: PROMPT_VERSION,
      latencyMs: Math.round(performance.now() - startedAt),
      schemaRetryCount: retries,
    });

    refused(msg.stop_reason);
    const raw = extractJson<unknown>(
      textOf(params.webSearch ? afterLastSearch(msg.content) : msg.content),
      params.schema.type === "object" ? "object" : undefined,
    );
    if (raw === null) {
      if (msg.stop_reason === "max_tokens") return { truncated: true, usage: msg.usage };
      throw new Error("Model did not return the required structured response.");
    }
    return { raw, usage: msg.usage };
  };

  /** Run one attempt, self-healing once if the JSON was cut off by max_tokens. */
  const attemptWithHeal = async (extra?: string): Promise<{ raw: unknown; usage: Usage }> => {
    let budget = params.maxTokens;
    let result = await attempt(extra, budget);
    if ("truncated" in result && budget < MAX_TOKENS_CEILING && params.allowHeal !== false) {
      retries += 1;
      budget = Math.min(Math.ceil(budget * 1.6), MAX_TOKENS_CEILING);
      result = await attempt(extra, budget);
    }
    if ("truncated" in result) {
      throw new Error(
        `The ${params.stage} response exceeded the output token limit even after retrying with more room. ` +
          "Try a shorter target length or simpler topic."
      );
    }
    return result;
  };

  const validate = params.validate;
  const first = await attemptWithHeal();
  if (!validate) return { data: first.raw as T, usage: first.usage };

  try {
    return { data: validate(first.raw), usage: first.usage };
  } catch (firstErr) {
    const detail = firstErr instanceof Error ? firstErr.message : String(firstErr);
    retries += 1;
    // Retry once, telling the model exactly what was wrong.
    const second = await attemptWithHeal(
      `Your previous JSON was rejected by validation: ${detail}\nReturn corrected JSON that satisfies every rule.`
    );
    try {
      return { data: validate(second.raw), usage: second.usage };
    } catch (secondErr) {
      throw new SchemaValidationError(
        params.stage,
        secondErr instanceof Error ? secondErr.message : String(secondErr)
      );
    }
  }
}

/**
 * Stream a plain-text generation. Calls `onDelta` for each text chunk and
 * returns the final text plus usage.
 */
export async function streamText(params: {
  model: string;
  system: string | SystemLayers;
  /** Single user turn. Ignored when `messages` is provided. */
  task?: string;
  /** Full message list (e.g. a cached refine conversation). Overrides `task`. */
  messages?: Anthropic.MessageParam[];
  maxTokens: number;
  onDelta: (text: string) => void;
  projectId: string | null;
  stage: string;
}): Promise<{ text: string; usage: Usage }> {
  const client = await anthropicClient();
  const startedAt = performance.now();
  // A rejected plan fails before any text arrives, so a retry repeats nothing.
  const final = await withThinkingPlan(params.model, (plan) => {
    const fields = planFields(plan, params.maxTokens);
    const stream = client.messages.stream({
      model: params.model,
      max_tokens: fields.maxTokens,
      ...(fields.thinking ? { thinking: fields.thinking } : {}),
      ...(fields.effort ? { output_config: { effort: fields.effort } } : {}),
      // Two cache breakpoints on the layered system prompt so the 3 drafts and
      // every refine of a project read the shared prefix at ~0.1x input cost.
      // (Ephemeral cache metadata can slightly delay the first streamed token on
      // some provider/model combos; accepted here for the caching win.)
      system: cachedSystem(params.system),
      messages: params.messages ?? [{ role: "user", content: params.task ?? "" }],
    });
    stream.on("text", (delta) => params.onDelta(delta));
    return stream.finalMessage();
  });
  await logUsage({
    projectId: params.projectId,
    stage: params.stage,
    model: params.model,
    usage: final.usage,
    promptVersion: PROMPT_VERSION,
    latencyMs: Math.round(performance.now() - startedAt),
  });
  refused(final.stop_reason);
  return { text: textOf(final.content), usage: final.usage };
}

/** Non-streaming plain-text generation (e.g. competitor summary, image prompt). */
export async function runText(params: {
  model: string;
  system?: string | SystemLayers;
  task: string;
  images?: PromptImage[];
  maxTokens: number;
  projectId: string | null;
  stage: string;
}): Promise<{ text: string; usage: Usage }> {
  const client = await anthropicClient();
  const startedAt = performance.now();
  const msg = await withThinkingPlan(params.model, (plan) => {
    const fields = planFields(plan, params.maxTokens);
    return client.messages.create({
      model: params.model,
      max_tokens: fields.maxTokens,
      ...(fields.thinking ? { thinking: fields.thinking } : {}),
      ...(fields.effort ? { output_config: { effort: fields.effort } } : {}),
      ...(params.system ? { system: cachedSystem(params.system) } : {}),
      messages: [{ role: "user", content: userContent(params.task, params.images) }],
    });
  });
  await logUsage({
    projectId: params.projectId,
    stage: params.stage,
    model: params.model,
    usage: msg.usage,
    promptVersion: PROMPT_VERSION,
    latencyMs: Math.round(performance.now() - startedAt),
  });
  refused(msg.stop_reason);
  return { text: textOf(msg.content), usage: msg.usage };
}
