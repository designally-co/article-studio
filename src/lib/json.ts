/**
 * Defensive JSON extraction for model output. Strips code fences and pulls the
 * first balanced JSON value out of surrounding prose. Returns null on failure
 * so callers can retry once (per spec §6.1).
 */
/** The balanced bracket span that opens at `start`, parsed, or undefined. */
function parseSpan(s: string, start: number): unknown {
  const open = s[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

const isPlainObject = (value: unknown): boolean =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The JSON in a model's reply.
 *
 * `expect: "object"` WHEN AN OBJECT IS WANTED. The scan used to start at the
 * first `[` or `{` in the text, so a note before the JSON — "I found the
 * studio's case study [1]" — was read as the array `[1]`, and an outline came
 * back with no title and no sections (5 Oct 2026). Expecting an object, it
 * tries each `{` in turn and returns the first that parses to one.
 */
export function extractJson<T = unknown>(text: string, expect?: "object"): T | null {
  if (!text) return null;
  let s = text.trim();

  // strip ```json ... ``` fences
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // fast path
  try {
    const whole = JSON.parse(s);
    if (expect !== "object" || isPlainObject(whole)) return whole as T;
  } catch {
    // fall through to bracket scan
  }

  if (expect === "object") {
    for (let at = s.indexOf("{"); at !== -1; at = s.indexOf("{", at + 1)) {
      const found = parseSpan(s, at);
      if (isPlainObject(found)) return found as T;
    }
    return null;
  }

  const start = s.search(/[[{]/);
  if (start === -1) return null;
  const found = parseSpan(s, start);
  return found === undefined ? null : (found as T);
}
