# Preview: proposed article direction (v1)

Branch `preview/article-direction-v1`. A **test of a proposal, not an approved direction**. Do not merge.

Source of the proposal: the request for this build session (2026-10-15), which quotes the Labs page "Proposal: one article direction with in-body images". The Labs repo (`designally-co/designally-labs`) and Nick's editorial guide 2.0.2 (Labs PR #4) **could not be read from this session** (no access), so the build follows the request text only.

## How to try it

1. On Create, switch **New direction (preview)** on, type a topic, choose a direction, send. The model proposes labels; check them in the dialog and press **Create article**. With the switch off, everything is the current behaviour.
2. The steps are **Draft** and **Publish** only. In Draft: the **cover** card at the top (Find, Generate, Upload, as the type allows) and an **image block card** in place for each body image (Find, Generate, Draw, Upload, Remove; the suggested route is dark; a route the type forbids is greyed out and says why).
3. Publish. An empty block keeps the article as a Hub **draft**, with the reason shown.

Headless comparison of one subject (current vs proposed), on its own test database: `scripts/direction-trial.mts` (instructions at the top of the file). Unit tests: `npm test`.

## What was verified (locally, separate test databases, no production)

| Check | Result |
|---|---|
| Typecheck, lint, `next build`, `next start` | Pass. Pages load signed in (local session on the embedded PGlite test database). |
| Unit tests (labels, combinations, block parsing, routing, Hub body, preview, draft checks) | 16 of 16 pass. |
| Migration 0031 | Applied to the local test databases only (schema 32 of 32). |
| Editor cards render in place; Upload fills a block; Remove; routes refused by type | Pass (screenshots below). |
| Case study refuses Generate and Draw, for body and cover; Find with no subject picture leaves the block for a person | Pass. |
| Publish into a **local Hub** (the Hub repo's `main`, Payload 3.86, SQLite) | Body images arrive as real upload nodes in the right places, with alt text; the summary line becomes the Hub summary; the public page shows them (screenshot 10). |
| Empty blocks hold the article as a Hub draft | Pass: "Saved as a Hub draft, not published: img-1 is empty. img-2 is empty." |

Screenshots: `06-draft-two-steps-cover-and-blocks.png` (Draft with cover and two filled blocks), `05-case-study-find-and-forbidden-generate.png`, `08-tutorial-published-before.png` (Publish preview), `09-case-study-held-as-draft.png`, `10-hub-public-article.png` (local Hub page). The pictures in them are **local test uploads**, not Find, Generate or Draw results.

## Not done yet: the 4-article comparison

This session has **no Anthropic, Fal or Unsplash key**, so no article was written and no image was found, generated or drawn by a provider. Not done:

- the 4 runs (case study, tutorial, explanation, news), each current vs proposed;
- screenshots of a found, a generated and a drawn block;
- cost per article. **Total provider spend so far: $0.00** (no successful provider call was made).

To finish: give the environment `ANTHROPIC_API_KEY`, `FAL_KEY` and (recommended) `UNSPLASH_ACCESS_KEY` with small budgets, then run `scripts/direction-trial.mts` four times. It writes each draft, its checks, images, timings and the cost from `api_usage_log` to `./out/`.

## What the Hub needs

**Nothing, for body images to work.** Measured with the Hub's own converter (`convertMarkdownToLexical`, Payload 3.86) and on a local Hub:

- `![media:42]()` **alone on its line** becomes an upload node, and the Hub's article page (fetched at depth 1) renders it with the default converter. Studio uploads each picture with the existing `/api/media/from-url` (or `/api/media` for a local file) and writes this placeholder.
- A standard `![alt](url)` arrives as **literal text** in a paragraph. Never send it.
- A placeholder **inside a sentence replaces the whole paragraph**. Studio always puts it on its own line.
- Images carry no caption (build session, 2026-10-15), so nothing is sent under them.

Optional, for a matching `designally-knowledge-hub` branch (not made here):

1. **Credit on the media doc.** `/api/media/from-url` accepts only `url`, `alt`, `filename`; the Media collection already has a `credit` field. Accept `credit` there. (Studio already credits every online image in the article's References.)
2. **At a glance bullets** render without bullet markers on the Hub page (screenshot 10). Check the list style in the article body.
3. **Thai translation** rebuilds the Thai body from the English Lexical body via Markdown. Upload nodes export as `![media:<id>]()` at depth 0, so they should survive; not tested (Thai is hidden).
4. `MEDIA_FETCH_HOSTS` must name the R2 domain, as it already does for covers.

## Open questions

1. **No type uses Generate for a body image** in the proposal's routing table, yet Generate is a body route and routines may fill Generate blocks. This branch offers Generate only as an editor's choice on explanation and business guide blocks. Should a type place a generated "mood" block?
2. **Rights** (build session, 2026-10-15): Designally has the rights to use online images, credited in References, and the editor is not asked. So online images are recorded as `licensed`, everything else as `own`; only an **empty block** holds an article as a draft. Is a credit line in References enough for every source (for example a studio's case-study photos)?
3. **Fonts for drawn figures.** The Docker image (`node:22-alpine`) installs no fonts, so the text in a drawn figure would not render on the NAS. Fix if Draw is kept: `RUN apk add --no-cache font-inter ttf-dejavu` in the runner stage.
4. **Settings → Content** (the saved article prompt and length) is bypassed for labelled articles. Should the proposal's template become editable there?
5. **Routines** have no labels, so they keep the current behaviour. If they get labels: a case-study routine has no cover route without a person, and drawing up to 3 figures in the publish step may pass the 150-second step limit.
6. **Fal costs** were never written to `api_usage_log` (Fal's answer carries no cost). This branch logs every generation at the indicative price, for both behaviours.
7. The labels are temporary and Studio-only; the Hub still gets one direction tag. Before any rollout, decide how pillar, type, topic and keywords map to the Hub's 3 categories and 34 tags.
