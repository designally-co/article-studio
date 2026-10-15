import type { InferSelectModel } from "drizzle-orm";
import type {
  brandProfiles,
  categories,
  Language,
  ProjectInputs,
  FormatRules,
} from "@/db/schema";
import { articlePrompt } from "@/lib/article-template";
import { pillarForDirection } from "@/lib/content-pillars";
import type { ArticleLabels } from "@/lib/direction/labels";
import { directionArticleTemplate } from "./direction";

export const LAYERS_VERSION = "layers@1.0.0";

type Brand = InferSelectModel<typeof brandProfiles>;
type Category = InferSelectModel<typeof categories>;

/** Brand layer — injected identity: tone, terminology, do/don't, guidelines. */
export function buildBrandLayer(brand: Brand): string {
  const lines: string[] = ["## Brand profile", `Brand: ${brand.name}`];
  if (brand.description) lines.push(`About: ${brand.description}`);

  const tone: string[] = [];
  if (brand.tone.descriptors.length)
    tone.push(brand.tone.descriptors.join(", "));
  if (brand.tone.freeText) tone.push(brand.tone.freeText);
  if (tone.length) lines.push(`Tone of voice: ${tone.join(" — ")}`);

  if (brand.audience) lines.push(`Target audience: ${brand.audience}`);
  if (brand.terminology.length)
    lines.push(
      `Preferred terminology (use these exact terms/spellings): ${brand.terminology.join("; ")}`
    );
  if (brand.dos.length) lines.push(`Always: ${brand.dos.join("; ")}`);
  if (brand.donts.length) lines.push(`Never: ${brand.donts.join("; ")}`);

  const d = brand.defaults;
  const defaults: string[] = [];
  if (d.cta) defaults.push(`default CTA "${d.cta}"`);
  if (d.links) defaults.push(`links: ${d.links}`);
  if (d.hashtags) defaults.push(`default hashtags: ${d.hashtags}`);
  if (defaults.length) lines.push(`Defaults: ${defaults.join(", ")}`);

  if (brand.guidelineText.trim())
    lines.push(
      `Additional brand writing guidelines:\n${brand.guidelineText.trim()}`
    );

  return lines.join("\n");
}

/** Format layer — article rules and language directives. */
export function buildFormatLayer(
  articleRules: FormatRules,
  category: Category | null,
  language: Language,
  labels?: ArticleLabels
): string {
  /* A labelled article (preview of the proposed direction) is written to the
     proposal's template INSTEAD of the saved one: its shape, lengths and image
     blocks contradict the 1,200–2,000 word template, and the old pillar lines
     below would contradict its labels. */
  if (labels) {
    return ["## Article template", directionArticleTemplate(labels), "", buildLanguageLayer(language)].join("\n");
  }
  const lines: string[] = [
    "## Article template",
    articlePrompt(articleRules),
  ];
  if (category) {
    const pillar = pillarForDirection(category.name);
    if (pillar) {
      lines.push(`Content pillar: ${pillar.name} — ${pillar.tagline}`);
      lines.push(`Pillar purpose: ${pillar.purpose}`);
      lines.push(`Content direction: ${category.name}`);
    } else {
      lines.push(`Content direction: ${category.name}`);
    }
  }
  lines.push("", buildLanguageLayer(language));
  return lines.join("\n");
}

/** Language layer — Thai-quality directives per §6.3. */
export function buildLanguageLayer(language: Language): string {
  if (language === "en") {
    return "## Language\nWrite in natural, fluent English.";
  }
  if (language === "th") {
    return `## Language
Write in natural, native-quality Thai (ภาษาไทย) — not translated-sounding.
- Use correct particles and register that match the brand tone.
- Handle loanwords per the brand's terminology list; keep proper nouns and product names as specified.
- Thai has no spaces between words; write idiomatically as a native speaker would.`;
  }
  return `## Language
Produce BOTH a Thai and an English version.
- The Thai version must be native-quality (not translated-sounding), with correct particles and register for the brand tone.
- The English version must read as originally written in English, not translated from Thai.
- The two versions should be equivalent in intent and structure, adapted idiomatically to each language — not word-for-word.`;
}

/** Context layer — user inputs gathered at Setup. */
export function buildContextLayer(inputs: ProjectInputs): string {
  const lines: string[] = [];
  if (inputs.keyword) lines.push(`Target keyword(s): ${inputs.keyword}`);
  if (inputs.brief) lines.push(`Brief from the user:\n${inputs.brief}`);
  if (inputs.competitorSummary)
    lines.push(
      `Competitor reference (for understanding only — DO NOT copy):\n${inputs.competitorSummary}`
    );
  if (inputs.gscInsights)
    lines.push(`Search Console insights:\n${inputs.gscInsights}`);
  if (inputs.extraGuidelines)
    lines.push(`Additional guidelines for this project:\n${inputs.extraGuidelines}`);
  if (!lines.length) return "";
  return "## Context\n" + lines.join("\n\n");
}
