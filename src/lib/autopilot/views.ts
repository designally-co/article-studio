import type { RoutineHubStatus, RoutineRunStatus, RoutineStep } from "@/db/schema";
import type { RoutineScheduleKind } from "@/lib/autopilot/schedule";

/**
 * What the Routines page draws.
 *
 * A plain module with no directive, because these shapes are read by client
 * components and produced by server ones — the one arrangement that cannot
 * break (see AGENTS.md). Dates are ISO strings: a Date crossing the server
 * boundary is fine, but a string is unambiguous and formats where the reader is.
 */
export type RoutineView = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  categoryId: string | null;
  /** Null means it rotates through every active direction. */
  directionName: string | null;
  hubStatus: RoutineHubStatus;
  imagesPerRun: number;
  /** Null means the cover rotates through `RATIO_ROTATION`. */
  imageAspectRatio: string | null;
  scheduleKind: RoutineScheduleKind;
  runAt: string;
  timeZone: string;
  weekday: number;
  dayOfMonth: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
};

/**
 * The shapes a routine may generate its cover at.
 *
 * Every one of these is a ratio every configured image provider accepts (see
 * `IMAGE_ASPECT_RATIOS` in `src/lib/image/providers.ts`, which is the server's
 * list and the one that is actually enforced). This copy exists because the
 * form that offers them is a client component and that module is server-only.
 *
 * Named, not just numbered. "4:5" is a fact about a rectangle; "Portrait" is
 * what the person choosing it is actually deciding.
 */
export const ROUTINE_IMAGE_RATIOS: { value: string; label: string }[] = [
  { value: "16:9", label: "Wide (16:9)" },
  { value: "3:2", label: "Landscape (3:2)" },
  { value: "1:1", label: "Square (1:1)" },
  { value: "4:5", label: "Portrait (4:5)" },
  { value: "2:3", label: "Tall (2:3)" },
  { value: "9:16", label: "Story (9:16)" },
];

/**
 * What a routine rotates through when no ratio is pinned.
 *
 * FOUR OF THE SIX, AND THE TWO LEFT OUT ARE LEFT OUT ON PURPOSE. 9:16 and 2:3
 * are phone-screen shapes: as the lead image of an article they push the first
 * paragraph off the bottom of the window. They stay available as a deliberate
 * choice and stay out of the shape a schedule reaches for by itself.
 *
 * The order is the rotation order, and it alternates rather than drifting —
 * wide, classic, portrait, square — so two runs in a row never look alike.
 */
const RATIO_ROTATION = ["16:9", "3:2", "4:5", "1:1"] as const;

/**
 * The ratio one run generates at: the pinned one, or the next in rotation.
 *
 * `index` is how many articles this routine has already produced, so the shape
 * advances with the schedule rather than with the clock.
 */
export function rotateAspectRatio(pinned: string | null, index: number): string {
  if (pinned && ROUTINE_IMAGE_RATIOS.some((ratio) => ratio.value === pinned)) return pinned;
  const safe = Math.abs(Math.floor(index)) % RATIO_ROTATION.length;
  return RATIO_ROTATION[safe];
}

export type RunView = {
  id: string;
  routineId: string;
  projectId: string | null;
  step: RoutineStep;
  status: RoutineRunStatus;
  error: string | null;
  startedAt: string;
  title: string;
  hubUrl: string | null;
};

/**
 * The seven steps, in order, in words rather than in the state machine's own
 * vocabulary. A person watching a run wants to know what is happening, not
 * which case of a switch statement is executing.
 */
export const STEP_ORDER: RoutineStep[] = [
  "topic",
  "plan",
  "draft",
  "prompt",
  "reference",
  "images",
  "publish",
];

export const STEP_LABELS: Record<RoutineStep, string> = {
  topic: "Choosing a topic",
  plan: "Researching",
  draft: "Writing the article",
  prompt: "Writing the image brief",
  reference: "Finding a photograph",
  images: "Making the cover",
  publish: "Sending to the Hub",
  done: "Finished",
};

/** 1-based position for "step 3 of 7"; 7 once it is done. */
export function stepNumber(step: RoutineStep): number {
  const index = STEP_ORDER.indexOf(step);
  return index === -1 ? STEP_ORDER.length : index + 1;
}
