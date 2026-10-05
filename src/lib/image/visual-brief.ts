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
 *
 * One choice came back (5 Oct 2026): photograph or illustration, per image,
 * made by the brief from what the article is about. An article about an idea
 * or a workflow has no single thing to photograph, and every one of them had
 * been answered with the same desk.
 */

/** What the finished image is: a real scene photographed, or an idea drawn by an illustrator. */
export const IMAGE_DIRECTION = {
  name: "Grounded Editorial",
  summary:
    "A real scene from the creative-studio world the article describes, photographed; or, when the subject is an idea rather than a thing, drawn by an editorial illustrator.",
} as const;

/** How one image is made. Chosen per image by the brief. */
export type ImageMedium = "photograph" | "illustration";
export const IMAGE_MEDIUMS: readonly ImageMedium[] = ["photograph", "illustration"];

/**
 * The rules the prompt writer works to.
 *
 * Lines, not paragraphs. These reach Claude, never the image model —
 * see `finishImagePrompt` for what the image model is actually sent, and why
 * the difference matters.
 *
 * NO PROPS NAMED AS EXAMPLES. The rules once asked for "a cooling coffee, a
 * cable half-coiled" and "ordinary untidiness", and the photo search was shown
 * "designer working at desk laptop". Every cover then came back with the same
 * wooden table and the same coffee ring (5 Oct 2026): an example in a prompt
 * is read as an instruction. The props are now named only to be banned.
 */
export const IMAGE_RULES = [
  "THE REFERENCE DECIDES WHAT IS IN FRAME. If it shows no people, yours shows none. An abstract or graphic reference means an abstract or graphic image — a printed layout, an arrangement of made things, a surface, a space. Do not add a person to a picture that had none. Take its SUBJECT from the reference, not its furniture: its table, its mug, its window are not the point.",
  "Show the real subject the article is about, whatever kind of thing that is: people at work, made things, printed material, a screen, a wall, a room, a street.",
  "THE WORLD IS THE CREATIVE STUDIO, AND IT IS WIDE. A pin-up wall of printed work under review, a press check with proofs and a loupe, colour and material samples, type specimens, packaging prototypes and cut-and-folded mock-ups, model-making, a photo or film set mid-shoot, a screen showing the work itself, the finished work out in the world — signage on a building, posters on a street, packaging on a shelf, a site on a phone in someone's hand. Vary the setting: a wall, a floor, a print shop, a street, a hand holding the work. Not a table seen from above every time.",
  "THE SAME PROPS EVERY TIME IS THE AI TELL. Never as filler: wooden tables or desk tops, coffee cups, mugs and their rings or stains, notebooks and pens, potted plants, scattered papers, a laptop at an angle, cables, glasses, a warm window glow. Use one only when the article is about that very thing. One or two details that belong to THIS subject — its tool, its material, its proof — say more than any amount of clutter.",
  "None of the stock and AI tells: hands hovering over a keyboard, a face lit by a glowing screen, walls of sticky notes, lightbulbs, brains, rockets, puzzle pieces, gears, holograms, robots, floating interface panels, flawless skin, a product centred on a seamless backdrop.",
  "When the article is about a made thing — a typeface, an identity, a book, a product, a building, an interface — show the thing itself, close enough to see what it is made of: paper stock, ink, print, stitching, screen pixels, wear.",
  "PHOTOGRAPH OR ILLUSTRATION, chosen per image. A photograph when the article is about something that exists to be photographed: a specific made thing, a place, an event, people doing a particular piece of work. An illustration when it is about an idea, a method, a trend, a comparison, an opinion, or a workflow that has no single thing to point a camera at.",
  "A PHOTOGRAPH is documentary and editorial: shot on location, as found, not arranged for the camera. Brief it the way a photographer would: where the camera stands, how close, how long the lens, where the light comes from. Real colour, not a cinematic grade; not every picture in shallow focus; no golden-hour glow by default; nothing surreal, floating or impossible.",
  "AN ILLUSTRATION is drawn by a human editorial illustrator for a design magazine: one clear, specific idea taken from the article — never a stock symbol; a limited palette of two to four colours; a visible hand — risograph grain, screen-print overlap, gouache, pencil, cut paper or collage; simple confident shapes. Not 3D, not a glossy vector, not gradients, not isometric clip art, not stock vector people, not anime or a children's book. Brief it as an art director briefs an illustrator: the idea, what is drawn, the technique, the palette.",
  "The colours the subject would really have, or the illustration's own limited palette. No neon, no gradient backdrop, no teal-and-orange grade, and never the publisher's house colours.",
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
   * What this article's image should show — a real moment for a photograph,
   * one clear idea for an illustration — with the same KIND of subject as the
   * reference. If the reference has no people in it, this must not put any in.
   */
  scene: string;
  /** Whether `scene` is photographed or drawn. */
  medium: ImageMedium;
  /** Other scenes from the same world, one per extra variation, each with its own medium. */
  alternateScenes: { scene: string; medium: ImageMedium }[];
  /**
   * Three to six words to search a stock library with, describing the
   * situation: "designer working at desk laptop". Not the topic — the picture.
   */
  photoQuery: string;
};

/** One image prompt and the scene it shows. */
export type ImagePromptVariant = {
  scene: string;
  medium: ImageMedium;
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
 * So the rules stay with Claude, and this stays short. The instruction about
 * the photograph comes last, because last is what gets read — and it asks for
 * its SUBJECT only: matching its "setting and light" carried the reference's
 * desk and mug into every picture made from it.
 *
 * It used to say "Not an illustration" whatever the brief chose, which is why
 * none was ever made. The style line now follows the medium.
 */
export const finishImagePrompt = (
  written: string,
  medium: ImageMedium = "photograph",
  hasReference = true,
): string => {
  const style =
    medium === "illustration"
      ? "Editorial illustration, drawn by hand: a limited palette, visible print or paper texture, simple confident shapes. Not a photograph, not 3D, not a glossy vector, not clip art. No readable text, letters or logos."
      : "Documentary photograph: available light, real materials and colour, shot as found. Not a render, not a stock pose. No readable text or logos.";
  const reference = !hasReference
    ? ""
    : medium === "illustration"
      ? " Take only the subject from the attached image, not its look. If there are no people in it, there are none in this one."
      : " Match the attached photograph in subject only, not its setting or props. If there are no people in it, there are none in this one. Do not copy it.";
  return `${written.trim()}\n\n${style}${reference}`;
};
