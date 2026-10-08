/**
 * THE ONE ARTICLE the launch video follows, and every answer the mock services
 * give about it. Change the article here and every shot follows.
 *
 * The sources are real, stable pages (a specification, a browser reference and
 * a type foundry's guide), so the Hub page at the end links to things that
 * exist.
 */

export const TOPIC = "How variable fonts are changing brand identity systems";
export const TITLE = TOPIC;
export const DIRECTION_HINT = /typograph/i;

export const SOURCES = [
  {
    name: "OpenType Font Variations overview (Microsoft Typography)",
    url: "https://learn.microsoft.com/en-us/typography/opentype/spec/otvaroverview",
    whyRelevant: "The specification: how one font file holds a continuous design space along named axes.",
  },
  {
    name: "Variable fonts guide (MDN Web Docs)",
    url: "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_fonts/Variable_fonts_guide",
    whyRelevant: "How the registered axes are set from CSS, and what browsers support.",
  },
  {
    name: "Introducing variable fonts (Google Fonts Knowledge)",
    url: "https://fonts.google.com/knowledge/introducing_type/introducing_variable_fonts",
    whyRelevant: "A designer-facing explanation of axes, instances and file-size trade-offs.",
  },
];

export const SECTIONS = [
  {
    heading: "One file, a whole family",
    points: [
      "A static family ships one file per style; a variable font ships one file with a continuous range.",
      "Registered axes: weight, width, slant, italic and optical size.",
    ],
  },
  {
    heading: "What changes for an identity system",
    points: [
      "Rules can be written as ranges rather than a short list of named styles.",
      "Optical size lets one typeface stay crisp on a billboard and a phone screen.",
    ],
  },
  {
    heading: "Where to be careful",
    points: ["Too much freedom erodes recognition.", "Name the instances the brand actually uses."],
  },
];

export const DEK =
  "One font file can now hold a whole family of weights and widths. For brand teams, that turns a type palette into a set of ranges, and asks for clearer rules.";

export const DRAFT = `# ${TITLE}

For most of the history of digital type, a brand typeface arrived as a folder of files: Regular, Medium, Bold, perhaps a Condensed cut for tight spaces. Each was a separate font, and an identity system was written around that short list. Variable fonts change the unit. Since OpenType 1.8 introduced font variations in 2016, a single file can hold a continuous design space, and every point in it is a usable style.

## One file, a whole family

A variable font is built along axes. The specification registers five of them: weight, width, slant, italic and optical size. A designer can also define custom axes for anything the typeface needs, from the height of serifs to the roundness of terminals. Instead of choosing between Regular and Bold, a layout can ask for weight 430, or width 88.

On the web, the same file serves every style. The browser reads the axis values from CSS, so a heading, a caption and a button label can all come from one download.

## What changes for an identity system

The first change is how type rules are written. A guideline that once said "use Bold for headlines" can now give a range, and let the weight respond to size, contrast or the surface it sits on.

The second is optical size. Small text needs more open shapes and looser spacing; large text can be tighter and finer. With an optical size axis, one typeface can stay crisp on a billboard and on a phone screen without the brand team switching families.

The third is motion. Because the axes are continuous, type can move between styles smoothly. A logotype can gain weight as it loads, or a campaign line can widen across a sequence, and it is still the same typeface.

## Where to be careful

Freedom is also the risk. If every team picks its own point on every axis, the brand stops looking like itself. Good systems name the instances they actually use, set limits on each axis, and show the ranges in the guidelines with examples.

It is also worth checking where the type will live. Most current browsers support variable fonts well, but some production tools and older platforms still expect static files, so a brand pack should include both.

## What it means for designers

Variable fonts do not replace typographic judgement. They move it. The work shifts from choosing a few fixed styles to designing the space between them, and writing rules clear enough that other people can use that space well.
`;

/** The prompt shown for the cover. Describes the cover image in launch/assets. */
export const IMAGE_PROMPT =
  "Editorial still life of a brand typeface specimen: large printed letterforms stepping from thin to heavy weight across a row of cards on a pale studio surface, soft side light from the left, shallow depth of field, calm warm palette with a single coral accent, no other text.";

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
  if (has("direction") || has("workingTitle")) {
    return { kind: "article_setup", data: { direction: direction(schema), workingTitle: TITLE } };
  }
  if (has("introAngle", "sections")) {
    return {
      kind: "plan",
      data: {
        title: TITLE,
        introAngle: "From a folder of static styles to one continuous design space, and what that asks of brand guidelines.",
        sections: SECTIONS,
        sources: SOURCES,
        cta: "Talk to Designally about building a type system that scales.",
      },
    };
  }
  if (has("referenceScene", "scene")) {
    return {
      kind: "visual_brief",
      data: {
        referenceScene: "",
        scene: "Printed type specimens of one typeface, stepping from thin to heavy weight, laid out on a studio surface.",
        medium: "photograph",
        alternateScenes: [],
        photoQuery: "type specimen printed letterforms",
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
