/**
 * Draws the video's own graphics with the browser, in the app's fonts and
 * colours: the chapter pills, the cursor and the end cards. render.py lays
 * them over the captured frames.
 *
 *   node launch/edit/overlays.mjs     → launch/.work/overlays/*.png
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../.work/overlays");
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
fs.mkdirSync(OUT, { recursive: true });

// The app's tokens (src/app/globals.css) and fonts (src/app/layout.tsx).
const TOKENS = `
  @import url('https://fonts.googleapis.com/css2?family=Zalando+Sans:wght@400;500;600&family=Poppins:wght@400;500&display=block');
  :root { --accent: #ef6148; --ink: #1a1a1a; --ink-2: #55575d; --bg: #f8f8f7; }
  html, body { margin: 0; background: transparent; }
  body { font-family: 'Poppins', sans-serif; color: var(--ink); -webkit-font-smoothing: antialiased; }
`;

export const CHAPTERS = [
  { id: "1", label: "Start with a topic" },
  { id: "2", label: "Research and write" },
  { id: "3", label: "Illustrate" },
  { id: "4", label: "Publish" },
  { id: "live", mark: "✓", label: "Live on the Hub" },
];

const pill = ({ id, mark, label }) => `
  <div id="shot" style="display:inline-block;padding:24px"><div style="display:inline-flex;align-items:center;gap:14px;padding:10px 24px 10px 10px;
    background:#fff;border-radius:999px;box-shadow:0 1px 2px rgba(26,26,26,.08),0 6px 20px rgba(26,26,26,.10);
    font-family:'Zalando Sans',sans-serif;font-weight:500;font-size:25px;letter-spacing:-.01em">
    <span style="width:36px;height:36px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;
      font-size:20px;font-weight:600">${mark ?? id}</span>
    <span>${label}</span>
  </div></div>`;

/* An arrow like the system one, drawn large so it stays sharp when scaled. */
const cursor = `
  <div id="shot" style="width:64px;height:84px;padding:12px">
    <svg width="64" height="84" viewBox="0 0 16 21" style="filter:drop-shadow(0 1.5px 2.5px rgba(0,0,0,.35))">
      <path d="M1 1 L1 16.2 L4.6 12.9 L7.1 18.8 L9.6 17.7 L7.2 12 L12.1 12 Z" fill="#1a1a1a" stroke="#fff" stroke-width="1.15" stroke-linejoin="round"/>
    </svg>
  </div>`;

const endCard = (width, height) => {
  const tall = height > width;
  return `
  <div id="shot" style="width:${width}px;height:${height}px;background:var(--bg);display:flex;flex-direction:column;
    align-items:center;justify-content:center;text-align:center;gap:${tall ? 30 : 26}px">
    <div style="display:flex;align-items:center;gap:18px">
      <span style="width:22px;height:22px;border-radius:50%;background:var(--accent)"></span>
      <span style="font-family:'Zalando Sans',sans-serif;font-weight:500;font-size:${tall ? 92 : 100}px;letter-spacing:-.03em;line-height:1">Article Studio</span>
    </div>
    <div style="font-size:${tall ? 34 : 34}px;color:var(--ink-2);line-height:1.4">Designed and built by <span style="color:var(--ink);font-weight:500">Khun Shine Si Thu</span></div>
    <div style="margin-top:${tall ? 26 : 18}px;font-family:'Zalando Sans',sans-serif;font-size:${tall ? 30 : 30}px;font-weight:500;
      color:var(--accent);padding:14px 28px;border:2px solid rgba(239,97,72,.35);border-radius:999px">khunshinesithu.com/work/article-studio</div>
  </div>`;
};

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 2000, height: 1400 } });

async function render(name, html, transparent = true) {
  await page.setContent(`<!doctype html><html><head><style>${TOKENS}</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.locator("#shot").screenshot({ path: path.join(OUT, name), omitBackground: transparent });
  console.log(name);
}

for (const chapter of CHAPTERS) await render(`pill-${chapter.id}.png`, pill(chapter));
await render("cursor.png", cursor);
await render("end-16x9.png", endCard(1920, 1080), false);
await render("end-4x5.png", endCard(1080, 1350), false);
await browser.close();
