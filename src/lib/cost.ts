import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { pricing, apiUsageLog, type PricingUnit } from "@/db/schema";
import { KNOWN_TEXT_PRICES } from "@/lib/models";

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/** Normalize an Anthropic usage object into billable in/out token totals. */
export function normalizeUsage(usage: Usage): { tokensIn: number; tokensOut: number } {
  const tokensIn =
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0);
  return { tokensIn, tokensOut: usage.output_tokens ?? 0 };
}

async function priceFor(
  provider: string,
  model: string,
  unit: PricingUnit
): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ priceUsd: pricing.priceUsd })
    .from(pricing)
    .where(
      and(
        eq(pricing.provider, provider),
        eq(pricing.model, model),
        eq(pricing.unit, unit)
      )
    )
    .limit(1);
  if (row) return Number(row.priceUsd);
  // A text model the table has no row for — a new one chosen in Settings.
  const known = provider === "anthropic" ? KNOWN_TEXT_PRICES[model] : undefined;
  if (known && unit === "mtok_in") return known.in;
  if (known && unit === "mtok_out") return known.out;
  return 0;
}

/** USD cost of a text generation given token counts and the model's pricing. */
export async function textCost(
  model: string,
  tokensIn: number,
  tokensOut: number
): Promise<number> {
  const inRate = await priceFor("anthropic", model, "mtok_in");
  const outRate = await priceFor("anthropic", model, "mtok_out");
  return (tokensIn / 1_000_000) * inRate + (tokensOut / 1_000_000) * outRate;
}

/** USD cost of image generation. */
export async function imageCost(
  provider: string,
  model: string,
  count: number
): Promise<number> {
  const rate = await priceFor(provider, model, "image");
  return rate * count;
}

/** Record a text-generation call in the usage log and return its computed cost. */
export async function logUsage(params: {
  projectId: string | null;
  stage: string;
  model: string;
  usage: Usage;
  promptVersion?: string;
  latencyMs?: number;
  schemaRetryCount?: number;
}): Promise<{ tokensIn: number; tokensOut: number; costUsd: number }> {
  const { tokensIn, tokensOut } = normalizeUsage(params.usage);
  const costUsd = await textCost(params.model, tokensIn, tokensOut);
  const db = await getDb();
  await db.insert(apiUsageLog).values({
    projectId: params.projectId,
    stage: params.stage,
    model: params.model,
    tokensIn,
    tokensOut,
    cacheCreationTokens: params.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: params.usage.cache_read_input_tokens ?? 0,
    costUsd: costUsd.toFixed(6),
    promptVersion: params.promptVersion ?? null,
    latencyMs: params.latencyMs ?? null,
    schemaRetryCount: params.schemaRetryCount ?? 0,
  });
  return { tokensIn, tokensOut, costUsd };
}

export { fmtUsd } from "./format";
