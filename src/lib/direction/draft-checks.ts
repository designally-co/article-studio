/**
 * Measurable checks of a draft against the proposed writing rules (preview
 * only). Used by the trial script to compare the current and the proposed
 * behaviour on the same subject. Heuristics, not judgments: each result says
 * what was counted, and a person still reads the drafts.
 *
 * Plain module, testable with `node --test`.
 */
import { LENGTH_BY_TYPE, type LabelType } from "./labels";
import { parseImageBlocks } from "./image-blocks";

const words = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).length;

/** The text under an H2 whose heading matches, up to the next H2. Null when absent. */
export function sectionBody(markdown: string, heading: RegExp): string | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+/.test(line) && heading.test(line.replace(/^##\s+/, "")));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s+/.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

/** The article without its title, image blocks, Sources and Free resource sections. */
export function readableBody(markdown: string): string {
  let text = markdown.replace(/```image[\s\S]*?```/g, "").replace(/^#\s+.+$/m, "");
  const cut = /\n##\s+(sources|references|free resource)\b/i.exec(text);
  if (cut) text = text.slice(0, cut.index);
  return text;
}

const BANNED_OPENERS = /^(this (article|case|case study|tutorial|guide|piece|post)|here\b|in this\b)/i;
const NEXT_STEP_CUES =
  /\b(next|start|try|open|set|check|test|decide|choose|pick|write|ask|book|list|map|audit|before you|this week|today|tomorrow|on your next)\b/i;

export type DraftCheck = {
  words: number;
  lengthRange: { min: number; max: number } | null;
  lengthOk: boolean | null;
  hasSummaryLine: boolean;
  atAGlance: {
    present: boolean;
    bullets: number;
    /** Bullets that begin "This article / This case / …" or "Here / In this". */
    describesArticle: number;
    /** Bullets whose first two words repeat another bullet's. */
    repeatedOpeners: number;
    ok: boolean;
  };
  keyTakeaway: {
    present: boolean;
    words: number;
    /** Contains a cue of an action or a time to act. A heuristic. */
    nextStepCue: boolean;
    ok: boolean;
  };
  /** Inline links in the body outside Sources: a proxy for a named, sourced example. */
  inlineSourceLinks: number;
  /** "We tested", "in our test", "when we tried" and similar. A proxy for a tutorial's real test. */
  testLanguage: boolean;
  emDashes: number;
  imageBlocks: number;
  orderOk: boolean;
};

export function checkDraft(markdown: string, type?: LabelType | null): DraftCheck {
  const body = readableBody(markdown);
  const count = words(body);
  const range = type ? { min: LENGTH_BY_TYPE[type].min, max: LENGTH_BY_TYPE[type].max } : null;

  const afterTitle = markdown.replace(/^[\s\S]*?^#\s+.+$/m, "").trimStart();
  const hasSummaryLine = /^(_[^_\n]{8,400}_|\*[^*\n]{8,400}\*)\s*$/m.test(afterTitle.split(/\n\s*\n/)[0] ?? "");

  const glance = sectionBody(markdown, /^at a glance\b/i);
  const bullets = (glance ?? "")
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*]\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*]\s+/, "").replace(/^\*\*|\*\*/g, "").trim());
  const openers = bullets.map((bullet) => bullet.toLowerCase().split(/\s+/).slice(0, 2).join(" "));
  const repeatedOpeners = openers.filter((opener, index) => openers.indexOf(opener) !== index).length;
  const describesArticle = bullets.filter((bullet) => BANNED_OPENERS.test(bullet)).length;

  const takeaway = sectionBody(markdown, /^key takeaway\b/i);
  const takeawayWords = takeaway ? words(takeaway) : 0;

  const linkMatches = body.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) ?? [];
  const idxGlance = markdown.search(/^##\s+at a glance/im);
  const idxTake = markdown.search(/^##\s+key takeaway/im);
  const idxSources = markdown.search(/^##\s+(sources|references)/im);

  return {
    words: count,
    lengthRange: range,
    lengthOk: range ? count >= range.min && count <= range.max : null,
    hasSummaryLine,
    atAGlance: {
      present: glance !== null,
      bullets: bullets.length,
      describesArticle,
      repeatedOpeners,
      ok: glance !== null && bullets.length >= 2 && bullets.length <= 4 && describesArticle === 0 && repeatedOpeners === 0,
    },
    keyTakeaway: {
      present: takeaway !== null,
      words: takeawayWords,
      nextStepCue: takeaway ? NEXT_STEP_CUES.test(takeaway) : false,
      ok: takeaway !== null && takeawayWords >= 35 && takeawayWords <= 80 && NEXT_STEP_CUES.test(takeaway),
    },
    inlineSourceLinks: linkMatches.length,
    testLanguage: /\b(we tested|in our test|when we tried|we tried|tested it|our test|in testing)\b/i.test(body),
    emDashes: (markdown.match(/—/g) ?? []).length,
    imageBlocks: parseImageBlocks(markdown).length,
    orderOk:
      idxGlance >= 0 && idxTake > idxGlance && (idxSources < 0 || idxSources > idxTake),
  };
}
