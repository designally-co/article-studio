import "server-only";
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { categories, projects, routineRuns, routines } from "@/db/schema";
import type {
  ProjectInputs,
  Routine,
  RoutineRunStatus,
  RoutineRunTrigger,
  RoutineStep,
} from "@/db/schema";
import { nextRunAt } from "@/lib/autopilot/schedule";
import { rotateAspectRatio } from "@/lib/autopilot/views";
import { IMAGE_ASPECT_RATIOS, type ImageAspectRatio } from "@/lib/image/providers";
import { generateTopicIdeas } from "@/lib/pipeline/topics";
import { preparePlanCore } from "@/lib/pipeline/plan";
import { generateDraftCore } from "@/lib/pipeline/draft";
import { generateImagePromptCore } from "@/lib/pipeline/image-prompt";
import { findReferenceImagesCore, generateImagesCore } from "@/lib/pipeline/images";
import { publishToHubCore } from "@/lib/pipeline/publish";
import { imageGenerationOptions } from "@/lib/image/registry";
import { isHubConfigured } from "@/lib/hub";
import { isAnthropicConfigured } from "@/lib/anthropic";

/**
 * The autopilot: one article, written and published without an editor.
 *
 * The shape of this file is decided by one constraint. A full article is five
 * model-and-provider steps taking two to three minutes, and a serverless
 * function gets sixty seconds. So the run cannot be a loop — it is a state
 * machine whose position lives in the database, advanced ONE step per request
 * by whatever pokes the endpoint. That is also what makes a crashed run
 * resumable rather than lost: the row still says where it got to.
 *
 * Each step is one of the same functions an editor's click calls, imported from
 * `@/lib/pipeline/*`. Nothing here re-implements generation. If the manual
 * pipeline changes, the autopilot changes with it, which is the only way two
 * paths to the same artefact stay honest about each other.
 */

/** Not the function's own ceiling — the caller's, less room to record the outcome. */
const STEP_BUDGET_MS = 50_000;

/**
 * The most one step is given before it is called off.
 *
 * WITHOUT THIS THE PLATFORM DOES THE KILLING, AND THAT IS THE WORST OUTCOME.
 * A Vercel function is terminated at 60 seconds with a 504 and no code of ours
 * runs afterwards — so the attempt goes unrecorded, the claim quietly expires,
 * and the same over-long step is retried on the next poke, and the next, for
 * as long as the schedule lives. Calling it off ourselves means the run is
 * marked, counted, and eventually stopped with a message a person can read.
 */
const STEP_DEADLINE_MS = 45_000;

/**
 * Room the loop wants before it begins ANOTHER step in the same poke.
 *
 * The first version asked only whether the budget had run out, which is the
 * wrong question: at 30 seconds spent there is time left, but not enough for a
 * draft, and starting one there is what produced a 504. Steps are not
 * interchangeable — a topic takes ten seconds and a draft can take fifty — so
 * the loop now refuses to start one unless a slow one would still fit.
 */
const STEP_ROOM_MS = 45_000;

/**
 * How long a claimed run is off-limits to another worker.
 *
 * Longer than any single step, so two pokes arriving together cannot both
 * advance the same run. Short enough that a worker killed mid-step releases it
 * by expiry rather than wedging it forever — which is why this is a timestamp
 * and not a boolean.
 */
const CLAIM_MS = 3 * 60_000;

/** After this many failures at the same step, stop and leave the error visible. */
const MAX_ATTEMPTS = 3;

/**
 * How many times a day the autopilot may fail to even begin an article before
 * it stops trying. A start that fails costs a topic request and nothing else,
 * so a few retries are worth having when a provider is briefly unwell; a poke
 * every ten minutes all day is not.
 */
const FAILED_STARTS_PER_DAY = 5;

export type TickReport = {
  started: number;
  advanced: { runId: string; from: RoutineStep; to: RoutineStep | "failed" }[];
  idle: boolean;
  note?: string;
};

/** The single schedule, created on first use so there is nothing to set up. */
/** Every routine, oldest first — the order the Routines page lists them in. */
export async function listRoutines(): Promise<Routine[]> {
  const db = await getDb();
  return db.select().from(routines).orderBy(asc(routines.createdAt));
}

export async function getRoutineById(id: string): Promise<Routine | null> {
  const db = await getDb();
  const [row] = await db.select().from(routines).where(eq(routines.id, id)).limit(1);
  return row ?? null;
}

/**
 * Routines that are switched on and past their next run.
 *
 * A routine with no `next_run_at` is never due — that is how `manual` is stored
 * and how a routine that has just been switched off stays quiet.
 */
async function dueRoutines(): Promise<Routine[]> {
  const db = await getDb();
  return db
    .select()
    .from(routines)
    .where(
      and(eq(routines.enabled, true), isNotNull(routines.nextRunAt), lte(routines.nextRunAt, new Date()))
    )
    .orderBy(asc(routines.nextRunAt));
}

/**
 * Move a routine's clock forward.
 *
 * Always from NOW rather than from the run it just missed: a routine switched
 * back on after a week should write one article, not seven.
 */
export async function rescheduleRoutine(routine: Routine): Promise<Date | null> {
  const db = await getDb();
  const next = routine.enabled
    ? nextRunAt({
        kind: routine.scheduleKind,
        runAt: routine.runAt,
        timeZone: routine.timeZone,
        weekday: routine.weekday,
        dayOfMonth: routine.dayOfMonth,
      })
    : null;
  await db
    .update(routines)
    .set({ nextRunAt: next, updatedAt: new Date() })
    .where(eq(routines.id, routine.id));
  return next;
}

/** Midnight UTC — the line both of the day's counts are drawn from. */
function startOfDay(): Date {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  return since;
}

/**
 * Is this routine already writing something?
 *
 * WHAT REPLACED THE DAILY CEILING. `maxPerDay` was a count of articles opened
 * since UTC midnight, and it answered the wrong question: it said no to a
 * routine its owner had just asked to run, on the grounds that an earlier one
 * had already happened. A schedule is an instruction, and the answer to "run at
 * half past twelve" is an article at half past twelve.
 *
 * The runaway it was really guarding against is narrower, and this is the shape
 * of it: the clock moves after a start succeeds, so a worker killed in that gap
 * leaves the routine still due — and the next tick would open a second article
 * on top of the first. Asking whether one is already in flight refuses exactly
 * that, and refuses nothing a person asked for.
 */
async function isWriting(routineId: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ id: routineRuns.id })
    .from(routineRuns)
    .where(
      and(
        eq(routineRuns.routineId, routineId),
        eq(routineRuns.status, "running"),
        /* The schedule's own work only. A manual run in flight is somebody
           watching an article being written; it does not stand in for the
           scheduled one, and letting it block the schedule would put back the
           very thing the ceiling used to do. */
        eq(routineRuns.trigger, "schedule")
      )
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Every article this routine opened today, however it was started.
 *
 * Turns the direction rotation, which wants to know how many articles exist so
 * that the next one is about something else.
 */
async function articlesToday(routineId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(routineRuns)
    .where(
      and(
        eq(routineRuns.routineId, routineId),
        gte(routineRuns.startedAt, startOfDay()),
        isNotNull(routineRuns.projectId)
      )
    );
  return row?.n ?? 0;
}

/**
 * Every article this routine has EVER opened.
 *
 * All time, not today, because that is what the cover-shape rotation needs.
 * `articlesToday` resets at midnight, so a once-a-day routine asked it the
 * same question every morning and always got 0 — an index that never moves is
 * not a rotation. Counted at the moment the run starts and written onto the
 * article, so a retried image step reuses the shape rather than picking a new
 * one.
 */
async function articlesEver(routineId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(routineRuns)
    .where(and(eq(routineRuns.routineId, routineId), isNotNull(routineRuns.projectId)));
  return row?.n ?? 0;
}

/**
 * Starts that failed before an article existed, today.
 *
 * `status = 'failed'` as well as the missing project, and both halves earn
 * their place. Without the project test a run that failed at publishing —
 * having written the whole article — would count against a ceiling meant for
 * runs that cost a topic request and nothing else. Without the status test
 * every projectless row counts, and since a skipped slot is stored as one of
 * those, three skips would have spent most of a ceiling that exists for
 * provider trouble.
 */
async function failedStartsToday(routineId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(routineRuns)
    .where(
      and(
        eq(routineRuns.routineId, routineId),
        gte(routineRuns.startedAt, startOfDay()),
        eq(routineRuns.status, "failed"),
        isNull(routineRuns.projectId)
      )
    );
  return row?.n ?? 0;
}

/**
 * Take exclusive hold of ONE unfinished run.
 *
 * Written as raw SQL because the shape matters and an ORM update cannot express
 * it. `UPDATE ... WHERE status = 'running'` has no row limit — it would claim
 * every run in flight at once, lock them all for the claim window, and then
 * advance exactly one. The rest would sit untouched until the lock expired.
 *
 * So the row is chosen by a subquery with `LIMIT 1`, and `FOR UPDATE SKIP
 * LOCKED` is what makes two workers arriving together take different rows
 * instead of queueing behind the same one. `locked_until` still earns its place
 * on top of that: the row lock lasts only as long as the transaction, while the
 * claim has to outlive it and survive a worker that dies mid-step — which it
 * does by expiring rather than by needing cleanup.
 */
async function claimRun(onlyRunId?: string) {
  const db = await getDb();
  const claimMs = CLAIM_MS;
  /* `onlyRunId` is how the Routines page takes the run it is watching rather
     than whichever is oldest. Same claim, same lock, narrower target. */
  const target = onlyRunId ?? null;
  const result = await db.execute(sql`
    update routine_runs set
      -- COUNTED HERE, NOT ON FAILURE. A step killed by the platform never
      -- reaches our error handler, so an attempt counted at the end is an
      -- attempt never counted at all — and a run that cannot record failure
      -- cannot be stopped by MAX_ATTEMPTS either. Taking the row is the one
      -- moment that always happens, so it is the moment that counts.
      attempts = attempts + 1,
      locked_until = now() + (${claimMs} || ' milliseconds')::interval,
      updated_at = now()
    where id = (
      select id from routine_runs
      where status = 'running'
        and (locked_until is null or locked_until < now())
        and (${target}::uuid is null or id = ${target}::uuid)
      order by started_at asc
      limit 1
      for update skip locked
    )
    returning *
  `);
  // postgres-js returns the rows directly; PGlite wraps them in `.rows`.
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows) ?? [];
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  // Raw SQL returns snake_case; the rest of this file speaks the schema's names.
  return {
    id: String(row.id),
    routineId: String(row.routine_id),
    projectId: row.project_id ? String(row.project_id) : null,
    step: row.step as RoutineStep,
    // Post-increment: this claim is already included.
    attempts: Number(row.attempts ?? 1),
  };
}

/** The direction this run writes about — the chosen one, or the next in rotation. */
async function pickCategory(routineCategoryId: string | null, runCount: number) {
  const db = await getDb();
  if (routineCategoryId) {
    const [row] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, routineCategoryId), eq(categories.active, true)))
      .limit(1);
    if (row) return row;
  }
  const active = await db
    .select()
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  if (active.length === 0) return null;
  // Rotate rather than repeat: an unattended schedule pointed at one direction
  // publishes the same corner of the territory every day.
  return active[runCount % active.length];
}

/**
 * Begin a run: choose a direction, ask for topics, and open a project on the
 * first one. Creating the project here rather than in the `topic` step keeps
 * every later step addressable by `projectId` alone.
 */
async function startRun(routine: Routine, trigger: RoutineRunTrigger = "schedule") {
  const db = await getDb();
  const total = await articlesToday(routine.id);
  const category = await pickCategory(routine.categoryId, total);
  if (!category) throw new Error("No active content direction to write about.");

  const ideas = await generateTopicIdeas({
    categoryId: category.id,
    categoryName: category.name,
    language: "en",
  });
  const idea = ideas[0];
  if (!idea) throw new Error("No topic idea came back for this direction.");

  const inputs: ProjectInputs = {
    articleMode: "editorial",
    editorialFormat: "explainer",
    editorialReader: "Designers and creative teams",
    editorialEntryCount: 10,
    /* DECIDED HERE, NOT AT THE IMAGE STEP, and written down with the article.
       The image step runs three pokes later and can be retried twice more; a
       rotation computed there would move under a run that merely failed to
       reach a provider, and the same article would come back a different
       shape each attempt. One decision, recorded, is also the one an editor
       opening the pipeline can see. */
    imageAspectRatio: rotateAspectRatio(routine.imageAspectRatio, await articlesEver(routine.id)),
  };
  const [project] = await db
    .insert(projects)
    .values({
      categoryId: idea.directionId || category.id,
      language: "en",
      status: "draft",
      stage: 3,
      inputs,
      selectedTopic: {
        title: idea.title,
        angle: idea.angle,
        whyTimely: idea.whyTimely,
        searchIntent: idea.searchIntent,
        researchSources: idea.researchSources,
        source: "suggested",
      },
      createdBy: routine.createdBy,
    })
    .returning();

  const [run] = await db
    .insert(routineRuns)
    .values({ routineId: routine.id, projectId: project.id, step: "plan", status: "running", trigger })
    .returning();
  await db.update(routines).set({ lastRunAt: new Date() }).where(eq(routines.id, routine.id));
  return run;
}

/** Generate one image and leave it on the project for publishing to pick up. */
/**
 * Read and write the image work a run carries between pokes.
 *
 * The manual stage keeps this in the browser between pressing Find and pressing
 * Generate. There is no browser here, so it goes on the project.
 */
async function readImageWork(projectId: string) {
  const db = await getDb();
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) throw new Error("Project not found");
  return { inputs: row.inputs, work: row.inputs.autopilotImage };
}

async function writeImageWork(
  projectId: string,
  patch: Partial<NonNullable<ProjectInputs["autopilotImage"]>>
) {
  const db = await getDb();
  const { inputs, work } = await readImageWork(projectId);
  await db
    .update(projects)
    .set({
      inputs: {
        ...inputs,
        autopilotImage: { prompt: "", variantPrompts: [], ...work, ...patch },
      },
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));
}

/**
 * Step one of three: write the prompt, before any photograph exists.
 *
 * The brief this produces is also what says WHAT TO SEARCH FOR — the scene the
 * article describes, not its subject — so the search cannot come first.
 */
async function runPromptStep(projectId: string, count: number) {
  const drafted = await generateImagePromptCore(projectId, { variationCount: count });
  await writeImageWork(projectId, {
    prompt: drafted.prompt,
    variantPrompts: drafted.variants.map((variant) => variant.prompt),
    photoQuery: drafted.brief.photoQuery,
    referenceId: undefined,
    optionId: undefined,
  });
}

/**
 * Step two: find the photograph, then write the prompt again having seen it.
 *
 * The second draft is the point of the whole exercise. Without it "match the
 * reference" is an instruction with nothing behind it — the writer knows a
 * photograph exists but not what is in it, and invents a scene from the article
 * instead. A run with no usable photograph keeps the first draft and says so by
 * leaving `referenceId` unset.
 */
async function runReferenceStep(projectId: string, count: number) {
  const options = await imageGenerationOptions();
  if (options.length === 0) return;
  const { work } = await readImageWork(projectId);
  const found = await findReferenceImagesCore(projectId, {
    query: work?.photoQuery ?? "",
    /* One photograph. The run only ever sends the first, and every one kept is
       a full-size download inside a step with a deadline. The search ranks best
       first, so the one kept is the closest. */
    limit: 1,
  });
  const reference = found.references[0];
  const option = (reference && options.find((o) => o.capabilities.referenceImages)) ?? options[0];
  if (!reference || !option.capabilities.referenceImages) {
    await writeImageWork(projectId, { optionId: option.optionId });
    return;
  }
  const finalPrompt = await generateImagePromptCore(projectId, {
    variationCount: count,
    referenceId: reference.id,
  });
  await writeImageWork(projectId, {
    prompt: finalPrompt.prompt,
    variantPrompts: finalPrompt.variants.map((variant) => variant.prompt),
    referenceId: reference.id,
    optionId: option.optionId,
  });
}

/**
 * The shape to generate at, narrowed to one this model will actually accept.
 *
 * `generateImagesCore` REJECTS a ratio outside the model's capabilities rather
 * than nudging it, and that rejection would land three pokes into a finished
 * article. Every provider configured today offers all six, so this only bites
 * when a new one does not — and then the run should publish a picture of a
 * slightly different shape, not no picture at all.
 *
 * 16:9 is the fallback because it is what every routine generated before the
 * shape was a setting.
 */
function supportedRatio(
  wanted: string | undefined,
  allowed: readonly ImageAspectRatio[]
): ImageAspectRatio {
  const named = IMAGE_ASPECT_RATIOS.find((ratio) => ratio === wanted);
  if (named && allowed.includes(named)) return named;
  if (allowed.includes("16:9")) return "16:9";
  return allowed[0] ?? "1:1";
}

/** Step three: make the picture, and say which one is the cover. */
async function runImageStep(projectId: string, count: number) {
  const options = await imageGenerationOptions();
  if (options.length === 0) {
    // Not fatal. An article without a cover is still an article, and stopping
    // the whole run over a missing Fal key would be the wrong trade.
    return;
  }
  const { inputs, work } = await readImageWork(projectId);
  if (!work?.prompt) throw new Error("No image prompt was written for this article.");
  const option = options.find((o) => o.optionId === work.optionId) ?? options[0];
  const useReference = Boolean(work.referenceId) && option.capabilities.referenceImages;

  const run = await generateImagesCore(projectId, {
    prompt: work.prompt,
    optionId: option.optionId,
    aspectRatio: supportedRatio(inputs.imageAspectRatio, option.capabilities.aspectRatios),
    variationCount: Math.max(1, Math.min(count, option.capabilities.maxVariations)),
    referenceIds: useReference && work.referenceId ? [work.referenceId] : [],
    variantPrompts: work.variantPrompts,
  });

  /* Say which one is the cover rather than letting the default decide. With no
     choice recorded, `coverImage()` falls back to the newest image — so asking
     for three variations would publish the third, for no reason anyone chose.
     The first generated is the one the brief was written for. */
  const cover = run.images[0];
  if (cover) {
    const db = await getDb();
    const { inputs } = await readImageWork(projectId);
    await db
      .update(projects)
      .set({ inputs: { ...inputs, coverImageId: cover.id }, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }
}

/** Advance one run by exactly one step. */
type ClaimedRun = NonNullable<Awaited<ReturnType<typeof claimRun>>>;

async function advance(run: ClaimedRun, routine: Routine) {
  const db = await getDb();
  const projectId = run.projectId;
  if (!projectId) throw new Error("This run has no article attached.");

  let next: RoutineStep = run.step;

  /* A run left at `images` by the version that did all four calls in one step
     has no prompt written down, and this one cannot invent it. Rewind it a step
     rather than failing it three times over a state it never chose. Costs one
     poke and no API call. */
  if (run.step === "images" && routine.imagesPerRun > 0) {
    const { work } = await readImageWork(projectId);
    if (!work?.prompt) {
      await db
        .update(routineRuns)
        .set({ step: "prompt", lockedUntil: null, attempts: 0, error: null, updatedAt: new Date() })
        .where(eq(routineRuns.id, run.id));
      return "prompt" as RoutineStep;
    }
  }

  switch (run.step) {
    case "plan":
      await preparePlanCore(projectId);
      next = "draft";
      break;
    case "draft":
      await generateDraftCore(projectId);
      // Zero images means the article goes out without a cover, and it has to
      // mean that here: the generator clamps its own count to at least one, so
      // skipping the steps is the only way to actually ask for no picture.
      next = routine.imagesPerRun > 0 ? "prompt" : "publish";
      break;
    case "prompt":
      await runPromptStep(projectId, routine.imagesPerRun);
      next = "reference";
      break;
    case "reference":
      await runReferenceStep(projectId, routine.imagesPerRun);
      next = "images";
      break;
    case "images":
      await runImageStep(projectId, routine.imagesPerRun);
      next = "publish";
      break;
    case "publish":
      await publishToHubCore(projectId, routine.hubStatus);
      next = "done";
      break;
    default:
      next = "done";
  }

  const done = next === "done";
  await db
    .update(routineRuns)
    .set({
      step: next,
      status: done ? "done" : "running",
      // Released immediately: the next step should be picked up by the next
      // poke rather than waiting out a lock that is no longer protecting work.
      lockedUntil: null,
      attempts: 0,
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(routineRuns.id, run.id));
  return next;
}

/**
 * Run one step, or give up on it in time to say so.
 *
 * The work itself keeps running after the deadline — a fetch in flight cannot
 * be recalled — but nothing waits on it, and every step either checks what is
 * already stored before redoing it or overwrites its own output, so a late
 * arrival costs a duplicate call and not a broken article.
 */
function withDeadline<T>(work: Promise<T>, ms: number, step: RoutineStep): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `The ${step} step took longer than ${Math.round(ms / 1000)}s and was stopped. ` +
            "The request has a 60-second ceiling; a step that cannot fit needs less work in it, " +
            "or a plan that allows longer functions."
        )
      );
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      }
    );
  });
}

/** Record a failed step, and stop the run once it has failed enough times. */
async function recordFailure(run: ClaimedRun, cause: unknown) {
  const db = await getDb();
  // Already counted when the run was claimed — see `claimRun`.
  const attempts = run.attempts;
  const message = cause instanceof Error ? cause.message : String(cause);
  const exhausted = attempts >= MAX_ATTEMPTS;
  await db
    .update(routineRuns)
    .set({
      attempts,
      // Truncated, because a provider error can carry a whole response body and
      // this column is read in a list.
      error: message.slice(0, 500),
      status: exhausted ? "failed" : "running",
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(routineRuns.id, run.id));
  return exhausted;
}

/**
 * One poke: advance whatever is in flight, and start a run if one is due.
 *
 * Advancing comes first. A run already part-way through has spent money on
 * research and drafting, and finishing it matters more than beginning another.
 */
export async function tick(): Promise<TickReport> {
  const startedAt = Date.now();
  const report: TickReport = { started: 0, advanced: [], idle: true };

  if (!(await isAnthropicConfigured())) {
    return { ...report, note: "ANTHROPIC_API_KEY is not set — nothing can be written." };
  }

  /* Work in flight comes first, whichever routine it belongs to. An article
     part-way through has already spent money on research and drafting, and
     finishing it matters more than beginning another. */
  const advancedAny = await advanceInFlight(report, startedAt);

  // A tick that spent its budget advancing does not also start something new.
  if (advancedAny && Date.now() - startedAt >= STEP_ROOM_MS) return report;

  const due = await dueRoutines();
  if (due.length === 0) {
    return advancedAny ? report : { ...report, note: notIdleNote(await listRoutines()) };
  }

  for (const routine of due) {
    /* THE CLOCK MOVES WHERE THE DECISION IS MADE, not before it.
       It used to move here, above every check, on the reasoning that a routine
       which cannot run today should try tomorrow rather than on every tick for
       the rest of the day. That is right for the three ceilings below and
       wrong for the one case underneath them: a start that THREW also had its
       clock moved to tomorrow, so it never came due again today and
       FAILED_STARTS_PER_DAY — five retries, for exactly the case of a provider
       being briefly unwell — could never reach two. One blip cost the day. */

    if (await isWriting(routine.id)) {
      /* Due, and already writing. The only way to reach this is a clock that
         failed to move after the start that is still running — so the article
         for this slot exists, and moving it now is the repair. Not a skip:
         nothing was refused, and there is nothing for a person to read. */
      await rescheduleRoutine(routine);
      continue;
    }
    if ((await failedStartsToday(routine.id)) >= FAILED_STARTS_PER_DAY) {
      report.note = await skipRoutine(routine, "Too many failed starts today.");
      continue;
    }
    if (routine.hubStatus === "published" && !isHubConfigured()) {
      report.note = await skipRoutine(routine, "It publishes to the Hub, which is not configured.");
      continue;
    }

    try {
      await withDeadline(startRun(routine), STEP_DEADLINE_MS, "topic");
      // Only now: an article exists, so this slot is genuinely spent.
      await rescheduleRoutine(routine);
      report.started += 1;
      report.idle = false;
    } catch (cause) {
      /* The clock deliberately stays where it is. The routine is still due, so
         the next tick tries again — which is what the failed-start ceiling is
         counting towards, and what stops it when the trouble is not brief. */
      await recordStartFailure(routine.id, cause);
      report.note = "A routine could not start — see its history.";
    }
    // One start per tick. The next one is five minutes away, and two articles
    // beginning together would fight over the same sixty seconds anyway.
    break;
  }

  return report;
}

/** Advance whatever is running, within the tick's budget. True if anything was. */
async function advanceInFlight(report: TickReport, startedAt: number): Promise<boolean> {
  let moved = false;
  for (;;) {
    const remaining = STEP_BUDGET_MS - (Date.now() - startedAt);
    if (remaining < STEP_ROOM_MS) break;
    const run = await claimRun();
    if (!run) break;
    report.idle = false;
    moved = true;
    const routine = await getRoutineById(run.routineId);
    if (!routine) {
      await recordFailure(run, new Error("The routine this run belongs to is gone."));
      break;
    }
    try {
      const to = await withDeadline(
        advance(run, routine),
        Math.min(STEP_DEADLINE_MS, remaining - 3_000),
        run.step
      );
      report.advanced.push({ runId: run.id, from: run.step, to });
    } catch (cause) {
      const exhausted = await recordFailure(run, cause);
      report.advanced.push({ runId: run.id, from: run.step, to: exhausted ? "failed" : run.step });
      // Stop this tick rather than spin: whatever failed is likely to fail
      // again inside the same few seconds.
      break;
    }
  }
  return moved;
}

/** Why a tick with nothing to do had nothing to do — shown on the Routines page. */
function notIdleNote(all: Routine[]): string {
  if (all.length === 0) return "No routines yet.";
  const on = all.filter((routine) => routine.enabled && routine.scheduleKind !== "manual");
  if (on.length === 0) return "No routine is on a schedule.";
  return "Nothing is due yet.";
}

/**
 * Pass over a slot that came due, and say so out loud.
 *
 * A SKIPPED SLOT USED TO LEAVE NOTHING BEHIND. The clock moved, the `continue`
 * ran, and the routine's next scheduled time arrived with no article, no error,
 * and nothing anywhere that could account for the gap — which is, from the
 * outside, indistinguishable from the scheduler never firing at all. It is the
 * worst thing this file can do, because it sends whoever is watching to debug
 * infrastructure that is working perfectly.
 *
 * So a skip is a row now. It carries no project and it is not a failure, so it
 * counts against the failed-start ceiling not at all; it exists to be read.
 *
 * The clock still moves, because both reasons that reach here will still be
 * true five minutes from now — the day's starts have all failed, or the Hub is
 * not configured. Leaving it due would re-skip, and re-record, on every tick
 * until midnight.
 */
async function skipRoutine(routine: Routine, reason: string): Promise<string> {
  const db = await getDb();
  await db.insert(routineRuns).values({
    routineId: routine.id,
    step: "topic",
    status: "skipped",
    error: reason.slice(0, 500),
  });
  await rescheduleRoutine(routine);
  return `${routine.name} skipped a run — ${reason.toLowerCase()}`;
}

/** A start that failed leaves a row, so the reason is readable on the page. */
async function recordStartFailure(routineId: string, cause: unknown) {
  const db = await getDb();
  await db.insert(routineRuns).values({
    routineId,
    step: "topic",
    status: "failed",
    attempts: MAX_ATTEMPTS,
    error: (cause instanceof Error ? cause.message : String(cause)).slice(0, 500),
  });
}

/**
 * Start a routine now, because somebody pressed the button.
 *
 * Subject to no ceiling at all, and the schedule's own clock is left alone: a
 * run started here is an extra article, not the scheduled one arriving early.
 *
 * The run is marked `manual`, which is what keeps those two apart. A tick asks
 * whether the SCHEDULE is already writing before it starts anything, and a
 * person watching a manual run must not answer that question for it.
 */
export async function runRoutineNow(routineId: string): Promise<{ runId: string }> {
  const routine = await getRoutineById(routineId);
  if (!routine) throw new Error("This routine no longer exists.");
  if (!(await isAnthropicConfigured())) {
    throw new Error("The Anthropic API key is not configured, so nothing can be written.");
  }
  const run = await withDeadline(startRun(routine, "manual"), STEP_DEADLINE_MS, "topic");
  return { runId: run.id };
}

export type StepOutcome = {
  runId: string;
  step: RoutineStep;
  status: RoutineRunStatus;
  /** Set when this call did nothing because another worker holds the run. */
  busy?: boolean;
  error?: string;
};

/**
 * Advance ONE run by one step, and say where it got to.
 *
 * This is what the Routines page calls, over and over, while somebody watches a
 * manual run: the browser is the timer, so a run started by hand finishes in
 * three minutes instead of waiting out the schedule. It takes the same claim as
 * a tick, so a person watching and a scheduler ticking cannot both advance the
 * same run.
 */
export async function stepRun(runId: string): Promise<StepOutcome> {
  const db = await getDb();
  const [before] = await db.select().from(routineRuns).where(eq(routineRuns.id, runId)).limit(1);
  if (!before) throw new Error("This run no longer exists.");
  if (before.status !== "running") {
    return { runId, step: before.step, status: before.status, error: before.error ?? undefined };
  }

  const run = await claimRun(runId);
  if (!run) {
    // Held by a tick, or by another tab. Report it rather than queueing behind
    // it: the caller polls, and the next poll will find it moved on.
    return { runId, step: before.step, status: "running", busy: true };
  }

  const routine = await getRoutineById(run.routineId);
  if (!routine) {
    await recordFailure(run, new Error("The routine this run belongs to is gone."));
    return { runId, step: run.step, status: "failed", error: "The routine is gone." };
  }

  try {
    const to = await withDeadline(advance(run, routine), STEP_DEADLINE_MS, run.step);
    return { runId, step: to, status: to === "done" ? "done" : "running" };
  } catch (cause) {
    const exhausted = await recordFailure(run, cause);
    return {
      runId,
      step: run.step,
      status: exhausted ? "failed" : "running",
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}


/**
 * Runs that are still going, whoever started them.
 *
 * The Routines page asks for this every few seconds while anything is in
 * flight, so a run advancing on the schedule animates on screen the same way a
 * run somebody started by hand does. Kept to the columns the page draws.
 */
export async function runningRuns() {
  const db = await getDb();
  return db
    .select({
      id: routineRuns.id,
      routineId: routineRuns.routineId,
      projectId: routineRuns.projectId,
      step: routineRuns.step,
      status: routineRuns.status,
      error: routineRuns.error,
      startedAt: routineRuns.startedAt,
      title: projects.selectedTopic,
    })
    .from(routineRuns)
    .leftJoin(projects, eq(projects.id, routineRuns.projectId))
    .where(eq(routineRuns.status, "running"))
    .orderBy(asc(routineRuns.startedAt))
    .limit(10);
}

/** The most recent runs — all of them, or one routine's. */
export async function recentRuns(limit = 20, routineId?: string) {
  const db = await getDb();
  return db
    .select({
      id: routineRuns.id,
      projectId: routineRuns.projectId,
      step: routineRuns.step,
      status: routineRuns.status,
      error: routineRuns.error,
      startedAt: routineRuns.startedAt,
      updatedAt: routineRuns.updatedAt,
      routineId: routineRuns.routineId,
      title: projects.selectedTopic,
      publishedTo: projects.publishedTo,
    })
    .from(routineRuns)
    .leftJoin(projects, eq(projects.id, routineRuns.projectId))
    .where(routineId ? eq(routineRuns.routineId, routineId) : undefined)
    .orderBy(desc(routineRuns.startedAt))
    .limit(limit);
}
