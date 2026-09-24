/**
 * One job: find a photograph of the scene, then make a picture like it.
 *
 * This file used to carry two visual directions, six composition presets,
 * four judging criteria, seven style characteristics, and a fourteen-field
 * brief. Every one of them was a decision the editor had to make or the model
 * had to weigh, and together they buried the only thing that turned out to
 * matter: a real photograph of the situation, and an image of the same kind.
 *
 * What is left is that, and nothing else. An article about designers working
 * with AI finds a photograph of a designer at a desk and produces a picture of
 * a designer at a desk — a different person, a different room, the same kind
 * of picture. No metaphor, no framing preset, no mode to choose.
 */

/** What the finished image is: a photograph, not an illustration or a render. */
export const IMAGE_DIRECTION = {
  name: "Grounded Editorial",
  summary:
    "A real, believable scene from the world the article describes, photographed rather than imagined.",
} as const;

/**
 * The rules the prompt writer works to.
 *
 * Lines, not paragraphs. These reach Claude, never the image model —
 * see `finishImagePrompt` for what the image model is actually sent, and why
 * the difference matters.
 */
export const IMAGE_RULES = [
  "THE REFERENCE DECIDES WHAT IS IN FRAME. If it shows no people, yours shows none. An abstract or graphic reference means an abstract or graphic image — a printed layout, an arrangement of objects, a surface, a space. Do not add a person to a picture that had none.",
  "Show the real subject the article is about, whatever kind of thing that is: people at work, objects on a table, printed material, a screen, a room.",
  "Match the reference photograph in kind — same sort of subject, setting, framing and light. Another instance of that kind of picture, not that one.",
  "Photographic, not rendered: one light source that makes sense, natural falloff, believable depth of field, honest surface texture.",
  "Unstaged: things as they would actually be, the small untidiness of real use, nothing arranged for the camera.",
  "The colours the setting would really have. No neon, no gradient backdrop, no teal-and-orange grade.",
  "Nothing surreal, symbolic, floating, or impossible. If it could not exist in the room, it does not belong.",
  /* The three below are what separates a design publication's picture from a
     stock one — the work itself, seen closely, briefed like a shoot — and none
     of them is a look: palette, mood and framing stay the article's own. */
  "When the article is about a made thing — a typeface, an identity, a book, a product, a building, an interface — show the thing itself, close enough to see what it is made of: paper stock, ink, print, stitching, screen pixels, wear.",
  "Brief it the way a photographer would: where the camera stands, how close, how long the lens, where the light comes from and at what time of day.",
  "None of the stock and AI tells: hands hovering over a keyboard, a face lit by a glowing screen, walls of sticky notes, lightbulbs, brains, holograms, robots, floating interface panels, flawless skin, a product centred on a seamless backdrop.",
] as const;

/** Never write more prompts than the providers will render in one go. */
export const MAX_PROMPT_VARIANTS = 4;

/**
 * What the model reads the article for.
 *
 * Four fields. Everything the old brief carried besides these — article type,
 * structure, image role, mood, composition, visual characteristics, named
 * subjects, reference guidance, the reason for the concept — was either never
 * read by anything downstream or read only to be shown back to the editor in a
 * panel nobody acted on.
 */
export type ArticleVisualBrief = {
  /**
   * What the attached reference photograph actually shows, in one sentence.
   * Empty when nothing is attached.
   */
  referenceScene: string;
  /**
   * The scene this article's image should show — a moment, not a metaphor, and
   * the same KIND of subject as the reference. If the reference has no people
   * in it, this must not put any in.
   */
  scene: string;
  /** Other real scenes from the same world, one per extra variation. */
  alternateScenes: string[];
  /**
   * Three to six words to search a stock library with, describing the
   * situation: "designer working at desk laptop". Not the topic — the picture.
   */
  photoQuery: string;
};

/** One image prompt and the scene it shows. */
export type ImagePromptVariant = {
  scene: string;
  prompt: string;
};

export type DraftedImagePrompt = {
  /** `variants[0].prompt` — the one shown in the editable field. */
  prompt: string;
  brief: ArticleVisualBrief;
  /** One entry per requested variation, each a different scene. */
  variants: ImagePromptVariant[];
};

/**
 * What the image model is sent: the picture, then a short style line.
 *
 * This once appended the whole rule set. Measured on a real brief, the result
 * was 2,088 characters of which 269 described the picture — 13%. The rest was
 * instruction written for the model that WRITES the prompt, handed to the model
 * that draws it, where it is not reasoning but text to represent. On an editing
 * endpoint it is worse: a wall of description competes with the attached
 * photograph and the model generates from the words instead of working from the
 * image, which is exactly the failure this whole file exists to fix.
 *
 * So the rules stay with Claude, and this stays short. The instruction to match
 * the photograph comes last, because last is what gets read.
 */
export const finishImagePrompt = (written: string): string =>
  `${written.trim()}\n\nPhotograph. Natural available light, real materials and surfaces, ordinary untidiness. Not an illustration, not a render, not a stock pose. No readable text or logos. Match the attached photograph: the same kind of subject, setting and light. If there are no people in it, there are none in this one. Do not copy it.`;
