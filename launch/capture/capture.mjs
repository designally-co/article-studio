/**
 * Films the article's journey through the running app, frame by frame.
 *
 * THE PAGE CLOCK IS OURS. Playwright's clock replaces the page's timers,
 * Date, performance.now and requestAnimationFrame, and every CSS animation
 * and transition is paused and moved by hand (stepAnimations below). Each
 * frame advances that clock by exactly 1/30 s, then takes a 2x screenshot —
 * so the globe, the step fades, the route motion and the stepper all come out
 * smooth however long a screenshot takes. The server is not on this clock: it
 * answers when the mock's gates are released (mock/server.mjs), and the
 * script releases them once it has filmed enough of each wait.
 *
 * THE LONG WAITS ARE JUMPED. A progress card's steps change on its own clock
 * (0, 3, 15, 27 s…). The script films a second and a half after each change,
 * then jumps the clock to just before the next one. That is where the 3–12x
 * speed-up comes from, with every label on screen long enough to read.
 *
 * The Hub is filmed twice: at 1440 wide, and at 720 wide for the 4:5 cut.
 *
 * Output: launch/.work/frames/NNNNN.jpg and launch/.work/frames/manifest.json,
 * one entry per frame: its segment, the page time, the cursor (the page has
 * none of its own; edit/render.py draws it) and any clicks or key presses.
 *
 *   node launch/capture/capture.mjs <userId>      (run.sh does all of this)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { sessionCookie } from "./session.mjs";
import { TOPIC } from "../story.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../.work/frames");
const APP = process.env.APP_ORIGIN || "http://localhost:3000";
const MOCK = process.env.MOCK_ORIGIN || "http://127.0.0.1:4010";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const FPS = 30;
const DT = 1000 / FPS;
const userId = process.argv[2];
if (!userId) throw new Error("Usage: capture.mjs <userId>");

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const gate = (action, name, extra = "") => fetch(`${MOCK}/control/${action}?name=${name}${extra}`).then((r) => r.json());

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await context.addCookies([await sessionCookie({ userId, origin: APP })]);
const page = await context.newPage();
page.on("pageerror", (error) => console.log("page error:", error.message));

/* Pauses every animation the page has and sets it to the page clock. A new
   animation is caught the frame it appears, at whatever point it had reached. */
await page.addInitScript(() => {
  const base = new WeakMap();
  window.__launchStep = () => {
    const now = performance.now();
    for (const animation of document.getAnimations()) {
      if (!base.has(animation)) {
        base.set(animation, (animation.currentTime ?? 0) - now);
        animation.pause();
      }
      animation.currentTime = base.get(animation) + now;
    }
  };
  window.__launchRelease = () => {
    for (const animation of document.getAnimations()) if (animation.playState === "paused") animation.play();
  };
});
await page.clock.install();

const manifest = { fps: FPS, viewport: { width: 1440, height: 900, scale: 2 }, frames: [], marks: {} };
let segment = "";
let cursor = null;
let pendingEvents = [];

/* ---- the clock ------------------------------------------------------------- */

async function pause() {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 10);
}

/** Advances the page clock without filming, in small steps so nothing is skipped. */
async function idle(ms) {
  for (let left = ms; left > 0; left -= 100) {
    await page.clock.runFor(Math.min(100, left));
    await page.evaluate(() => window.__launchStep());
  }
}

/** Runs the clock unfilmed until `test` passes, giving the server real time to answer. */
async function until(test, { timeout = 60000, step = 50 } = {}) {
  const started = Date.now();
  while (!(await test())) {
    if (Date.now() - started > timeout) throw new Error(`Timed out in segment ${segment}`);
    await page.clock.runFor(step);
    await page.evaluate(() => window.__launchStep());
  }
}

/** One frame: the clock moves 1/30 s, the animations follow, a screenshot is kept. */
async function frame() {
  await page.clock.runFor(DT);
  await page.evaluate(() => window.__launchStep());
  const index = manifest.frames.length;
  const file = `${String(index).padStart(5, "0")}.jpg`;
  await page.screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 92 });
  const t = await page.evaluate(() => performance.now());
  manifest.frames.push({ file, segment, t: Math.round(t), cursor, events: pendingEvents });
  pendingEvents = [];
  return index;
}

async function film(count, each) {
  for (let i = 0; i < count; i++) {
    if (each) await each(i, count);
    await frame();
  }
}

function mark(name) {
  manifest.marks[name] = manifest.frames.length;
  console.log(`  ${name} @ frame ${manifest.frames.length}`);
}

/* ---- the cursor ------------------------------------------------------------ */

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

async function centre(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No box for ${locator}`);
  return [box.x + box.width / 2, box.y + box.height / 2];
}

/** Films the cursor gliding to `to` over `frames` frames, eased, with real hover. */
async function glide(to, frames = 18) {
  const from = cursor ?? [to[0] + 260, to[1] + 180];
  await film(frames, async (i, n) => {
    const k = ease((i + 1) / n);
    cursor = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k];
    await page.mouse.move(cursor[0], cursor[1]);
  });
}

async function click(locator, glideFrames = 18) {
  await glide(await centre(locator), glideFrames);
  pendingEvents.push({ type: "click", at: cursor });
  await locator.click();
}

/* ---- the journey ----------------------------------------------------------- */

const visible = (text) => () => page.getByText(text, { exact: true }).first().isVisible().catch(() => false);
/** Films a progress card: about 1.5 s of each step, jumping the gaps between. */
async function steps(name, plan) {
  const start = await page.evaluate(() => performance.now());
  for (const [i, step] of plan.entries()) {
    const target = start + step.at * 1000 - 120;
    const now = await page.evaluate(() => performance.now());
    if (target > now) await idle(target - now);
    mark(`${name}:${step.label}`);
    await film(step.frames ?? 45);
    if (i === plan.length - 1) break;
  }
}

await gate("open-all", "");
await gate("hold", "plan,draft,visual_brief,image_prompt,generate,hub");

// 1. Type a topic.
console.log("1. create");
segment = "create";
await page.goto(`${APP}/new`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await pause();
await idle(1500);
const composer = page.locator("textarea").first();
mark("create:start");
cursor = [1060, 600];
await page.mouse.move(...cursor);
await film(12);
await click(composer, 20);
await film(6);
mark("create:typing");
for (const character of TOPIC) {
  await page.keyboard.type(character);
  pendingEvents.push({ type: "key" });
  await frame();
}
await film(10);
await click(page.locator("button[type=submit]"), 16);
mark("create:sent");
await film(24);

// 2. Research and write.
console.log("2. prepare");
segment = "prepare";
await until(visible("Reading your topic"));
await steps("prepare", [
  { at: 0, label: "Reading your topic" },
  { at: 3, label: "Researching sources" },
  { at: 15, label: "Planning the article" },
  { at: 27, label: "Starting the draft" },
]);
await gate("release", "plan");
console.log("2b. draft");
segment = "draft";
await until(() => page.url().includes("stage=4"));
mark("draft:open");
await film(12);
// Three words a frame: about ninety words a second, quick but legible.
await film(110, () => gate("release", "draft", "&count=1"));
mark("draft:streamed");
await gate("release", "draft");
const toImages = page.getByRole("button", { name: "Continue to images" }).first();
await until(() => toImages.isEnabled());
await film(8);
await click(toImages, 18);
await film(10);

// 3. Illustrate.
console.log("3. image");
segment = "image";
await until(() => page.url().includes("view=images"));
await until(() => page.getByRole("button", { name: "Auto-draft" }).isVisible());
// The model that needs no reference picture, chosen off camera.
await page.getByRole("button", { name: "Image settings" }).click();
await idle(400);
await page.getByRole("menuitem", { name: /Model/ }).click();
await idle(400);
await page.getByRole("menuitemradio", { name: "Fal.ai · Nano Banana 2", exact: true })
  .or(page.getByRole("menuitem", { name: "Fal.ai · Nano Banana 2", exact: true }))
  .first()
  .click();
await page.keyboard.press("Escape");
await idle(800);
mark("image:start");
cursor = null;
await click(page.getByRole("button", { name: "Auto-draft" }), 20);
await steps("image-prompt", [
  { at: 0, label: "Reading the article" },
  { at: 6, label: "Choosing the picture", frames: 40 },
  { at: 12, label: "Writing the prompt" },
]);
await gate("release", "visual_brief");
await gate("release", "image_prompt");
const generate = page.getByRole("button", { name: /^Generate \d image/ });
await until(() => generate.isVisible());
mark("image:prompt");
await film(36);
await click(generate, 16);
await steps("image-generate", [
  { at: 0, label: "Sending the brief" },
  { at: 3, label: "Painting the image" },
]);
await gate("release", "generate");
await until(() => page.getByText("The selected image will be published.").isVisible());
mark("image:cover");
await film(60);
await click(page.getByRole("button", { name: "Continue to publish" }).first(), 18);
await film(6);

// 4. Publish.
console.log("4. publish");
segment = "publish";
await until(() => page.url().includes("view=complete"));
const publish = page.getByRole("button", { name: "Publish to Hub" }).first();
await until(() => publish.isEnabled());
await idle(1200);
mark("publish:start");
await film(10);
await click(publish, 18);
await film(14);
await click(page.getByRole("button", { name: "Publish live" }), 14);
await steps("publish", [
  { at: 0, label: "Preparing the article" },
  { at: 2, label: "Uploading the cover" },
]);
await gate("release", "hub");
const openOnHub = page.getByRole("link", { name: "Open on the Hub" });
await until(() => openOnHub.isVisible());
mark("publish:done");
await film(45);
const hubUrl = await openOnHub.getAttribute("href");

/* Where the Hub scroll stops: the article's references in the middle of the
   screen. Not further, where the Hub's own newsletter and footer pictures begin. */
const scrollTarget = () => {
  const heading = document.querySelector(".article-refs__title");
  const end = document.documentElement.scrollHeight - innerHeight;
  if (!heading) return Math.min(2000, end);
  return Math.min(end, Math.round(heading.getBoundingClientRect().top + scrollY - innerHeight * 0.4));
};

// 5. Live on the Hub.
console.log("5. hub");
segment = "hub";
cursor = null;
await page.clock.resume();
await page.evaluate(() => window.__launchRelease());
await page.goto(hubUrl, { waitUntil: "networkidle" });
// The development server's own badge is not part of the Hub.
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);
await pause();
await idle(300);
mark("hub:start");
await film(15);
const travel = await page.evaluate(scrollTarget);
await film(150, (i, n) => page.evaluate((y) => window.scrollTo(0, y), Math.round(travel * ease((i + 1) / n))));
mark("hub:end");
await film(10);

/* The same page in a narrower window, for the 4:5 cut. Cropping the wide page
   to 4:5 would cut the headline in half; the Hub's own narrower layout keeps
   it whole. */
console.log("5b. hub, narrow");
segment = "hub-narrow";
await page.clock.resume();
await page.setViewportSize({ width: 720, height: 900 });
await page.goto(hubUrl, { waitUntil: "networkidle" });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);
await pause();
await idle(300);
mark("hub-narrow:start");
await film(15);
const travelNarrow = await page.evaluate(scrollTarget);
await film(150, (i, n) => page.evaluate((y) => window.scrollTo(0, y), Math.round(travelNarrow * ease((i + 1) / n))));
mark("hub-narrow:end");
await film(10);

fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(`${manifest.frames.length} frames in ${OUT}`);
await gate("open-all", "");
await browser.close();
