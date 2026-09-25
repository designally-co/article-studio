import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "@/db";
import { DEFAULT_RESEARCH_MODEL, DEFAULT_DRAFTING_MODEL } from "@/lib/models";
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

export async function getModels(): Promise<{ research: string; drafting: string }> {
  const db = await getDb();
  const rows = await db.select().from(appSettings);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    research: map["model.research"] ?? DEFAULT_RESEARCH_MODEL,
    drafting: map["model.drafting"] ?? DEFAULT_DRAFTING_MODEL,
  };
}

/**
 * Explicitly disable thinking on models that accept it so drafting streams
 * text immediately (no leading thinking pause). Omit on Haiku/older models.
 */
function thinkingParam(model: string) {
  if (/haiku|claude-3/.test(model)) return undefined;
  return { type: "disabled" as const };
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
    const msg = await client.messages.create({
      model: params.model,
      max_tokens: maxTokens,
      ...(thinkingParam(params.model)
        ? { thinking: thinkingParam(params.model) }
        : {}),
      system: cachedSystem(params.system, { cache: params.cache, extraLast: JSON_CONTRACT }),
      ...(params.webSearch ? { tools: [webSearchTool(typeof params.webSearch === "object" ? params.webSearch.maxUses : 5)] } : {}),
      output_config: {
        format: {
          type: "json_schema",
          schema: params.schema,
        },
      },
      messages: [
        {
          role: "user",
          content: userContent(extra ? `${params.task}\n\n${extra}` : params.task, params.images),
        },
      ],
    }, { timeout: params.timeoutMs ?? 120000, maxRetries: 0 });

    await logUsage({
      projectId: params.projectId,
      stage: params.stage,
      model: params.model,
      usage: msg.usage,
      promptVersion: PROMPT_VERSION,
      latencyMs: Math.round(performance.now() - startedAt),
      schemaRetryCount: retries,
    });

    const raw = extractJson<unknown>(textOf(params.webSearch ? afterLastSearch(msg.content) : msg.content));
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
  const stream = client.messages.stream({
    model: params.model,
    max_tokens: params.maxTokens,
    ...(thinkingParam(params.model)
      ? { thinking: thinkingParam(params.model) }
      : {}),
    // Two cache breakpoints on the layered system prompt so the 3 drafts and
    // every refine of a project read the shared prefix at ~0.1x input cost.
    // (Ephemeral cache metadata can slightly delay the first streamed token on
    // some provider/model combos; accepted here for the caching win.)
    system: cachedSystem(params.system),
    messages: params.messages ?? [{ role: "user", content: params.task ?? "" }],
  });

  stream.on("text", (delta) => params.onDelta(delta));
  const final = await stream.finalMessage();
  await logUsage({
    projectId: params.projectId,
    stage: params.stage,
    model: params.model,
    usage: final.usage,
    promptVersion: PROMPT_VERSION,
    latencyMs: Math.round(performance.now() - startedAt),
  });
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
  const msg = await client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens,
    ...(thinkingParam(params.model)
      ? { thinking: thinkingParam(params.model) }
      : {}),
    ...(params.system ? { system: cachedSystem(params.system) } : {}),
    messages: [{ role: "user", content: userContent(params.task, params.images) }],
  });
  await logUsage({
    projectId: params.projectId,
    stage: params.stage,
    model: params.model,
    usage: msg.usage,
    promptVersion: PROMPT_VERSION,
    latencyMs: Math.round(performance.now() - startedAt),
  });
  return { text: textOf(msg.content), usage: msg.usage };
}
