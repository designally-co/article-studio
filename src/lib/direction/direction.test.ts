/**
 * Tests for the proposed article direction's plain rules (preview only).
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LABEL_KEYWORDS, validateLabels } from "./labels";
import {
  hubBodyFromBlocks,
  normalizeImageBlocks,
  parseImageBlocks,
  removeImageBlock,
  slotOf,
  takeSummaryLine,
} from "./image-blocks";
import { allowedRoutes, effectiveRoute, isCoverSourceAllowed, rightsForOrigin } from "./image-routing";

const ok = (labels: Record<string, unknown>) => validateLabels({ keywords: ["Typography", "Motion"], ...labels });

test("the Hub's 34 tags are the keyword list", () => {
  assert.equal(LABEL_KEYWORDS.length, 34);
  assert.ok(LABEL_KEYWORDS.includes("Packaging"));
});

test("allowed combinations pass", () => {
  for (const labels of [
    { pillar: "creative_insights", type: "commentary", topic: "branding" },
    { pillar: "all_things_ai", type: "tutorial", topic: "ai", topic2: "branding" },
    { pillar: "all_things_ai", type: "news", topic: "ai" },
    { pillar: "case_studies", type: "case_study", topic: "ai" },
    { pillar: "guides_workflows", type: "business_guide", topic: "creative_business" },
  ]) {
    const check = ok(labels);
    assert.ok(check.ok, JSON.stringify(check));
  }
});

test("invalid combinations are rejected", () => {
  for (const labels of [
    { pillar: "creative_insights", type: "news", topic: "branding" },
    { pillar: "creative_insights", type: "explanation", topic: "ai" },
    { pillar: "all_things_ai", type: "case_study", topic: "ai" },
    { pillar: "all_things_ai", type: "news", topic: "branding" },
    { pillar: "all_things_ai", type: "news", topic: "ai", topic2: "ai" },
    { pillar: "case_studies", type: "tutorial", topic: "branding" },
    { pillar: "guides_workflows", type: "commentary", topic: "branding" },
    { pillar: "guides_workflows", type: "tutorial", topic: "ai" },
    { pillar: "creative_insights", type: "commentary", topic: "branding", topic2: "visual_design" },
    { pillar: "nonsense", type: "news", topic: "ai" },
  ]) {
    assert.equal(ok(labels).ok, false, JSON.stringify(labels));
  }
});

test("keywords must be 2 to 4 of the Hub's tags", () => {
  const base = { pillar: "creative_insights", type: "explanation", topic: "branding" };
  assert.equal(validateLabels({ ...base, keywords: ["Typography"] }).ok, false);
  assert.equal(validateLabels({ ...base, keywords: ["Typography", "Not a tag"] }).ok, false);
  assert.equal(validateLabels({ ...base, keywords: ["A", "B", "C", "D", "E"] }).ok, false);
  const check = validateLabels({ ...base, keywords: ["typography", "PACKAGING", "Typography"] });
  assert.ok(check.ok);
  if (check.ok) assert.deepEqual(check.labels.keywords, ["Typography", "Packaging"]);
});

const draft = `# Title

_A one-line summary of what you will learn._

Intro.

\`\`\`image
id: img-1
role: step
purpose: Show the grid.
caption: Setting the gutter.
alt: A grid panel.
suggested_route: generate
search_hint: Figma layout grid
\`\`\`

More text.

\`\`\`image
id: img-1
role: mood
purpose: Second.
caption: Second caption.
alt: Second alt.
suggested_route: draw
search_hint: x
\`\`\`

\`\`\`image
id: img-3
role: step
purpose: Third.
caption: Third caption.
alt: Third alt.
suggested_route: draw
search_hint: y
\`\`\`

\`\`\`image
id: img-9
role: step
purpose: Fourth.
caption: Fourth.
alt: Fourth.
suggested_route: draw
search_hint: z
\`\`\`

## Key takeaway
`;

test("blocks are parsed in order with their fields", () => {
  const blocks = parseImageBlocks(draft);
  assert.equal(blocks.length, 4);
  assert.equal(blocks[0].id, "img-1");
  assert.equal(blocks[0].role, "step");
  assert.equal(blocks[0].suggestedRoute, "generate");
  assert.equal(blocks[0].searchHint, "Figma layout grid");
  assert.equal(slotOf("img-2"), 2);
  assert.equal(slotOf("img-4"), null);
});

test("a tutorial keeps 3 step blocks, unique ids, and never a generate route", () => {
  const { markdown, blocks, notes } = normalizeImageBlocks(draft, "tutorial");
  assert.equal(blocks.length, 3);
  assert.deepEqual(
    blocks.map((block) => block.id),
    ["img-1", "img-2", "img-3"],
  );
  assert.ok(blocks.every((block) => block.role === "step"));
  assert.ok(blocks.every((block) => block.suggestedRoute === "draw"));
  assert.equal(parseImageBlocks(markdown).length, 3);
  assert.ok(notes.length > 0);
});

test("news and commentary keep no body images", () => {
  for (const type of ["news", "commentary"] as const) {
    const { markdown, blocks } = normalizeImageBlocks(draft, type);
    assert.equal(blocks.length, 0);
    assert.equal(parseImageBlocks(markdown).length, 0);
    assert.ok(markdown.includes("More text."));
    assert.ok(!/\n{3,}/.test(markdown), "no runs of blank lines left behind");
  }
});

test("an explanation keeps one diagram", () => {
  const { blocks } = normalizeImageBlocks(draft, "explanation");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].role, "diagram");
  assert.equal(blocks[0].suggestedRoute, "draw");
});

test("routes follow the type", () => {
  assert.deepEqual(allowedRoutes("case_study"), ["find", "upload"]);
  assert.deepEqual(allowedRoutes("news"), []);
  assert.ok(allowedRoutes("explanation").includes("generate"));
  assert.ok(!allowedRoutes("tutorial").includes("generate"));
  assert.equal(effectiveRoute("case_study", "generate"), "find");
  assert.equal(effectiveRoute("explanation", "generate"), "draw", "the draft may not suggest generate");
  assert.equal(isCoverSourceAllowed("case_study", "generate"), false);
  assert.equal(isCoverSourceAllowed("case_study", "library"), false);
  assert.equal(isCoverSourceAllowed("news", "generate"), true);
  assert.equal(isCoverSourceAllowed("commentary", "cited_pages"), false);
});

test("rights by origin", () => {
  assert.equal(rightsForOrigin("article_source"), "licensed");
  assert.equal(rightsForOrigin("open_license"), "licensed");
  assert.equal(rightsForOrigin("upload"), "own");
});

test("removing a block leaves the rest", () => {
  const md = removeImageBlock(draft, "img-3");
  assert.equal(parseImageBlocks(md).length, 3);
  assert.ok(!md.includes("Third caption."));
});

test("the summary line is lifted out of the body", () => {
  const { summary, markdown } = takeSummaryLine("_A one-line summary of what you will learn._\n\nIntro.");
  assert.equal(summary, "A one-line summary of what you will learn.");
  assert.equal(markdown, "Intro.");
  assert.equal(takeSummaryLine("Intro paragraph.").summary, null);
});

test("filled blocks become the Hub's upload placeholder on their own line; empty ones go", () => {
  const body = normalizeImageBlocks(draft, "tutorial").markdown;
  const out = hubBodyFromBlocks(body, {
    "img-1": { mediaId: 42, caption: "Setting the gutter." },
    "img-3": { mediaId: 43, caption: "Third caption." },
  });
  assert.ok(out.includes("\n![media:42]()\n\n_Setting the gutter._"));
  assert.ok(out.includes("![media:43]()\n\n_Third caption._"));
  assert.ok(!out.includes("```image"));
  assert.ok(!out.includes("Second caption."));
});

test("draft checks measure the proposed shape", async () => {
  const { checkDraft } = await import("./draft-checks");
  const good = `# Title

_What you will learn, in one line._

Intro with [Pentagram's case study](https://www.pentagram.com/work/x).

## At a glance

- A 12-column grid divides into halves, thirds and quarters.
- Gutters set first keep spacing stable.

## Body

Text.

## Key takeaway

Before your next layout, open a blank frame and set twelve columns and a 24px gutter first. Place one heading and one paragraph on it, and check that every later element snaps to the same columns before you add colour or images to the page this week.

## Sources

- [A](https://example.com/a)
`;
  const check = checkDraft(good, "tutorial");
  assert.equal(check.hasSummaryLine, true);
  assert.equal(check.atAGlance.ok, true);
  assert.equal(check.keyTakeaway.ok, true, JSON.stringify(check.keyTakeaway));
  assert.equal(check.inlineSourceLinks, 1);
  assert.equal(check.orderOk, true);
  assert.equal(check.lengthOk, false);

  const bad = checkDraft(`# T\n\n## At a glance\n\n- This article explains grids.\n- This article covers gutters.\n\n## Key takeaway\n\nGrids matter.\n`);
  assert.equal(bad.atAGlance.ok, false);
  assert.equal(bad.atAGlance.describesArticle, 2);
  assert.equal(bad.keyTakeaway.ok, false);
  assert.equal(bad.hasSummaryLine, false);
});

test("an image's credit becomes a References entry with its link", async () => {
  const { imageReference } = await import("./image-blocks");
  assert.deepEqual(imageReference({ credit: "Courtesy of pentagram.com", sourceUrl: "https://www.pentagram.com/work/x" }), {
    label: "Image courtesy of pentagram.com",
    url: "https://www.pentagram.com/work/x",
  });
  assert.deepEqual(imageReference({ credit: "Photo by Ana on Unsplash", sourceUrl: "https://unsplash.com/photos/x" }), {
    label: "Image: Photo by Ana on Unsplash",
    url: "https://unsplash.com/photos/x",
  });
  assert.equal(imageReference({ credit: "Ours", sourceUrl: "" }), null);
});
