/**
 * Prompts for the proposed article direction (preview only, branch
 * `preview/article-direction-v1`).
 *
 * An article with labels (`inputs.labels`) is written to these instead of the
 * current template: they REPLACE the parts of the current prompts that
 * conflict with the proposal (the four old pillars in the scope rules, the
 * 1,200–2,000 word template and its standfirst, the "no images" draft) rather
 * than being appended after them. An article without labels is untouched.
 */
import {
  LABEL_KEYWORDS,
  LENGTH_BY_TYPE,
  PILLAR_NAMES,
  TOPIC_NAMES,
  TYPE_NAMES,
  describeLabels,
  type ArticleLabels,
  type LabelType,
} from "@/lib/direction/labels";
import {
  PILLAR_IMAGE_STYLE,
  ROLE_REQUIREMENT,
  TYPE_IMAGE_POLICY,
  allowedRoutes,
  type ImageFit,
} from "@/lib/direction/image-routing";

export const DIRECTION_VERSION = "direction@0.1.0-preview";

const LABEL_KEYWORDS_LINE = LABEL_KEYWORDS.join(", ");

/** Replaces EDITORIAL_SCOPE_RULES (the four old pillars) for a labelled article. */
export const DIRECTION_SCOPE_RULES = `

Editorial scope: every article belongs to one of four pillars and has a clear, useful connection to designers, creative teams or the business of a creative studio.
- ${PILLAR_NAMES.creative_insights}: explanations and commentary on branding, visual design, websites and UX, and creative business.
- ${PILLAR_NAMES.all_things_ai}: news, explanations, tutorials, commentary and resources about AI. Every piece has a creative or business angle: what the change means for people who make or buy creative work. Never general technology news.
- ${PILLAR_NAMES.case_studies}: one real, named project, what was made and the decisions behind it.
- ${PILLAR_NAMES.guides_workflows}: tutorials, business guides and resources a reader can act on.

Do not write general business, lifestyle, finance, entertainment or technology coverage unless the angle directly serves this audience.`;

/** What the body of each type is made of. */
const BODY_BY_TYPE: Record<LabelType, string> = {
  news: `A lighter version. No long body sections: at most two short H2 sections. First what happened (who, what, when, with the source linked); then why it matters to designers, creative teams or the business that buys creative work, and what to watch next. Facts first, opinion clearly marked as such.`,
  explanation: `2 to 4 H2 sections: the idea in plain words; how it works, step by step or part by part; one real, named, sourced example of it in use; where it stops working or is misused.`,
  commentary: `2 to 4 H2 sections: the claim, stated plainly in the first section; the evidence for it, including at least one real, named, sourced example; the strongest view against it, fairly; where that leaves the reader.`,
  case_study: `3 to 5 H2 sections about ONE real, named project: the brief and the problem it answered; what was made; the decisions behind it and why they work; results only where a source states them. Credit the studio and the client by name and link the studio's own project page.`,
  tutorial: `What the reader will make and what they need; then numbered steps (an H2 per stage, numbered lists inside), each one an action; a real test: what happened when the method was actually tried, with the source of that test or a clearly marked first-hand Designally test from the brief; the common mistakes.`,
  business_guide: `The decision the reader faces; the options compared plainly (a short table is welcome); how to choose, as criteria a reader can apply; one real, named, sourced example of the choice being made.`,
  resources: `A short list (3 to 8) of real resources. For each: its name linked to its own page, who made it, what it is for, and when to use it over the others. Then a short section on how to choose between them.`,
};

/** How a type's body images are described to the writer. */
function imageBlockInstructions(labels: ArticleLabels): string {
  const policy = TYPE_IMAGE_POLICY[labels.type].body;
  if (policy.max === 0) {
    return `## Body images
This type carries NO body images. Do not write any image blocks.`;
  }
  const routes = allowedRoutes(labels.type);
  return `## Body images
${policy.note}
Place ${policy.min === policy.max ? `exactly ${policy.max}` : policy.min === 0 ? `at most ${policy.max}` : `${policy.min} to ${policy.max}`} body image block${policy.max === 1 ? "" : "s"} (never more than 3; the cover is separate and not yours to place). Put each where the reader needs it, between paragraphs, never inside a list or the At a glance section. Write each as a fenced block, one key per line, exactly:

\`\`\`image
id: img-1
role: ${policy.roles[0]}
purpose: what the reader should understand from this picture, in one sentence
alt: what the picture shows, for someone who cannot see it
suggested_route: ${routes[0]}
search_hint: the specific subject to look for (the project, tool or resource by name) or the exact source URL
\`\`\`

- id: img-1, img-2, img-3 in order.
- role: ${policy.roles.join(" | ")}.
- suggested_route: ${routes.join(" | ")}. ${routes.includes("find") ? "find = a real picture from a cited page; " : ""}${routes.includes("draw") ? "draw = a clean figure drawn from the purpose (any text in the figure comes from the drawing, never from a photograph); " : ""}upload = a person supplies it.
- search_hint names the specific thing, never a general topic.
- Images carry no caption. A disclaimer such as "fictional example" or "screen example only" goes in ONE short line of the text next to the image, once.`;
}

/**
 * Replaces the current article template for a labelled article. It is the
 * whole instruction: shape, writing rules, length and image blocks.
 */
export function directionArticleTemplate(labels: ArticleLabels): string {
  const length = LENGTH_BY_TYPE[labels.type];
  const topics = [labels.topic, labels.topic2]
    .filter((topic): topic is NonNullable<typeof topic> => !!topic)
    .map((topic) => TOPIC_NAMES[topic])
    .join(" + ");
  const tutorial = labels.type === "tutorial";

  return `Write one article for Designally's Knowledge Hub.

Labels: ${describeLabels(labels)}
Pillar: ${PILLAR_NAMES[labels.pillar]}. Type: ${TYPE_NAMES[labels.type]}. Topic: ${topics}.
Keywords to cover naturally (do not stuff them): ${labels.keywords.join(", ")}.

## Shape, in this order
1. Title: an H1. Specific, one clear promise, no clickbait.
2. One-line summary: the line directly under the title, a single sentence in italics (_like this_), at most 25 words. It says what the reader will learn or be able to do.
3. Short intro: 1 to 3 short paragraphs. What is happening and why this reader should care. No scene-setting throat-clearing.
4. "## At a glance": 2 to 4 bullets.
5. The body for this type (below), with any image blocks placed where the reader needs them.
6. "## Key takeaway": one paragraph of 35 to 80 words.
7. Sources: do NOT write them. A Sources list is added automatically after the Key takeaway.
8. Optional: "## Free resource", only when one real, free, linked resource genuinely helps the reader take the next step. It comes last.

## At a glance
- Each bullet STATES an insight itself: the fact, the finding, the rule. A reader who reads only these bullets has learned something.
- Never start a bullet with "This article", "This case", "This tutorial", "This guide", "This piece", "Here" or "In this". Never describe the article.
- Do not start two bullets with the same word or phrase.

## Key takeaway
- 35 to 80 words, framed as the reader's NEXT STEP: what to do, check, try or decide, and when.
- It is not a third summary of the intro or the At a glance. Do not repeat their sentences.

## Body: ${TYPE_NAMES[labels.type]}
${BODY_BY_TYPE[labels.type]}

## Length
About ${length.target.toLocaleString("en-US")} words for the whole article (allowed: ${length.min}–${length.max}), not counting image blocks or sources.${labels.type === "news" ? " News is deliberately short." : ""}

## Real example rule
${
  tutorial
    ? "A tutorial needs a REAL TEST instead of a named example: what happened when the method was actually tried, from a cited source or from a first-hand Designally test supplied in the brief. If neither exists, say plainly what has not been tested."
    : "Include at least one real, named, sourced example (a named studio, brand, product, project or person, linked to its source), or a first-hand Designally example that the brief supplies, clearly marked as Designally's own."
}
Never invent experience, clients, results, numbers or quotes. Never write "we worked with" or "our client" unless the brief says so.

## Writing rules
- Plain language: short sentences, common words, active voice. Explain any technical term in a few words the first time it appears.
- Never use the em dash (—). Use a comma, a colon, parentheses or two sentences.
- Disclaimers ("fictional example", "screen example only") go in ONE short line, never repeated through the body. Images carry no caption.
- Link sources inline on the name or claim they support.
- No hashtags, no FAQ, no social-media caption, no sales pitch.${
    labels.pillar === "all_things_ai"
      ? "\n- All Things AI: keep a creative or business angle throughout. Say what the change means for people who make or buy creative work."
      : ""
  }

${imageBlockInstructions(labels)}`;
}

/** Added to the research plan task for a labelled article. */
export function directionPlanRequirements(labels: ArticleLabels): string {
  const length = LENGTH_BY_TYPE[labels.type];
  const sections = labels.type === "news" ? "1 to 2" : labels.type === "case_study" ? "3 to 5" : "2 to 5";
  return `Article labels: ${describeLabels(labels)}.
Plan a ${TYPE_NAMES[labels.type].toLowerCase()} of about ${length.target} words with ${sections} sections.
${labels.type === "tutorial" ? "Find a real test of the method (a source that tried it and reports what happened)." : "Find at least one real, named example with its own source page (the maker's own page, not coverage of it when the maker's page exists)."}
${labels.type === "case_study" ? "Cite the studio's own project page for the case: its pictures are the only images this article may use." : ""}
${labels.type === "resources" ? "Cite each resource's own page: its previews are the article's images." : ""}
${labels.pillar === "all_things_ai" ? "Keep a creative or business angle; drop general technology news." : ""}`.trim();
}

/** Replaces the current draft task for a labelled article. */
export function directionDraftTask(params: { outlineMarkdown: string; labels: ArticleLabels }): string {
  return `## Task: write the article
Write the complete article from the research plan below, following the article template exactly: its shape, its At a glance and Key takeaway rules, its length for this type, its real example rule and its image block format.

Use only specifics the plan supports. Link a source inline on the name or claim it supports. Do not write a Sources or References section: it is added automatically after the Key takeaway.

Research plan:
${params.outlineMarkdown}

Output the article as clean Markdown only. Start with the H1 title.`;
}

/** Style lines for a pillar's images, for the visual brief and image prompts. */
export function pillarStyleBlock(labels: ArticleLabels | null | undefined): string | null {
  if (!labels) return null;
  const style = PILLAR_IMAGE_STYLE[labels.pillar];
  return [`Pillar style: ${style.name}. ${style.summary}`, `- ${style.worldRule}`].join("\n");
}

/**
 * What a judge or search planner must hold a picture to, for one image of a
 * labelled article. Null for the current behaviour, which adds nothing.
 */
export function imageFitBlock(fit: ImageFit | null | undefined, use: "search" | "judge"): string {
  if (!fit) return "";
  const style = PILLAR_IMAGE_STYLE[fit.pillar];
  const lines = [
    "",
    "THIS PICTURE'S JOB (it overrides anything above that conflicts):",
    `- Article: ${PILLAR_NAMES[fit.pillar]}, ${TYPE_NAMES[fit.type].toLowerCase()}. Picture: ${fit.role === "cover" ? "the cover" : `a body image, role "${fit.role}"`}.`,
    fit.purpose ? `- The reader should understand: ${fit.purpose}` : "",
    fit.subject ? `- The specific subject: ${fit.subject}` : "",
    fit.role !== "cover" ? `- ${ROLE_REQUIREMENT[fit.role]}` : "",
    `- Style: ${style.summary}`,
  ];
  if (use === "search") {
    lines.push(
      "- Build every query from the specific subject (its names: the project, studio, tool or resource) plus what the picture must show. Never search the topic on its own.",
      fit.narrowers?.length ? `- Use these only to narrow a query, never as the whole query: ${fit.narrowers.join(", ")}.` : "",
    );
  } else {
    const rejects = [
      ...style.reject,
      fit.type === "case_study" ? "a stock photograph of anything" : "",
      fit.role === "step" ? "a picture that does not show this step" : "",
    ].filter(Boolean);
    if (rejects.length) lines.push(`- Always reject: ${rejects.join("; ")}.`);
  }
  return lines.filter(Boolean).join("\n");
}

/** The image prompt for a body block filled by Generate (Fal). */
export function blockImagePromptTask(params: {
  title: string;
  labels: ArticleLabels;
  purpose: string;
  caption: string;
  searchHint: string;
  role: string;
}): string {
  const style = PILLAR_IMAGE_STYLE[params.labels.pillar];
  return `## Task: write an image prompt for one body image in an article

Article: ${params.title}
Pillar style: ${style.name}. ${style.summary}
- ${style.worldRule}

The picture's job (role "${params.role}"): ${params.purpose}
Its subject: ${params.searchHint}

Write one paragraph that a photographer or an editorial illustrator could work from: what is in frame, how it is arranged, the light or the technique, two to four colours. Concrete, about this article only.
- No readable text, letters, numbers, logos or interfaces in the picture. Text belongs in drawn figures, never in a generated image.
- No stock clichés: no glowing brains, robots, holograms, hands over keyboards, sticky-note walls.
- Do not call it AI-generated, conceptual or surreal.

Respond with the image prompt only, no quotes, no preamble.`;
}

/** The SVG for a body block filled by Draw. Text in the figure comes from here, never from an image model. */
export function drawFigureTask(params: {
  title: string;
  labels: ArticleLabels;
  role: string;
  purpose: string;
  caption: string;
  context: string;
}): string {
  return `## Task: draw one clean figure for an article, as SVG

Article: ${params.title} (${TYPE_NAMES[params.labels.type]})
Figure role: ${params.role}
What the reader should understand: ${params.purpose}

The part of the article it sits in:
---
${params.context}
---

Draw it as a clean editorial figure: ${
    params.role === "step"
      ? "the one step, shown as the thing being done (panels, controls, arrows, the before and after of the step). Number it if the text numbers it."
      : params.role === "diagram"
        ? "the structure of the idea: its parts, their order, how they connect or compare."
        : "the comparison or structure the purpose names."
  }

Rules:
- Output ONE complete <svg> element and nothing else: no code fences, no prose.
- width="1200" height="800" viewBox="0 0 1200 800". First element: <rect x="0" y="0" width="1200" height="800" fill="..."/> in one plain light colour, covering the whole canvas. Centre the drawing on the canvas.
- Two to four flat colours plus a dark text colour. No gradients, no shadows, no filters, no images, no external links, no scripts, no <foreignObject>.
- Text: font-family="Inter, DejaVu Sans, Arial, sans-serif", font-size 28 or larger, at most 8 words per label, at most 10 labels. Spell every word correctly; use only facts from the article.
- Keep everything inside the canvas with at least 48px of margin.
- No title and no caption or summary sentence anywhere in the figure. Text is only short labels on the parts.
- Never use the em dash.`;
}

/** Propose labels for an article from what the editor typed (preview only). */
export function proposeLabelsTask(params: { text: string; directionName?: string }): string {
  return `## Task: label one article
An editor wants this article:
"""
${params.text}
"""
${params.directionName ? `They filed it under the content direction "${params.directionName}".\n` : ""}
Choose its labels. Only these combinations are allowed:
- creative_insights: type explanation or commentary; topic branding, visual_design, websites_ux or creative_business.
- all_things_ai: type news, explanation, tutorial, commentary or resources; topic ai; optional topic2 (another topic, e.g. branding) when the article is about AI in that field.
- case_studies: type case_study; any topic. Only when the article is about ONE real, named project.
- guides_workflows: type tutorial, business_guide or resources; topic branding, visual_design, websites_ux or creative_business.

Type meanings: news = something that just happened; explanation = how an idea works; commentary = an argued opinion; case_study = one real project; tutorial = steps to make or do something; business_guide = a decision for the business; resources = a list of real tools or materials.

Keywords: 2 to 4, copied exactly from this list:
${LABEL_KEYWORDS_LINE}

Respond as JSON with pillar, type, topic, topic2 (empty string when none) and keywords.`;
}
