/**
 * Image routing for the proposed article direction (preview only).
 *
 * TYPE picks the route, PILLAR picks the style, the ARTICLE says what to show.
 * This module holds the first two as data, so the prompts, the editor's block
 * cards, the server actions and the autopilot all read one table, and a route
 * a type forbids is refused in code rather than only discouraged in a prompt.
 *
 * Plain module, no imports beyond its siblings, so it is testable with
 * `node --test` and safe to import from a client component.
 */
import type { LabelPillar, LabelType } from "./labels";

/** How a body image block is filled. */
export const BLOCK_ROUTES = ["find", "generate", "draw", "upload"] as const;
export type BlockRoute = (typeof BLOCK_ROUTES)[number];

/** What a body image is for. */
export const BLOCK_ROLES = ["evidence", "step", "diagram", "preview", "mood"] as const;
export type BlockRole = (typeof BLOCK_ROLES)[number];

/** Who may use an image. "unknown" and "permission_pending" hold an article as a Hub draft. */
export const RIGHTS = ["own", "licensed", "permission_pending", "unknown"] as const;
export type Rights = (typeof RIGHTS)[number];

/** Rights that keep an article from being published live. */
export const RIGHTS_HOLD_AS_DRAFT: readonly Rights[] = ["unknown", "permission_pending"];

/** Where a cover may come from, in the order tried. */
export type CoverSource = "cited_pages" | "library" | "generate";

/** A hard ceiling on body image blocks, whatever the type allows. Cover excluded. */
export const MAX_BODY_BLOCKS = 3;

export type TypeImagePolicy = {
  cover: {
    /** Tried in this order. A source not listed is never used for this type. */
    sources: readonly CoverSource[];
    /** What the cover should be, in a sentence for prompts and the editor. */
    note: string;
  };
  body: {
    /** At least this many body blocks the draft should place. */
    min: number;
    /** At most this many; never more than MAX_BODY_BLOCKS. */
    max: number;
    /** The roles a block may carry for this type. */
    roles: readonly BlockRole[];
    /** The routes the draft suggests for a block, first is the default. */
    routes: readonly BlockRoute[];
    /**
     * Further routes an editor may switch a block to. The proposal's table never
     * places a generated body image, so Generate is offered only here, and only
     * where the type does not forbid it: never for a case study (real images
     * only), never for steps or resources (a generated picture cannot show the
     * real step or the real resource). Upload is always allowed besides.
     */
    editorRoutes: readonly BlockRoute[];
    /** Where Find may look, in order. */
    find: readonly ("cited_pages" | "library")[];
    note: string;
  };
};

/**
 * Route by type, from the proposal:
 *   case_study     cover + 2–3 body: real project images from cited studio/project pages ONLY.
 *   news           cover: official image from the source page, else a generated concept cover. Body: none.
 *   tutorial       cover: current cover system. Body: 1–3 drawn step figures.
 *   explanation    cover: current cover system. Body: 1 drawn diagram.
 *   commentary     cover: generated or found mood image. Body: none.
 *   resources      cover: current cover system. Body: previews/screenshots of the actual resources.
 *   business_guide cover: current cover system. Body: optional 1 drawn comparison.
 */
export const TYPE_IMAGE_POLICY: Record<LabelType, TypeImagePolicy> = {
  case_study: {
    cover: {
      sources: ["cited_pages"],
      note: "A real project image from the cited studio or project page. Never generated, never stock. If none is found, a person supplies it.",
    },
    body: {
      min: 2,
      max: 3,
      roles: ["evidence"],
      routes: ["find", "upload"],
      editorRoutes: [],
      find: ["cited_pages"],
      note: "2 to 3 real project images from the cited studio or project pages only, credited \"courtesy of\". Never generated, never stock. If none is found, the block stays empty for a person.",
    },
  },
  news: {
    cover: {
      sources: ["cited_pages", "generate"],
      note: "The official announcement image from the source page; otherwise a generated concept cover.",
    },
    body: { min: 0, max: 0, roles: [], routes: [], editorRoutes: [], find: [], note: "No body images." },
  },
  tutorial: {
    cover: { sources: ["cited_pages", "library", "generate"], note: "The current cover system." },
    body: {
      min: 1,
      max: 3,
      roles: ["step"],
      routes: ["draw", "upload"],
      editorRoutes: [],
      find: [],
      note: "1 to 3 drawn step figures, each showing one step of the task.",
    },
  },
  explanation: {
    cover: { sources: ["cited_pages", "library", "generate"], note: "The current cover system." },
    body: {
      min: 1,
      max: 1,
      roles: ["diagram"],
      routes: ["draw", "upload"],
      editorRoutes: ["generate"],
      find: [],
      note: "1 drawn diagram of the idea being explained.",
    },
  },
  commentary: {
    cover: { sources: ["library", "generate"], note: "A generated or found mood image." },
    body: { min: 0, max: 0, roles: [], routes: [], editorRoutes: [], find: [], note: "No body images." },
  },
  resources: {
    cover: { sources: ["cited_pages", "library", "generate"], note: "The current cover system." },
    body: {
      min: 1,
      max: 3,
      roles: ["preview"],
      routes: ["find", "upload"],
      editorRoutes: [],
      find: ["cited_pages"],
      note: "Previews or screenshots of the actual resources, from their own pages.",
    },
  },
  business_guide: {
    cover: { sources: ["cited_pages", "library", "generate"], note: "The current cover system." },
    body: {
      min: 0,
      max: 1,
      roles: ["diagram"],
      routes: ["draw", "upload"],
      editorRoutes: ["generate"],
      find: [],
      note: "Optional: 1 drawn comparison.",
    },
  },
};

/** The routes allowed for a block on an article of this type. Upload is always among them (none for a type without body images). */
export function allowedRoutes(type: LabelType): BlockRoute[] {
  const body = TYPE_IMAGE_POLICY[type].body;
  if (body.max === 0) return [];
  const routes = new Set<BlockRoute>([...body.routes, ...body.editorRoutes]);
  routes.add("upload");
  return BLOCK_ROUTES.filter((route) => routes.has(route));
}

export function isRouteAllowed(type: LabelType, route: BlockRoute): boolean {
  return allowedRoutes(type).includes(route);
}

/** The route a block starts on: its own suggestion when allowed, else the type's first. */
export function effectiveRoute(type: LabelType, suggested: BlockRoute | null | undefined): BlockRoute {
  // The draft may only suggest the table's own routes; Generate is an editor's choice.
  if (suggested && TYPE_IMAGE_POLICY[type].body.routes.includes(suggested)) return suggested;
  if (suggested === "upload") return "upload";
  return TYPE_IMAGE_POLICY[type].body.routes[0] ?? "upload";
}

export function isCoverSourceAllowed(type: LabelType, source: CoverSource): boolean {
  return TYPE_IMAGE_POLICY[type].cover.sources.includes(source);
}

/**
 * Routes an unattended routine may fill on its own. Find blocks wait for a
 * person, and an article with an empty block is held as a Hub draft.
 */
export const AUTO_FILL_ROUTES: readonly BlockRoute[] = ["generate", "draw"];

/** Style by pillar. Fed into the visual brief and every image prompt. */
export type PillarImageStyle = {
  name: string;
  summary: string;
  /** Replaces the "the world is the creative studio" rule for this pillar. */
  worldRule: string;
  /** What a judge must turn down for this pillar. */
  reject: string[];
};

export const PILLAR_IMAGE_STYLE: Record<LabelPillar, PillarImageStyle> = {
  creative_insights: {
    name: "Grounded Editorial",
    summary:
      "The current editorial look: a real scene from the creative-studio world the article describes, photographed; or, when the subject is an idea, drawn by an editorial illustrator.",
    worldRule:
      "THE WORLD IS THE CREATIVE STUDIO, AND IT IS WIDE. A pin-up wall of printed work under review, a press check with proofs and a loupe, colour and material samples, type specimens, packaging prototypes, a photo or film set mid-shoot, a screen showing the work itself, the finished work out in the world. Vary the setting.",
    reject: [],
  },
  all_things_ai: {
    name: "Honest AI",
    summary:
      "The AI task, tool or outcome shown honestly: what the tool actually produced, the real input and output, or the person's real task. No studio scenes, no fake interfaces.",
    worldRule:
      "SHOW THE AI TASK, TOOL OR OUTCOME HONESTLY. The real output a tool produced, the material it was given, the decision a person makes with it. Never a staged design studio, never a designer posed at a desk, never an invented interface, chat window or dashboard.",
    reject: [
      "a design-studio scene or a designer posed at a desk, when the article is about AI",
      "an invented or fake interface, chat window, dashboard or screen",
      "glowing brains, robots, holograms and other AI clichés",
    ],
  },
  case_studies: {
    name: "The Work Itself",
    summary: "The real work itself, as the studio photographed it, credited \"courtesy of\" the studio.",
    worldRule:
      "ONLY THE REAL WORK. The project as the studio that made it photographed it: the identity applied, the packaging, the site, the spread. Nothing staged, nothing generated, nothing from a stock library.",
    reject: [
      "a stock photograph",
      "anything that is not the named project itself",
      "a generated or illustrated stand-in for the work",
    ],
  },
  guides_workflows: {
    name: "The Task Being Done",
    summary: "The real task or the result being made: the step, the material, the outcome a reader will produce.",
    worldRule:
      "SHOW THE REAL TASK OR ITS RESULT. The thing being made at this step, the material it is made from, the result a reader will end up with. Not a generic studio mood.",
    reject: [
      "a generic studio mood picture that does not show the task or its result",
      "a picture that does not show the step it sits beside",
    ],
  },
};

/** What a block's role asks of a picture, for the judges. */
export const ROLE_REQUIREMENT: Record<BlockRole, string> = {
  evidence: "It must show the named project or thing itself, as its makers published it.",
  step: "It must show this exact step of the task. A picture that does not show the step is rejected.",
  diagram: "It must make the idea's structure visible: parts, order or comparison.",
  preview: "It must show the actual resource named: its page, its file, its specimen.",
  mood: "It must carry the article's subject and tone without pretending to document it.",
};

/**
 * What the image judges are told about the picture they are judging for (the
 * proposed direction only). Without it they judged every picture against a
 * creative-studio cover, and a studio photograph passed for AI news.
 */
export type ImageFit = {
  pillar: LabelPillar;
  type: LabelType;
  /** The block's role, or "cover". */
  role: BlockRole | "cover";
  /** What the reader should understand from the picture. */
  purpose?: string;
  /** The specific subject: the project, tool or resource by name. */
  subject?: string;
  /** Topic and keywords, to narrow results only. */
  narrowers?: string[];
};

/**
 * The honest rights state of a picture by where it came from. A cited page's
 * picture belongs to its publisher: permission is pending until a person says
 * otherwise. A person's upload is unknown until they say whose it is.
 */
export function rightsForOrigin(origin: "upload" | "article_source" | "open_license"): Rights {
  if (origin === "open_license") return "licensed";
  if (origin === "article_source") return "permission_pending";
  return "unknown";
}
