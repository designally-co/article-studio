/**
 * THE ONE ARTICLE the launch video follows, and every answer the mock services
 * give about it. Change the article here and every shot follows.
 *
 * It is "Why Refillable Packaging Design Is Harder Than It Looks", as published
 * on the Knowledge Hub (hub.designally.co/articles/why-refillable-packaging-
 * design-is-harder-than-it-looks, 11 September 2026): its title, dek, body and
 * references are copied from there unchanged, and launch/assets/cover.png is
 * its cover. The `whyRelevant` notes and the outline points are the video's
 * own, written from the article.
 */

/** What the editor starts typing on the Create screen, then deletes for the ideas card. */
export const TYPED_START = "Sustainable packaging";

export const TOPIC = "Why Refillable Packaging Design Is Harder Than It Looks";
export const TITLE = TOPIC;
/** The content direction the article files under (a name from src/lib/content-pillars.ts). */
export const DIRECTION_HINT = /^Packaging$/;

export const SOURCES = [
  {
    "name": "Aptar, Dispensing Systems",
    "url": "https://www.aptar.com/",
    "whyRelevant": "A supplier of dispensing systems, including pumps and closures built for repeated reuse."
  },
  {
    "name": "Quadpack",
    "url": "https://www.quadpack.com/",
    "whyRelevant": "A beauty packaging maker whose refillable ranges show the cost and tolerance trade-offs."
  },
  {
    "name": "The Body Shop, Refill Stations",
    "url": "https://www.thebodyshop.com/",
    "whyRelevant": "A retail refill-station model: the loop designed around the store, not only the bottle."
  },
  {
    "name": "L'Oréal Group, Sustainability and Packaging Innovation",
    "url": "https://www.loreal.com/en/sustainability/",
    "whyRelevant": "Describes separating a durable outer case from a replaceable inner pouch."
  }
];

export const SECTIONS = [
  {
    "heading": "The core tension: durability vs. desirability",
    "points": []
  },
  {
    "heading": "The mechanism problem: pumps, seals, and closures",
    "points": []
  },
  {
    "heading": "Material and hygiene constraints",
    "points": []
  },
  {
    "heading": "Systems thinking: designing the whole loop",
    "points": []
  }
];

export const DEK =
  "Learn why refillable packaging demands solving durability, hygiene, and mechanics at once, making it far trickier to design than disposable alternatives.";

export const DRAFT = `# ${TITLE}

Refillable packaging looks like an easy sustainability win. Keep the vessel, swap the contents. But underneath that simple idea sits a genuinely hard design brief.

## The core tension: durability vs. desirability

A refillable container has to survive far more handling than a single-use one: repeated opening, pouring, transport, storage. Wall thickness, hinges, pumps, and closures all need to be engineered for cycle life, not just a good first impression. At the same time, the outer shell still has to look good enough that someone wants to keep it on a shelf. [L'Oréal's sustainability communications](https://www.loreal.com/en/sustainability/) describe this as a deliberate move to separate the durable outer case from a replaceable inner pouch, a structural decision as much as an environmental one.

## The mechanism problem: pumps, seals, and closures

Most consumers never think about the pump that reseals or the gasket that keeps compressing without failing. Suppliers like [Aptar](https://www.aptar.com/) and [Quadpack](https://www.quadpack.com/) build dispensing systems specifically rated for repeated reuse, which changes tolerances and cost compared to standard single-use pumps. A jammed pump or a leaking cap doesn't just read as a defect here. It reads as a broken promise, since the customer already invested in keeping the original vessel.

## Material and hygiene constraints

Refill formats must stay hygienic across multiple fill cycles, which limits material choice and often rules out an open refill-into-open-vessel approach. That's why many systems use sealed inner pouches instead, protecting the formula from air and contamination. It's a regulatory solution disguised as a design detail, and mismatched refill materials can quietly undermine the recyclability the whole system was built for.

## Systems thinking: designing the whole loop

A refillable pack is really three problems: the vessel, the refill unit, and the logistics that return refills to the customer. [The Body Shop's refill stations](https://www.thebodyshop.com/) solve this differently than a mail-back pouch or a dilute-at-home concentrate would. The object can't be designed apart from the system that supports it, which is why refill briefs need packaging designers working alongside engineers and retail designers from day one.

Next time a refill system frustrates or delights you, look closer. That reaction is the design, working exactly as intended.
`;

/** The prompt shown for the cover. It describes the cover image in launch/assets. */
export const IMAGE_PROMPT =
  "Studio product photograph of a refillable skincare set, shot straight on: an orange stand-up refill pouch with a line-drawn flower, a navy pouch with a crescent moon and stars, and a slim white bottle with an orange wave-patterned cap, on a pale pink backdrop under a navy scalloped band, soft even light.";

/**
 * The Ideas list the "no topic yet" path shows. The first is the article; the
 * others are plausible neighbours from other directions, never opened.
 * `direction` is matched against the content directions the schema offers.
 */
export const IDEAS = [
  {
    title: TITLE,
    angle: "Keep the vessel, swap the contents: why refill systems make packaging designers solve durability, hygiene and mechanics at once.",
    whyTimely: "Refill formats are a common sustainability promise, and the design work that makes them function is rarely explained.",
    searchIntent: "refillable packaging design challenges",
    sources: [
      { name: "Aptar", url: "https://www.aptar.com/" },
      { name: "Quadpack", url: "https://www.quadpack.com/" },
      { name: "The Body Shop", url: "https://www.thebodyshop.com/" },
    ],
    direction: /^Packaging$/,
  },
  {
    title: "How Variable Fonts Are Changing Brand Identity Systems",
    angle: "One font file can hold a whole family, which turns a brand's type palette into a set of ranges.",
    whyTimely: "",
    searchIntent: "variable fonts brand identity",
    sources: [],
    direction: /^Typography$/,
  },
  {
    title: "What Makes a Motion Identity Feel Like the Brand",
    angle: "Timing, easing and rhythm as brand assets, not decoration.",
    whyTimely: "",
    searchIntent: "motion identity design",
    sources: [],
    direction: /^Motion$/,
  },
  {
    title: "Why Most Design Systems Stall After Version One",
    angle: "The work that keeps a system alive is governance, not components.",
    whyTimely: "",
    searchIntent: "design system adoption",
    sources: [],
    direction: /^Design Process$/,
  },
];

/** Values for any schema this file does not know by name, so a new call never breaks the run. */
function fill(schema, key = "") {
  if (!schema || typeof schema !== "object") return null;
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case "object": {
      const out = {};
      for (const [name, child] of Object.entries(schema.properties ?? {})) out[name] = fill(child, name);
      return out;
    }
    case "array":
      return Array.from({ length: schema.minItems ?? 0 }, () => fill(schema.items, key));
    case "number":
    case "integer":
      return schema.minimum ?? 1;
    case "boolean":
      return false;
    default:
      return /title/i.test(key) ? TITLE : /url/i.test(key) ? SOURCES[0].url : "";
  }
}

/** The first direction in the schema's list that matches the article. */
function direction(schema) {
  const options = schema?.properties?.direction?.enum ?? [];
  return options.find((name) => DIRECTION_HINT.test(name)) ?? options[0];
}

/**
 * The answer to one Messages API call. `schema` is the call's JSON schema
 * (absent for plain text and streams); `task` is the user turn.
 * `kind` names the gate the answer waits at (see mock/server.mjs).
 */
export function answerFor({ schema, task, stream }) {
  const keys = Object.keys(schema?.properties ?? {});
  const has = (...names) => names.every((name) => keys.includes(name));

  if (stream) return { kind: "draft", text: DRAFT };
  if (has("topics")) {
    const names = schema.properties.topics.items.properties.direction?.enum ?? [];
    const topics = IDEAS.map(({ direction, ...idea }) => ({
      ...idea,
      ...(names.length ? { direction: names.find((name) => direction.test(name)) ?? names[0] } : {}),
    }));
    return { kind: "topic_ideas", data: { topics } };
  }
  if (has("direction") || has("workingTitle")) {
    return { kind: "article_setup", data: { direction: direction(schema), workingTitle: TITLE } };
  }
  if (has("introAngle", "sections")) {
    return {
      kind: "plan",
      data: {
        title: TITLE,
        introAngle: "Keep the vessel, swap the contents: why that simple idea is a hard design brief.",
        sections: SECTIONS,
        sources: SOURCES,
        cta: "Talk to Designally about designing a refill system, not just a pack.",
      },
    };
  }
  if (has("referenceScene", "scene")) {
    return {
      kind: "visual_brief",
      data: {
        referenceScene: "",
        scene: "A refillable skincare set: two stand-up refill pouches and the durable bottle they refill, on a pink studio backdrop.",
        medium: "photograph",
        alternateScenes: [],
        photoQuery: "refill pouch skincare bottle",
      },
    };
  }
  if (!schema && /image prompt/i.test(task)) return { kind: "image_prompt", text: IMAGE_PROMPT };
  if (!schema && /dek|summary|standfirst/i.test(task)) return { kind: "dek", text: DEK };
  return { kind: `unknown:${keys.join(",") || "text"}`, data: schema ? fill(schema) : undefined, text: schema ? undefined : DEK };
}

/** The mock Fal.ai: every generation returns the cover in launch/assets. */
export function falAnswer({ path }) {
  return {
    kind: "generate",
    body: {
      images: [{ url: "https://v3.fal.media/files/launch/cover.png", width: 1536, height: 1024, content_type: "image/png" }],
      seed: 7,
      has_nsfw_concepts: [false],
      prompt: IMAGE_PROMPT,
      request_path: path,
    },
  };
}
