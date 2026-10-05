/**
 * The text models this product offers, most capable first.
 *
 * IN CODE, NOT IN THE PRICING TABLE. The settings dropdown used to list
 * whatever `pricing` happened to hold, which put a cost-reference table in
 * charge of what the product supports: on any database where pricing was
 * unseeded or trimmed, the control opened to ZERO options and could not even
 * display the model already configured. Which models exist is a fact about the
 * code; what they cost is a fact about the account, and they are not the same
 * fact.
 *
 * ITS OWN MODULE, IMPORTING NOTHING. These first lived in lib/anthropic, which
 * opens a database connection and constructs the SDK client — so the moment the
 * settings form (a client component) imported one string from it, Turbopack
 * pulled drizzle and the whole db layer toward the browser bundle and failed to
 * compile. A constant shared across the server/client line has to sit somewhere
 * that carries no weight.
 */
/**
 * THE FALLBACK, NOT THE LIST. Settings asks Anthropic's Models API which models
 * this key can use (see `availableTextModels`), so a model released next month
 * appears in the dropdown without a deploy. This is what is shown when that
 * call cannot be made — no key, no network — newest first.
 */
export const TEXT_MODELS = [
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-5-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;

/** One choice in a model dropdown: the id that is saved, the name that is shown. */
export type TextModelOption = { id: string; label: string };

/** "claude-opus-5-5" → "Claude Opus 5.5", for when the Models API has not named it. */
export function modelLabel(id: string): string {
  const match = id.match(/^claude-([a-z]+)-(\d+(?:-\d+)?)(?:-\d{8})?$/);
  if (!match) return id;
  return `Claude ${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2].replace("-", ".")}`;
}

/**
 * List prices per million tokens, input and output, for when the pricing table
 * has no row for a model. A model the table has never heard of used to cost
 * nothing in the usage figures; a row in the table still wins over these.
 * A model released after this list is written costs $0 until a row is added.
 */
export const KNOWN_TEXT_PRICES: Record<string, { in: number; out: number }> = {
  "claude-fable-5-1": { in: 10, out: 50 },
  "claude-fable-5": { in: 10, out: 50 },
  "claude-mythos-5-1": { in: 10, out: 50 },
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-opus-4-6": { in: 5, out: 25 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

export const DEFAULT_RESEARCH_MODEL = "claude-haiku-4-5";
export const DEFAULT_DRAFTING_MODEL = "claude-sonnet-5";
