import type { Language } from "@/db/schema";
import { EDITORIAL_SCOPE_TEXT } from "@/lib/designally-strategy";
import { IMAGE_DIRECTION, IMAGE_RULES } from "@/lib/image/visual-brief";

/** The direction, stated identically wherever it is needed. */
const visualDirectionBlock = (): string =>
  [
    `Visual direction: ${IMAGE_DIRECTION.name} — ${IMAGE_DIRECTION.summary}`,
    "",
    ...IMAGE_RULES.map((rule) => `- ${rule}`),
  ].join("\n");

/** Task layer — stage-specific instructions. Versioned per template. */
export const TASKS_VERSION = "tasks@3.1.0";

/** How far back a news-driven idea may sit and still count as current. */
const RECENCY_DAYS = 90;

const formatDay = (date: Date) =>
  date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/**
 * The clock the topic prompts run against. Without it the model has no idea
 * when "now" is, and anchors "timely" on the densest part of its training data.
 */
export function recencyWindow(): { today: string; since: string } {
  const now = new Date();
  return {
    today: formatDay(now),
    since: formatDay(new Date(now.getTime() - RECENCY_DAYS * 24 * 60 * 60 * 1000)),
  };
}

const marketFor = (language: Language) =>
  language === "th"
    ? "the Thai market (search Thai-language sources and current Thailand trends)"
    : "the global/English market";

export function editorialArticlePlanTask(params: {
  topic: string;
  brief?: string;
  format?: string;
  period?: string;
  language: Language;
  seedSources?: { name: string; url: string }[];
  pillarName?: string;
  pillarPurpose?: string;
}): string {
  return `## Task: research and plan one creative-industry article
Research the current subject using reliable sources, prioritizing official creator, product, foundry, studio, project, and documentation pages. Produce a concise article plan that contains enough verified detail for a writer to create the complete article without a separate candidate or curation step.

Topic: ${params.topic}
Content pillar: ${params.pillarName || "—"}${params.pillarPurpose ? ` — ${params.pillarPurpose}` : ""}
Brief: ${params.brief || "None"}
Format: ${params.format || "Choose the most useful editorial structure"}
Period: ${params.period || "Current / not fixed"}
Market: ${marketFor(params.language)}
${params.seedSources?.length ? `Sources already found during topic discovery; verify and reuse them first:\n${params.seedSources.map((source) => `- ${source.name}: ${source.url}`).join("\n")}` : ""}

Requirements:
- Keep the article useful to designers and creative teams.
- For roundups, choose only as many examples as a focused article genuinely needs.
- Include concrete names, attribution, supported characteristics, and why each example matters.
- For dated topics, include only items with evidence connecting them to the requested period.
- Never invent popularity, release timing, quotations, facts, or URLs.
- Do not turn the subject into business advice or a Designally sales message.

Respond as JSON with a working title, concise introduction angle, 4–8 purposeful sections with specific evidence-led points, 4–10 reliable sources, and an empty CTA unless the subject genuinely needs a useful next step.`;
}

export function topicsTask(params: {
  /** Omit to range across every available direction instead of one. */
  categoryName?: string;
  language: Language;
  pillarName?: string;
  pillarPurpose?: string;
  examples?: string[];
  /** Selectable direction names, required when `categoryName` is omitted. */
  directionNames?: string[];
  /** Today, written out. Without it the model infers "now" from its training data. */
  today: string;
  /** Start of the window a news-driven idea must fall inside to count as current. */
  since: string;
  /** True when the web tool is available and ideas should carry real sources. */
  researchLive?: boolean;
}): string {
  const open = !params.categoryName;
  // Three scopes, widest first: the whole territory, one pillar, one direction.
  // A pillar is "open" as far as the schema is concerned — the model still
  // assigns each idea to a direction — but the territory it ranges over is the
  // pillar's directions only, which `directionNames` has already narrowed to.
  const scopeLine = open
    // "At least four directions" was raised to force variety, and it also
    // forced the model to research four subjects before it could answer. With
    // three ideas requested the two constraints contradict each other, so this
    // asks for distinctness instead of a count — variety without the breadth
    // tax. See the note on the count below.
    ? params.pillarName
      ? `Suggest timely, researchable article ideas from across the "${params.pillarName}" content pillar in ${marketFor(params.language)}${params.pillarPurpose ? ` — ${params.pillarPurpose}` : ""} Spread the ideas across the pillar's directions and make them genuinely distinct from one another rather than variations on one subject.`
      : `Suggest timely, researchable article ideas from anywhere in Designally's editorial territory in ${marketFor(params.language)}. Make the ideas genuinely distinct from one another rather than variations on one subject.`
    : `Suggest timely, researchable directions for the content direction "${params.categoryName}" in ${marketFor(params.language)}.`;
  const pillarLine = !open && params.pillarName
    ? `\nThis direction lives under the "${params.pillarName}" content pillar${params.pillarPurpose ? ` — ${params.pillarPurpose}` : ""}. Every idea must serve that pillar's intent.`
    : "";
  const examplesBlock = params.examples?.length
    ? `\n\nExample headlines that fit this pillar (match their tone and specificity; do not reuse them verbatim):\n${params.examples.map((example) => `- ${example}`).join("\n")}`
    : "";
  const directionBlock = open
    ? `\n\nAssign every idea to exactly one of these content directions, copying the name verbatim:\n${(params.directionNames ?? []).map((name) => `- ${name}`).join("\n")}`
    : "";
  const directionField = open ? `, "direction": string` : "";
  const sourcesField = params.researchLive ? `, "sources": [{ "name": string, "url": string }]` : "";

  const researchBlock = params.researchLive
    ? `\n\nUse web search before proposing anything news-driven. Confirm that what you are describing has actually happened, and that it happened on or after ${params.since}. For every idea, return 1–3 real sources you actually consulted, copying their URLs exactly. Never fabricate a URL, and never pad the list with a homepage that does not cover the specific development. An evergreen craft idea may return an empty source list.`
    : `\n\nLive source lookup is unavailable for this request. Return an empty source list, favor evergreen craft subjects over news-driven ones, and do not claim that anything is new, recent, trending, or newly released. Do not invent source URLs; live source research happens only after the editor selects a topic.`;

  return `## Task: suggest topics
Today is ${params.today}.

${scopeLine}${pillarLine} Prioritize concrete resources, releases, developments, and genuine questions that matter to designers. Each direction must be specific enough for the next stage to research and useful enough to become a complete creative-industry article.${examplesBlock}${directionBlock}

Stay within Designally's editorial territory:
${EDITORIAL_SCOPE_TEXT}

Anchor every idea in time:
- A news-driven idea — a release, launch, acquisition, industry development, or newly published resource — counts only if it happened on or after ${params.since}. Begin its "whyTimely" with the date or month it happened.
- An evergreen craft idea — a principle, method, system, or reference collection — is welcome, but its "whyTimely" must give a real reason to publish it now and must not dress it up as news.
- Never present something from before ${params.since} as new, recent, or trending, and never state a date you cannot support. If you are unsure when something happened, treat it as evergreen and say so.
- Do not reuse a year or season from memory as a stand-in for the present. The only dates you may treat as current are the ones you can support for this request.${researchBlock}

Favor useful editorial formats such as curated resources, notable new releases, practical reference collections, informed explainers, design-principle analysis, and evidence-led perspectives on changes affecting designers. Reject broad topics that do not have a strong creative-agency or designer angle.

Return exactly 3 topic ideas. For each: a proposed title, the angle, why it is relevant now, and the likely reader intent.

Respond as JSON:
{
  "topics": [
    { "title": string, "angle": string, "whyTimely": string, "searchIntent": string${directionField}${sourcesField} }
  ]
}`;
}

/**
 * Reads an editor's free-text article input. Used at submit time to fill only
 * what the form could not determine on its own: the content direction when the
 * editor left it on auto, and a working title when the input is a brief rather
 * than a usable headline.
 */
export function articleSetupTask(params: {
  text: string;
  needDirection: boolean;
  needTitle: boolean;
  directionNames: string[];
}): string {
  const wants = [
    params.needDirection ? "the content direction it belongs to" : null,
    params.needTitle ? "a working title" : null,
  ].filter(Boolean);

  const directionBlock = params.needDirection
    ? `\n\nChoose exactly one content direction, copying the name verbatim from this list:\n${params.directionNames.map((name) => `- ${name}`).join("\n")}\nPick the direction the finished article would be filed under, not the one the wording superficially resembles.`
    : "";
  const titleBlock = params.needTitle
    ? `\n\nWrite a working title: a specific, factual headline of at most 12 words describing the article this input asks for. Use the editor's own subject and constraints. Do not add claims, numbers, dates, or superlatives the input does not support, and do not write a title that merely restates the instruction ("Article from brief" and similar are unacceptable).`
    : "";

  return `## Task: read the article input
An editor has described the article they want. Determine ${wants.join(" and ")}.

Stay within Designally's editorial territory:
${EDITORIAL_SCOPE_TEXT}

Editor's input:
"""
${params.text}
"""${directionBlock}${titleBlock}

Respond as JSON with only the requested fields.`;
}

export function draftTask(params: {
  outlineMarkdown: string;
  longForm: boolean;
}): string {
  return `## Task: write draft
Write a complete, publish-ready article for Designally's article platform from the approved outline/plan below. Follow the brand strategy, selected audience, message pillar, objective, and format rules exactly. The finished article may later be shared on social media, but it must not read like a social post.

Treat the outline's research notes as a reporting pack. Use only source-supported specifics. You may link a source inline on the relevant name or claim in Markdown where it reads naturally. Do not add your own references or "Sources" section — a sources list is appended automatically after your draft. For every main section, move from concrete detail to interpretation: what it is, what makes it distinctive or consequential, and why the selected reader should care. Do not pad the article to meet a word count.

Approved outline/plan:
${params.outlineMarkdown}

Output the finished draft as clean Markdown only — no preamble, no explanation, no "here is your draft". Start directly with the content.`;
}

export function imagePromptTask(params: {
  title: string;
  visualBrief: import("@/lib/image/visual-brief").ArticleVisualBrief;
  /** The scene THIS prompt shows — the brief's lead scene, or one of its alternates. */
  scene: string;
  /** Where this prompt sits in the set, so it can be told what not to repeat. */
  variantNo: number;
  variantCount: number;
  siblingScenes: string[];
  hasReferenceImage: boolean;
}): string {
  return `## Task: write an image prompt for one photograph

${visualDirectionBlock()}

Write it the way a photographer would be briefed:
- Describe the scene assigned below as a photograph: what is in frame, how it is arranged, where it is, what surrounds it. If there are people in it, what their hands are doing; if there are none, do not invent any.
- Lens feel and distance, where the light comes from and how hard it is, what is sharp and what falls away, the time of day the room suggests.
- Specific ordinary detail — a cooling coffee, a cable half-coiled, a second monitor turned away, papers that have been moved. That is what makes a photograph read as real.
- Do not call it art, conceptual, surreal, editorial, or a metaphor. It is a photograph of something that happened.

Title: ${params.title}

THE SCENE THIS PHOTOGRAPH SHOWS (image ${params.variantNo} of ${params.variantCount}):
${params.scene}
${
  params.hasReferenceImage && params.visualBrief.referenceScene
    ? `
THE REFERENCE PHOTOGRAPH SHOWS: ${params.visualBrief.referenceScene}

Yours must be the same kind of picture as that — same sort of subject, setting, framing and light. Another instance of that kind of photograph, not that one.

THE REFERENCE DECIDES WHETHER ANYBODY IS IN THE FRAME. If it shows no person, yours shows no person: an abstract or graphic reference means an abstract or graphic image — printed material, an arrangement of objects, a surface, a space. Adding a human to a picture that had none is the single most common way this goes wrong.
`
    : ""
}${
  params.siblingScenes.length > 0
    ? `
The other images in this set show these scenes. Yours must be a different picture from each — a different moment, a different vantage, a different part of the work — while staying the same kind of scene as the reference:
${params.siblingScenes.map((scene) => `- ${scene}`).join("\n")}
`
    : ""
}
Respond with the image prompt only — one paragraph, no quotes, no preamble.`;
}

export function articleVisualBriefTask(params: {
  title: string;
  article: string;
  hasReferenceImage: boolean;
  variantCount: number;
}): string {
  return `## Task: decide what photograph this article should carry

${visualDirectionBlock()}

${
  params.hasReferenceImage
    ? `A REFERENCE PHOTOGRAPH IS ATTACHED TO THIS MESSAGE. Look at it.

Write \`referenceScene\`: one sentence describing what it actually shows — the subject, what they are doing, the setting, the framing, the light. Describe the photograph in front of you, not what you expect it to be.

Then write \`scene\`: a picture OF THE SAME KIND, about this article's subject. Another instance of that sort of photograph, not that one. That correspondence is the whole job — an image LIKE the reference, not one merely inspired by it.

THE SAME KIND INCLUDES WHETHER ANYBODY IS IN IT. If the photograph in front of you has no person in it, your scene must have none — describe printed material, objects on a surface, a screen, a room. Do not put a designer at a desk into a scene the reference answered with a flat-lay.`
    : `Set \`referenceScene\` to an empty string — no photograph is attached.

Write \`scene\`: one sentence describing something a photographer could have walked in on. Name what is in frame, how it is arranged, where it is, and what surrounds it — people at work, or objects and printed material with nobody there. Either is right; the article decides.`
}

An article about designers using AI is a designer working — not a glowing brain, a robot hand, or a floating interface. An article about a brand audit is the printed brand material itself: stationery and packaging laid out on a table, a wall of pinned logo variations, a colour book open beside a swatch fan — no person required, and none unless the reference has one. An article about type licensing is a drawer of metal type in a workshop, or somebody at a screen with a foundry's licence page open. If a reader could not say what is in the picture, the scene is not doing its job. Ordinary and slightly untidy beats styled.

Write \`alternateScenes\`: ${Math.max(params.variantCount - 1, 0)} other real scenes from the same world. Not the same moment from another angle — a different one: a different part of the work, a different arrangement, a different room, a different time of day. An editor is choosing between the finished photographs, so two scenes that would produce the same picture are one wasted choice.

Write \`photoQuery\`: three to six words to search a stock photo library with, describing the SITUATION and nothing else — "designer working at desk laptop", "brand stationery flat lay table", "typographer inspecting metal type", "colour swatches and print samples". No brand names, no abstract nouns, no adjectives about mood. This finds the reference photograph the finished image is matched against, so it must describe something a photographer would actually have shot.

Finished title: ${params.title}

Finished article:
---
${params.article}
---`;
}

export function referenceSearchPlanTask(params: {
  title: string;
  angle?: string;
  article?: string;
  seedQuery?: string;
}): string {
  return `## Task: plan a stock-photo search for this article's reference photograph

A reference photograph is what the article's image is later matched against. It does not have to show the article's exact subject. It has to be RELATED: the same world, the same kind of work. Plan searches that a stock photo library (Unsplash) can actually answer.

Write \`queries\`: four to six searches, two to five words each, ordered from the best kind of photograph down to the merely acceptable. Tag each with its tier.

- \`best\`: the work itself being done. The tools, software, screens, materials or workspace of the practice the article is about. For an article about motion on brand websites: "after effects timeline on monitor", "motion designer editing animation", "animation keyframes on screen".
- \`acceptable\`: the subject matter without the work. The artefact, the material, the result. For the same article: "animated graphic shapes", "abstract kinetic typography", "colourful geometric motion graphics".

Use the words a photographer would file the picture under. Name software or tools only where photographs of them in use plausibly exist. No other brand or company names, no abstract nouns ("innovation", "future", "success"), no mood adjectives, and never the article's headline.

Write \`avoid\`: two to five short phrases naming the photographs a careless search would return that are WRONG for this article. Above all, literal readings of the topic's words that belong to a different world. For motion: "people moving with motion blur", "long-exposure traffic trails", "running athletes". For branding: "cattle branding". For a layout grid: "electrical power grid". Add the obvious stock clichés for the topic too.
${
  params.seedQuery
    ? `\nThe image brief already suggested this search. It is a reasonable starting point but may be too narrow: "${params.seedQuery}"\n`
    : ""
}
Title: ${params.title}${params.angle ? `\nAngle: ${params.angle}` : ""}${
    params.article ? `\n\nOpening of the article:\n---\n${params.article}\n---` : ""
  }`;
}

export function referenceJudgeTask(params: {
  title: string;
  angle?: string;
  best: string[];
  acceptable: string[];
  avoid: string[];
  captions: string[];
}): string {
  const quoted = (items: string[]) => items.map((item) => `"${item}"`).join(", ");
  return `## Task: judge which search results can serve as this article's reference photograph

${params.captions.length} photographs are attached, in order: the first image is candidate 1, the second is candidate 2, and so on. Judge what each picture actually SHOWS. The caption is the library's and is often wrong.

The article:
Title: ${params.title}${params.angle ? `\nAngle: ${params.angle}` : ""}

Give every candidate exactly one verdict:
- \`best\`: shows the work of this article's world being done — its tools, software, screens, materials or workspace. The search aimed at: ${quoted(params.best) || "(none)"}.
- \`acceptable\`: clearly shows the subject matter of this world without the work — the artefact, the material, the result. The search also tried: ${quoted(params.acceptable) || "(none)"}.
- \`reject\`: anything else. In particular a literal reading of the topic's words that belongs to a different world (${quoted(params.avoid) || "none named"}), a generic stock cliché, a picture whose connection to the article needs explaining, a logo or wordmark, or a picture that is mostly readable text.

Related is enough; it does not have to match the article exactly. But if you cannot say in one short sentence how a picture belongs to this article's world, reject it.

Library captions, for context only:
${params.captions.map((caption, index) => `${index + 1}. ${caption || "(no caption)"}`).join("\n")}`;
}

export function sourceImageJudgeTask(params: {
  title: string;
  angle?: string;
  opening: string;
  pages: string[];
}): string {
  return `## Task: judge pictures taken from the pages this article cites

${params.pages.length} pictures are attached, in order: the first image is candidate 1, the second is candidate 2, and so on. Each was taken from a web page the article cites as a source. Judge what each picture actually SHOWS.

The article:
Title: ${params.title}${params.angle ? `\nAngle: ${params.angle}` : ""}
Opening:
${params.opening}

Give every candidate exactly one verdict:
- \`subject\`: shows the very thing this article is about — the specific identity, typeface, product, publication, building, campaign or piece of work the article names and discusses. A reader would recognise it as a picture OF the article's subject.
- \`related\`: belongs to the article's world and would make a good reference for a new image — the same kind of work, material or setting — but it is not the specific thing the article is about.
- \`reject\`: anything else. ALWAYS reject a photograph whose main subject is a person's face or upper body — an author, contributor, staff or speaker headshot, a portrait, a team photo — whoever it may be. Also reject logos and wordmarks on their own, advertising, buttons and interface chrome, thumbnails of other articles, and pictures that are mostly readable text.

Be strict with \`subject\`: it means the picture could run as this article's cover because it shows exactly what the article is about. When unsure between \`subject\` and \`related\`, choose \`related\`.

The page each picture came from, for context only:
${params.pages.map((page, index) => `${index + 1}. ${page}`).join("\n")}`;
}

export function brandReviewTask(article: string): string {
  return `## Task: qualitative brand review
Review the article against the supplied Designally brand strategy and project foundation. Do not calculate a score, approval rate, or predicted performance. Evaluate these exact criteria:
1. Starts with the selected audience's business reality.
2. Names the problem before presenting Designally or a solution.
3. Uses short, direct sentences and active voice.
4. Sounds confident without hype, exaggeration, or generic agency language.
5. Speaks in business outcomes rather than only deliverables.
6. Reinforces the selected message pillar naturally rather than forcing a pitch.
7. Uses a low-pressure next step appropriate to the selected article objective.
8. Makes only supported claims and does not invent proof.
9. Uses concrete names, examples, and details instead of generic claims.
10. Connects evidence to interpretation: what happened, what is distinctive, and why it matters.
11. Links supplied sources contextually and does not invent citations.
12. Maintains editorial momentum without repetitive summaries, listicle filler, or generic transitions.

For each criterion return "aligned" when it is clearly met or "review" when a specific improvement is advisable. Findings must quote no more than a short phrase from the article. Suggestions must be concrete and concise.

Article to review:
---
${article.slice(0, 24000)}
---

Respond as JSON:
{
  "summary": string,
  "checks": [
    { "criterion": string, "status": "aligned" | "review", "finding": string, "suggestion": string }
  ]
}`;
}

export function editorialReviewTask(article: string): string {
  return `## Task: editorial fact-check and quality review
Review this Editorial Discovery article against its supplied research pack. Do not score it. Evaluate these exact criteria:
1. Every included entry appears in the curated outline and no unselected entry was added.
2. Names, creators, foundries/organizations, and URLs are internally consistent with the research notes.
3. Release timing and claims of being new, notable, popular, or trending are supported rather than assumed.
4. Technical features, quantities, and factual claims are supported; uncertain details are clearly qualified.
5. Each entry explains what it is, what distinguishes it, and why designers should care.
6. The introduction sets the period and creative context without forcing a business problem.
7. The writing avoids repetitive review formulas, generic praise, filler, and invented quotations.
8. Sources are linked contextually and no URL appears invented.
9. Designally's voice is direct, warm, clear, and non-salesy.
10. There is no SEO padding, conversion CTA, or unrelated business-advice framing.

Return "aligned" when a criterion is met or "review" when a concrete editorial correction is needed. Do not claim that you independently opened a link; judge source consistency from the research notes supplied in the article context.

Article:
---
${article.slice(0, 24000)}
---

Respond as JSON:
{
  "summary": string,
  "checks": [
    { "criterion": string, "status": "aligned" | "review", "finding": string, "suggestion": string }
  ]
}`;
}
