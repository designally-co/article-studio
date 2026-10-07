# Designally Content Studio — Technical & Integration Guide

Status: current as of commit `907b5e3` (main, 5 October 2026).
Audience: an engineer integrating this app with another system, extending it, or taking over its deployment.

This document describes what the app is, how it is built, every interface it exposes, and what you would have to change to talk to it from another application. It is written from the source, not from intent — where something is missing or awkward, it says so.

---

## 1. What it is

Content Studio is an internal, single-tenant web app that turns a topic, a brief, or a content direction into a publish-ready article and its companion images, then publishes that article into the **Designally Knowledge Hub** (a separate Payload CMS app).

It is a **Next.js application with a UI, not a headless service.** Every capability is reached through server actions and session-authenticated route handlers driven by its own React front end. There is currently no machine-to-machine API — see §8, which is the section that matters most for integration.

Two repositories are involved:

| | Repo | Role |
|---|---|---|
| Article Studio | `designally-co/article-studio` | Generates articles. Writes to the Hub. |
| Knowledge Hub | `designally-co/designally-knowledge-hub` | Payload CMS + public site. Receives articles. |

Data flows **one way**: Studio → Hub. The Hub never calls the Studio.

---

## 2. Stack

| Layer | Choice | Version |
|---|---|---|
| Framework | Next.js App Router | 16.3.5 |
| Runtime | Node.js | 22+ required (`node:22-alpine` in the image) |
| UI | React | 19.2.4 |
| Styling | Tailwind CSS | v4 |
| Components | shadcn/ui over `radix-ui`, `lucide-react` icons | — |
| ORM | Drizzle | ^0.45.2 (`drizzle-kit` ^0.31.10) |
| Database | Postgres (`postgres`) or embedded PGlite | ^3.4.9 / ^0.5.4 |
| LLM | `@anthropic-ai/sdk` | ^0.111.0 |
| Auth | `next-auth` (Auth.js v5), Google provider | ^5.0.0-beta.32 |
| Images | `sharp` (resize and WebP re-encode), Fal.ai (generation), Cloudflare R2 via `@aws-sdk/client-s3` (storage) | 0.35.4 |
| Validation | `zod` | ^4.4.3 |

`jose` is still listed in `package.json` but nothing in `src/` imports it any more; it was the session library before NextAuth.

Build output is `output: "standalone"` everywhere except on Vercel, which does its own packaging (`next.config.ts` checks `process.env.VERCEL`). The standalone server is what the NAS container runs. Vercel region is pinned to `sin1` (Singapore) in `vercel.json`.

---

## 3. Repository layout

```
src/
  auth.ts                   NextAuth config: Google provider, designally.co only, upsertUser
  app/
    (app)/                  authenticated application
      page.tsx              home / recent work
      new/                  Create: topic, brief, or direction → project
      pipeline/[id]/        the article pipeline (stages)
        actions.ts          research plan, image prompts, brand review, save draft
        image-actions.ts    image generation, references, branding, cover
        publish-actions.ts  dek generation + publish to the Hub
        stages/             prepare-draft, drafts, publish stage UIs
      library/              Content Library (list, filter, delete)
      routines/             schedules: create, edit, run now, history
    api/                    HTTP route handlers (see §7)
    login/                  "Continue with Google", the only way in
    actions.ts              logoutAction
  components/               app shell, stepper, markdown, shadcn ui/
    settings/               the Settings sheet (Brand / Content / API & models) and its actions
  db/
    schema.ts               single source of truth for the data model
    index.ts                connection, migration + seed bootstrap
    seed.ts                 first-run seed (pillars, directions, brand)
  lib/
    anthropic.ts            model calls: runJson / runText / streamText
    ai/models.ts            stage → model-tier routing
    article-template.ts     the editable article prompt + length rules
    auth.ts, session.ts     getSessionUser, requireUser (scrypt helpers kept, unused)
    crypto.ts, secrets.ts   AES-256-GCM at-rest encryption for saved API keys
    content-pillars.ts      canonical pillars + content directions
    publish-meta.ts         direction → (pillar category, tags) derivation
    hub.ts                  the Knowledge Hub client  ← the integration boundary
    image/                  providers, storage, branding, visual brief
    pipeline/               each pipeline step as a plain function, session-free
    autopilot/runner.ts     the unattended state machine that calls those steps
    autopilot/schedule.ts   when a routine next runs (plain module, no directive)
    autopilot/views.ts      the shapes the Routines tab draws
    projects.ts             loadProject() + pipelineContext()
    cost.ts                 token/cost telemetry
  prompts/
    system.ts               system prompt, PROMPT_VERSION, mode rules
    layers.ts               brand / format / context prompt layers
    tasks.ts                per-stage task prompts
drizzle/                    SQL migrations (0000 … 0029) + meta
scripts/migrate.ts          standalone migration runner
```

---

## 4. Data model

All tables live in `src/db/schema.ts`. Postgres, UUID primary keys (`defaultRandom()`), timestamps with time zone.

### Core

**`users`** — `id`, `email` (unique), `password_hash` (nullable since migration 0018, and null for every Google sign-in), `name`, `role` (default `member`), `active`, `created_at`.
A row is created on a person's first Google sign-in, keyed on the lower-cased email, and every sign-in sets `role: "admin"` (see §5).

**`brand_profiles`** — a **singleton**. One brand (Designally) applies to every project; there is no per-project brand selection. Holds `name`, `description`, `audience`, `guideline_text`, `languages`, and JSONB `tone_json` (`{descriptors[], freeText}`), `terminology_json`, `dos_json`, `donts_json`, `defaults_json`. The brand logo is stored **as base64 in the database** (`logo_data`, `logo_mime`) together with `logo_overlay_json` (`{position, sizePct, opacity, shadow}`). `profile_image_*` columns are legacy migration fallbacks.

**`pillars`** — `slug` (unique, matches `CONTENT_PILLARS`), `name`, `tagline`, `purpose`, `sort_order`, `active`. Seeded from code.

**`categories`** — the **content directions** (sub-categories under a pillar), despite the table name. `name`, `name_th`, `pillar_id`, `sort_order`, `active`.

### Article production

**`projects`** — one article. `category_id` (the content direction), `language` (`th` | `en` | `both`), `status` (`draft` | `published`), `stage` (integer, 1–6), plus three JSONB documents:

- `inputs_json` (`ProjectInputs`) — the brief, keyword, competitor URL/summary, GSC insights, editorial format/period/reader, Designally-strategy selections (moment, audience segment, message pillar, objective), image settings (`imageProvider`, `imageCount`, `imageAspectRatio`, `imageApiKeyId`), the cached `publishDek`, and `coverImageId`.
- `selected_topic_json` (`SelectedTopic`) — `{title, angle?, whyTimely?, searchIntent?, researchSources?[], source}` where source is `suggested | edited | custom | brief`. **`title` is the article title used at publish time.**
- `outline_json` (`Outline`) — `{markdown, approved}`. The research plan.
- `published_to_json` — a map; the Hub publish writes `{knowledgeHub: "<absolute url>"}`.

**`drafts`** — one selected draft per project in practice (`variation_no` is always 1; the old 1-of-3 flow is gone). `content_md` is the article Markdown. Carries `tokens_in`, `tokens_out`, `cost_usd`.

**`refinements`** — append-only history for a draft. Each row is `{user_message, result_md}`. Regeneration and AI revision both snapshot the previous body here first (`"Version before regeneration"`, `"Version before AI revision: …"`), which is what makes history restorable.

**`images`** — `provider`, `model`, `prompt`, `aspect_ratio`, `width`/`height`, `variation_no`, `reference_ids_json`, `storage_path`, `cost_usd`, `position` (article image slot, null = companion), `branding_json` (vestigial: logo overlays were retired, always null on new rows).

**`image_references`** — user-uploaded source images that guide generation.

### Operational

**`api_usage_log`** — per-call telemetry: `stage`, `model`, `tokens_in`, `tokens_out`, `cache_creation_tokens`, `cache_read_tokens`, `cost_usd`, `prompt_version`, `latency_ms`, `schema_retry_count`. Stage values written by the current code: `topic_ideas`, `article_setup`, `article_research_plan_search`, `article_research_plan`, `draft`, `refine`, `brand_review`, `image_visual_brief`, `image_prompt`, `reference_search_plan`, `reference_judge`, `source_image_judge`, `publish-dek`. `topic_ideas_fallback` and `article_plan_fallback`, named here before, are no longer written.

**`pricing`** — `provider`, `model`, `unit` (`mtok_in` | `mtok_out` | `image`), `price_usd`, `effective_from`.

**`app_settings`** — key/value. Exactly four keys are used:

| Key | Default |
|---|---|
| `article.prompt` | `DEFAULT_ARTICLE_PROMPT` in `lib/article-template.ts` |
| `article.length` | `1,200–2,000 words` |
| `model.research` | `claude-haiku-4-5` |
| `model.drafting` | `claude-sonnet-5` |

**`routines`** — one row per routine, edited in the Routines tab: `name`, `description`, `enabled`, `category_id` (null rotates), `hub_status` (`draft` | `published`), `image_aspect_ratio` (null rotates), and its own schedule — `schedule_kind` (`manual` | `daily` | `weekdays` | `weekly` | `monthly`), `run_at` (`HH:MM`), `time_zone` (default `Asia/Bangkok`), `weekday`, `day_of_month`, `next_run_at`, `last_run_at`. The timer outside knows none of this: it says "tick", and a tick starts the routines whose `next_run_at` has passed. `images_per_run` is still read by the runner, but the form writes 1 — one article with one cover per run. `max_per_day` is still a column but is **no longer read**: the daily ceiling was replaced by a check that the schedule is not already writing an article.

**`routine_runs`** — one row per unattended article, and the autopilot's memory between requests: `project_id`, `step` (`topic` → `plan` → `draft` → `prompt` → `reference` → `images` → `publish` → `done`), `status` (`running` | `done` | `failed` | `skipped`), `trigger` (`schedule` | `manual`), `attempts`, `error`, `locked_until`. A `skipped` row is a due slot that was deliberately not taken, kept so the page can say why. The step column is what makes a run resumable after a crash; `locked_until` is what stops two schedulers advancing the same run. Read by the **Routines** tab, grouped under the routine that made each run.

**`api_keys`** — user-saved image-provider keys, `encrypted_value` = AES-256-GCM `iv:authTag:ciphertext` (hex), keyed off `ENCRYPTION_KEY`. Only `fal` is a live provider. **Anthropic is environment-only and never stored here.**

---

## 5. Authentication

**NextAuth (Auth.js v5) with Google OAuth, restricted to the `designally.co` Workspace.** Configured in `src/auth.ts`. There are no passwords, no other provider, and no development fallback: Google is the only way in, in every environment including local development. There is still **no middleware file** — every protected surface calls the session helper itself.

- **Provider** — `next-auth/providers/google`, enabled only when `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set. A production build throws without them (pass placeholders to build without an OAuth client). Without them in development, the login page shows "Sign-in is not configured" instead of a button.
- **Domain gate** — `ALLOWED_DOMAIN = "designally.co"`, checked three times: `hd` on the authorisation request (narrows the account picker), the `hd` claim on the returned Google profile (checked server-side in the `signIn` callback), and the email itself, which must end in `@designally.co` and must not be `email_verified: false`. The last two are the gate; the first is a convenience.
- **Users** — `upsertUser()` in `src/auth.ts` finds or creates the `users` row by lower-cased email on sign-in. New rows have `password_hash: null`. Every sign-in sets `role: "admin"`: **everyone who can sign in is an admin** by design. A row with `active: false` is refused at sign-in.
- **Session** — NextAuth's default JWT session (no database adapter, and `src/auth.ts` sets no session options). The JWT carries the user id as `uid`, which the `session` callback copies to `session.user.id`. The cookie is NextAuth's own, not a custom one.
- **Signing secret** — `AUTH_SECRET`, read by NextAuth. Nothing in the app generates one any more; the old `./data/auth-secret` fallback went with password sign-in.
- **Endpoints** — `src/app/api/auth/[...nextauth]/route.ts` exports NextAuth's `GET`/`POST` handlers (sign-in, the Google callback at `/api/auth/callback/google`, session). `pages.signIn` is `/login`. Sign-out is `logoutAction` in `app/actions.ts`, which clears the NextAuth session but not the Google login.
- **Behind a proxy** — `trustHost: true`; in the container `AUTH_URL` must be the public origin, or Google is sent back to `0.0.0.0:3000` (see §9).
- **`getSessionUser()`** (`lib/auth.ts`) — calls NextAuth's `auth()` for the user id, *then* re-reads the user from the database to confirm they still exist and are `active`, so disabling an account takes effect on the next request rather than when the session expires. Wrapped in React `cache()` so one render performs one lookup rather than 5–7. It keeps the shape it had under password sign-in, so its ~40 callers did not change.
- **`requireUser()`** (`lib/session.ts`) — returns the user or `redirect("/login")`. Used by server actions and pages.
- **`requireAdmin()`** (settings actions and routines actions, each its own copy) — throws unless `role === "admin"`. Passes for every real user today; it stays as the gate for the day non-admin accounts exist. Gates model selection, API keys, and every routine change.
- **Password helpers** — `hashPassword` / `verifyPassword` (`scrypt`, 16-byte salt, 64-byte key, `timingSafeEqual`) are still in `lib/auth.ts` but **nothing calls them**. They are kept for reopening password accounts to outside testers, which would need a Credentials provider in `src/auth.ts` and a screen to create accounts.

Route handlers under `/api` call `getSessionUser()` directly and return a bare `401 Unauthorized` when it is null.

---

## 6. The pipeline

`projects.stage` runs 1–6; the UI stepper collapses this into three visible steps.

| `stage` | UI step | What happens |
|---|---|---|
| 1–3 | **Draft & edit** (prepare) | Project created. `prepareSimpleArticleAction` runs the research plan. |
| 4–5 | **Draft & edit** (drafts) | Draft streamed, then refined conversationally. |
| 6 | **Generate images** / **Publish** | Images generated, resized to WebP and stored in R2; article published to the Hub. |

### Stage detail

**Create** (`/new`) — three entry points: a topic, a brief, or a content direction with AI-suggested topics. `generateTopicIdeasAction` uses the Anthropic **web search tool** to propose timely topics; `inferArticleSetupAction` fills setup from a brief. Produces a `projects` row with `selected_topic_json`.

**Research plan** (`prepareSimpleArticleAction`, logic in `lib/pipeline/plan.ts`) — a `runJson` call on the **research** tier with `webSearch: {maxUses: 4}` and a 100s timeout, constrained by a JSON schema of `{title, introAngle, sections[{heading, points[]}], sources[{name, url, whyRelevant}], cta}`. If the searching call fails, runs long, or plans nothing, it **falls back** to a second call without search (40s timeout) that may cite only stable, canonical references — research must improve a draft, never prevent one. An outline with no title or sections is never saved; it throws so the editor can try again. The result is rendered to Markdown and stored as `outline_json` with `approved: true`.

**Draft** (`POST /api/pipeline/[id]/draft`) — streams one article on the **drafting** tier. `maxTokens` is 8000 (12000 for `language: both`) for long-form, 3000/4000 otherwise. On completion it appends a `## Sources` section built from the plan's sources if the writer did not include one, strips em dashes (`deDash`), and upserts the single draft row — snapshotting the previous body into `refinements` first if one existed.

**Refine** (`POST /api/pipeline/[id]/refine`) — rebuilds the exchange as a real conversation: up to `MAX_HISTORY = 8` prior instruction/result turns are replayed as user/assistant messages with a **cache breakpoint on the latest draft**, so prompt caching serves the large prior drafts at ~0.1× instead of re-billing the whole article every turn. Writes two `refinements` rows (the pre-revision snapshot and the result) and updates the draft.

**Images** (`image-actions.ts`) — a visual brief and per-image prompts are generated on the drafting tier, then Fal.ai renders them. Each result is resized to at most 1600px wide and re-encoded to WebP with `sharp` before it is stored in R2; the provider's original is not kept. Logo overlays were retired, so nothing is composited onto an image.

**Publish** (`publish-actions.ts`) — see §8.1.

### Model routing

`lib/ai/models.ts` is the only place a stage is mapped to a model. `research` runs the cheap tier; `outline`, `draft`, `refine`, `imagePrompt` run the drafting tier. Both tiers are DB-configurable via `app_settings`. Thinking is explicitly **disabled** on models that accept it so drafting streams immediately without a leading pause.

### Prompt composition

`buildSystemLayers(ctx)` returns `{shared, context}` — a stable shared layer (system prompt, JSON contract, mode rules) and a per-project context layer (brand, format, project context). Splitting them puts the cache breakpoint after the stable half. `PROMPT_VERSION` is recorded on every usage-log row so prompt edits can be correlated with outcomes.

---

## 7. HTTP surface

All routes except NextAuth's are `runtime = "nodejs"`, `dynamic = "force-dynamic"`. All routes require a signed-in session — **with three exceptions: `/api/cron/autopilot`, which is reached by a scheduler and authenticates with a shared secret instead; `/api/health`, a probe; and `/api/auth/*`, which is NextAuth's own sign-in flow.**

| Method | Path | Body / Params | Response |
|---|---|---|---|
| POST | `/api/pipeline/{projectId}/draft` | — | `application/x-ndjson` stream |
| POST | `/api/pipeline/{projectId}/refine` | `{"message": "…"}` | `application/x-ndjson` stream |
| POST | `/api/topic-ideas` | `{"categoryId"?, "pillarSlug"?, "language"?}` | `application/x-ndjson` stream: `start`, `tick` heartbeats every 4s, then `done` with `topics` or `error` |
| GET | `/api/images/{imageId}` | — | image bytes, `private, max-age=31536000, immutable` |
| GET | `/api/image-references/{id}` | — | image bytes |
| GET | `/api/brand-logo` | — | the brand logo bytes |
| GET | `/api/brand-image/{brandId}` | — | legacy brand avatar bytes |
| POST / GET | `/api/cron/autopilot` | `Authorization: Bearer $CRON_SECRET` | `{"ok":true,"started":0,"advanced":[…],"idle":false}` |
| GET | `/api/health` | — | JSON health report, including `schema` and `commit`; `503` when not healthy (see §10) |
| GET / POST | `/api/auth/*` | — | NextAuth handlers: sign-in, `/api/auth/callback/google`, session |

### NDJSON streaming protocol

Both generation routes emit newline-delimited JSON objects. Parse per line:

```jsonc
{"t":"delta","d":"…text chunk…"}                                  // repeated
{"t":"done","draftId":"uuid","metricLabel":"1,480 words","content":"…full markdown…"}   // draft
{"t":"done","content":"…full markdown…"}                          // refine
{"t":"error","m":"human-readable message"}                        // terminal
```

Client helper: `src/lib/ndjson-client.ts`.

Status codes on the generation routes: `401` no session, `404` project not found, `400` missing outline / empty message / no selected draft, `503` `ANTHROPIC_API_KEY` not configured. Note that a failure *during* streaming arrives as a `{"t":"error"}` line with HTTP 200 already sent — you must handle both.

**`/api/cron/autopilot`** is the only unauthenticated-by-session route in the app, so it is worth being precise about it. No `CRON_SECRET` configured → `503` and it does nothing; wrong or missing bearer token → `401` (compared with `timingSafeEqual`); otherwise it advances whatever autopilot work is in flight and starts a run if one is due, and answers `200` with what it did. `500` means the runner itself could not run — a database that is down, a schema behind the code — never a step that failed, which is recorded on the run instead. It is idempotent: a poke with nothing to do costs one query and returns `idle`. Both methods do the same work; some schedulers only issue `GET`.

### Server actions

Not HTTP endpoints you can call from another origin — Next.js server actions, invoked from this app's own React components with a per-request action id. Listed so you know what logic exists and where:

| File | Actions |
|---|---|
| `app/actions.ts` | `logoutAction` |
| `new/actions.ts` | `inferArticleSetupAction`, `createProjectAction` (topic ideas moved to `POST /api/topic-ideas`) |
| `library/actions.ts` | `deleteArticleAction`, `deleteArticlesAction` |
| `pipeline/[id]/actions.ts` | `prepareSimpleArticleAction`, `goToFinalizeAction`, `generateImagePromptAction`, `reviewBrandAlignmentAction`, `saveDraftContentAction`, `deleteRevisionAction` |
| `pipeline/[id]/image-actions.ts` | `uploadImageReferenceAction`, `findReferenceImagesAction`, `deleteImageReferenceAction`, `generateImagesAction`, `setCoverImageAction`, `coverFromReferenceAction`, `updateCoverCreditAction`, `deleteGeneratedImageAction` |
| `pipeline/[id]/publish-actions.ts` | `ensurePublishDekAction`, `publishToHubAction` |
| `components/settings/actions.ts` | `toggleCategoryAction`, `saveArticleTemplateAction`, `saveModelSettingsAction`*, `saveApiKeyAction`*, `deleteApiKeyAction`*, `saveBrandAction`, `loadSettingsAction` |
| `routines/actions.ts` | `createRoutineAction`*, `updateRoutineAction`*, `toggleRoutineAction`*, `deleteRoutineAction`*, `runRoutineNowAction`*, `stepRunAction`*, `liveRunsAction` |

\* admin-only. Sign-in has no server action: the login page's form calls NextAuth's `signIn("google")` inline.

---

## 8. Integration

### 8.1 The one integration that exists today: Studio → Knowledge Hub

`src/lib/hub.ts` is the whole client. Configuration is environment-only (`HUB_BASE_URL`, `HUB_API_KEY`); there is no UI for it.

**Publish an article**

```http
POST {HUB_BASE_URL}/api/articles/from-markdown
Authorization: users API-Key {HUB_API_KEY}
Content-Type: application/json
```

```jsonc
{
  "title": "Why Most Brand Identities Fail After Launch",
  "tags": ["Visual Identity"],   // EXACTLY ONE, and it must exist in the Hub taxonomy
  "summary": "One-sentence dek.",
  "bodyMarkdown": "## Section…",
  "status": "draft",             // or "published"
  "coverImage": 42               // optional: media id from the upload below
}
```

Response `201`:

```json
{ "id": 17, "slug": "why-most-brand-identities-fail-after-launch",
  "url": "/articles/why-most-brand-identities-fail-after-launch",
  "status": "draft", "thaiTranslated": true }
```

Errors: `401` bad/missing API key · `400` missing title or `tags.length !== 1` · `422` create failed (an invalid tag lands here).

The Hub converts Markdown → Lexical server-side, stores the original Markdown on the doc, and then **auto-translates the article to Thai** as a separate best-effort step after the create commits. A translation failure does not fail the publish.

**Put the cover in the Hub's media library first**

The normal path hands the Hub the cover's public R2 URL and lets the Hub fetch it, because a request body over 4.5MB is refused by Vercel with a `413` before the Hub's route runs, and generated covers grew past that:

```http
POST {HUB_BASE_URL}/api/media/from-url
Authorization: users API-Key {HUB_API_KEY}
Content-Type: application/json

{"url": "https://<R2_PUBLIC_URL>/…", "alt": "…", "filename": "<projectId>-cover.webp"}
```

The Hub only fetches from hosts in its `MEDIA_FETCH_HOSTS`. A `local:` image (development, no R2) has no public URL, so it falls back to a direct upload:

```http
POST {HUB_BASE_URL}/api/media
Authorization: users API-Key {HUB_API_KEY}
Content-Type: multipart/form-data

file=<bytes>   _payload={"alt":"…"}
```

Both return `{doc: {id}}`; pass that id as `coverImage`. A missing or failed cover never blocks publishing — it comes back as a warning. Letting the Hub own the file is what gives it real dimensions and responsive sizes via sharp.

**Taxonomy.** `publishMetadata()` derives `{category: pillarName, tags: [directionName]}` from the project's content direction, but **only `tags` is sent** — the Hub derives its own category from the tag. This matters: Content Studio still models **4 pillars** (`Design`, `New Update`, `Creative Things`, `Design with AI`) while the Hub merged to **3 categories** (`Design`, `Insights`, `Design with AI`). That drift is cosmetic for publishing, because the category is never transmitted.

I verified the tag alignment directly against both sources: **all 34 Content Studio content directions exist as Hub tags**, so no direction can currently produce a 422. If you add a direction on either side, add it on both — `src/lib/content-pillars.ts` here, `cms/src/lib/tags.ts` there.

### 8.2 Calling Content Studio from another app — read this first

**There is no inbound machine API.** Every route handler and every server action authenticates with the NextAuth session cookie (set by a Google sign-in) via `getSessionUser()`/`requireUser()`. There is no API-key header, no bearer token, no service account, no middleware, and no CORS configuration. The only exception is `/api/cron/autopilot`, whose bearer secret drives the autopilot and nothing else. A server-to-server call from another application will receive `401`.

You have four honest options.

**Option A — add an API-key auth path (recommended).** The smallest correct change:

1. Add a `service_tokens` table (or reuse `api_keys` with `provider: "inbound"`), storing a hash of the token, not the token.
2. Write `authenticateRequest(req)` that returns a principal from either the NextAuth session *or* an `Authorization: Bearer …` header, and use it in place of `getSessionUser()` in `src/app/api/**/route.ts`.
3. Add the endpoints an integrator actually needs — realistically `POST /api/projects` (create), `GET /api/projects/{id}` (status + draft), and a webhook or poll for completion. The generation logic already exists in server actions; extract the bodies into `lib/` functions and call them from both.
4. Decide CORS explicitly. Same-origin today, so nothing is set.

Effort: roughly a day for a competent Next.js engineer, most of it in step 3.

**Option B — integrate at the Hub instead.** If the other app only needs *finished articles*, do not integrate with Content Studio at all. Read from the Hub's Payload REST/GraphQL API, which already has real API-key auth (`Authorization: users API-Key …`). Content Studio stays an internal editorial tool. **This is the lowest-effort path and is what the current architecture is shaped for.**

**Option C — read the database.** Both apps can share a Postgres instance; `projects`, `drafts`, and `images` are straightforward to query. Acceptable for reporting and dashboards. Not acceptable for writes — the JSONB documents carry invariants enforced only in application code.

**Option D — run it as a subprocess/container and drive the UI.** Not recommended; listed only for completeness.

### 8.3 If the other app should *receive* generated content

There is no webhook or outbound event system beyond the Hub publish. `publishToHubAction` is the single fan-out point — adding a second destination means adding a client alongside `lib/hub.ts` and calling it there. `published_to_json` is already a map keyed by destination (`{knowledgeHub: url}`), so it was designed for more than one target.

---

## 9. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | production | Postgres/Supabase connection string. **Empty falls back to embedded PGlite in `./data`** — fine for dev, never for production. |
| `AUTH_SECRET` | production | NextAuth's session secret. `openssl rand -hex 32`. Nothing in the app generates one any more. **Changing it logs everyone out.** |
| `AUTH_GOOGLE_ID` | yes | Google OAuth client id. Google is the only way in, in every environment; a production build fails without it. |
| `AUTH_GOOGLE_SECRET` | yes | Paired with the above. The client's authorised redirect URIs must include `{origin}/api/auth/callback/google` for each origin, `http://localhost:3000` included. |
| `ENCRYPTION_KEY` | production | AES key for saved API keys. `openssl rand -hex 32`. **Must stay stable — rotating it makes existing saved keys undecryptable.** |
| `ANTHROPIC_API_KEY` | yes | All text generation. Without it, generation routes return `503`. |
| `HUB_BASE_URL` | for publishing | Hub origin, no trailing slash. |
| `HUB_API_KEY` | for publishing | A Hub `users` API key (the "Content Generator" user). |
| `R2_ACCOUNT_ID` | on Vercel | Cloudflare account that owns the bucket. The five `R2_*` go together: none → images on local disk (refused on Vercel); some → an error naming the rest. |
| `R2_ACCESS_KEY_ID` | on Vercel | R2 API token, "Object Read & Write", scoped to the bucket. |
| `R2_SECRET_ACCESS_KEY` | on Vercel | Paired with the above. |
| `R2_BUCKET_NAME` | on Vercel | The bucket images are written to. |
| `R2_PUBLIC_URL` | on Vercel | The bucket's custom domain, **no path**. Stored rows are this plus the key. Must also be in the Hub's `MEDIA_FETCH_HOSTS`. |
| `CRON_SECRET` | for the autopilot | Shared secret for `/api/cron/autopilot`. `openssl rand -hex 32`. Unset → the endpoint answers `503` and the autopilot cannot run at all. Setting it starts nothing on its own; routines are created and switched on in the Routines tab. |
| `UNSPLASH_ACCESS_KEY` | optional, recommended | Source of reference photographs for "true to life" covers. Without it the app falls back to Openverse, which needs no key. |
| `SKIP_DB_MIGRATE` | recommended in prod | `1` stops every cold start running the migrator. See §10. |
| `DB_FORCE_TRANSACTION_POOLER` | rarely | `1` rewrites a Supabase pooler URL `:5432` → `:6543`. **Off by default deliberately — see §11.** |
| `APP_COMMIT_SHA` | set by the image | The commit a container image was built from, reported by `/api/health` as `commit` and `commitSha`. The Dockerfile sets it from a build argument; Vercel supplies `VERCEL_GIT_COMMIT_SHA` instead. |
| `AUTH_URL` | behind a proxy | The public origin, e.g. `https://article-studio.designally.co`. Required in the container: behind Caddy the standalone server reports `0.0.0.0:3000`, and Google sign-in would be sent back there. Vercel does not need it. |
| `ALLOW_LOCAL_FALLBACKS` | never in a deployment | `1` lets a production process use PGlite, `./data/images` and a generated encryption key. Without it, production refuses all three. For `npm start` on a laptop only. |

If the `R2_*` variables are unset, images are written to `./data/images` and served by the app — in development only. Production refuses, unless `ALLOW_LOCAL_FALLBACKS=1`, and Vercel refuses regardless.

---

## 10. Running, building, deploying

**Local, zero external services:**

```bash
npm install
cp .env.example .env.local     # set AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET; optionally ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000
```

Sign in with a `designally.co` Google account; your user row (an admin) is created on first sign-in. Local sign-in needs `http://localhost:3000/api/auth/callback/google` in the OAuth client's redirect URIs. "Zero external services" means no database, storage or hosting — Google sign-in is still required. PGlite lives in `./data/pg`.

**Migrations:**

```bash
npm run db:generate            # drizzle-kit generate, after editing src/db/schema.ts
npm run db:migrate             # apply against DATABASE_URL
```

**Production migrations are an explicit step, run by hand with the release's own image** — see `docs/deploy-nas.md` §5. Nothing migrates on deploy any more. Until the NAS cutover on 15 September 2026 a `vercel-build` script applied them on every production deploy from `main`; it and `scripts/migrate-deploy.ts` were removed once the NAS owned the schema, so that no deploy anywhere — including the Vercel project kept as an internal clone — can change a database.

That step exists because this failed once in exactly that way: a release added five columns to `image_references`, nothing applied the migration, and every `/pipeline/[id]` answered 500 with `column "origin" does not exist` while `/api/health` reported the database healthy. `GET /api/health` now also reports `schema` — applied migrations against the number the build ships, the names of any that are missing, and `SKIP_DB_MIGRATE` — and returns 503 while the database is behind.

On boot, `getDb()` runs the migrator and seeder automatically **unless `SKIP_DB_MIGRATE=1`**. In a serverless deployment you want it set: every cold start otherwise runs the full migrator (its first statement is `CREATE SCHEMA`), which is pure overhead once the schema is current and multiplies connections during bursts. Apply migrations from a trusted place instead. Migration/seed failures are caught and logged rather than thrown, so a hiccup cannot 500 every request.

**Production is the NAS**, since 15 September 2026: a container from `ghcr.io/designally-co/article-studio`, run by Portainer behind Caddy, released by tagging a commit on `main`. See `docs/deploy-nas.md`. A push to `main` no longer changes the live site on its own.

**Vercel** — the project is kept: first as the rollback, then as an internal clone of the app to try things on. Region `sin1`. Only `main` deploys: `git.deploymentEnabled` in `vercel.json` turns off preview deployments for every other branch. They had failed on every pull request since Google became the only sign-in, because the Preview environment has no `AUTH_GOOGLE_*` — and a preview holding production's variables would share its database. The `Release` GitHub Actions workflow builds every pull request instead.

**The autopilot's scheduler.** Nothing in Vercel drives it usefully: Hobby cron fires roughly once a day and one article takes seven steps, so a run would take most of a week. The Cloudflare Worker in `workers/autopilot-poker` pokes the endpoint every two minutes instead (`*/2 * * * *` in its `wrangler.toml`; it was `*/5` until a measured 25-minute article showed the interval set the pace) — it carries no schedule of its own, only the interval at which the app is asked whether anything is due. It needs two **Worker secrets**: `AUTOPILOT_URL` (`https://<your-app>/api/cron/autopilot`) and `AUTOPILOT_SECRET` (the same value as `CRON_SECRET`). `vercel.json` keeps a daily cron as a backstop.

This replaced a GitHub Actions workflow set to `0,30 * * * *`. Measured over two days, GitHub delivered it every TWO TO FOUR HOURS — 00:27, 08:59, 13:29, 17:25, 20:06, 22:53, 01:04 UTC — because it throttles frequent schedules on shared runners and drops most fires. A routine due at 09:00 therefore sat until a delivery happened to land on it, and the article often appeared only once somebody opened the app, since an open tab steps a run too. Anything that can make an HTTPS request on a timer works here, but it has to actually keep the interval.

**Docker** — multi-stage linux/amd64 build to `.next/standalone`, runs as non-root `nextjs` (uid 1001), exposes 3000, has a `HEALTHCHECK` on `/api/health`, and keeps no state on disk. The image also carries `scripts/migrate.ts`, so a release is migrated by the same image that serves it — as a one-off command, never on start. Building, publishing, the Portainer stack, the scheduler at cutover and rollback are in [docs/deploy-nas.md](docs/deploy-nas.md).

---

## 11. Operational notes and known constraints

Things that will cost you time if you do not know them.

**Supabase pooler mode.** The connection code deliberately does **not** rewrite `:5432` (session mode) to `:6543` (transaction mode), despite that being the usual serverless advice. Against this stack it broke the app: queries Drizzle emits with a parameterised `LIMIT $n` crashed inside `postgres-js` with `Cannot read properties of undefined (reading 'length')`, and other pages hung until Postgres' 120s `statement_timeout`. Session mode is stable. Its ceiling is the pooler's Pool Size — keep that comfortably above peak concurrency (it is set to 40). `getArticleRules()` also avoids a trailing `.limit(1)` for the same reason.

**Connection pool.** `max: 3`, `idle_timeout: 20` per instance, because each serverless worker creates its own client and `postgres-js` defaults to 10 — a handful of concurrent workers otherwise exhaust the pooler with `EMAXCONNSESSION`.

**Generated images are public.** Every image is stored in Cloudflare R2 and served from its custom domain (`R2_PUBLIC_URL`), so its URL works anywhere — the Library and the Hub load images straight from there. Keys are random UUIDs, so an image is unguessable, not secret. `/api/images/[id]` still exists behind a session, as the fallback for `local:` images in development. Publishing hands the Hub the R2 URL, and the Hub copies the file into its own media library.

**Server action body limit** is raised to `3mb` (`next.config.ts`) for brand logo uploads against a 2MB cap.

**Single brand.** `getBrand()` is a singleton. Multi-brand would touch the schema, the prompt layers, and every project load.

**Roles are coarse, and today everyone is an admin.** Every Google sign-in sets `role: "admin"`, so `member` exists only as the column default. `requireAdmin()` guards three settings actions (models, saving and deleting API keys) and six routines actions; everything else is available to any signed-in user, including deleting articles.

**Cost telemetry is recorded but not surfaced.** `api_usage_log` and `pricing` are populated; there is no spend dashboard.

**The autopilot publishes without review.** While it is on, articles reach the Hub with nobody having read them. The brakes are one article per run, never two scheduled articles in flight for the same routine, two retries per step before a run stops, and a limit of five failed starts a day. There is no daily ceiling any more: a routine runs every time its schedule says so. An attempt is counted when a step is picked up rather than when it fails, because a step killed by the platform never reaches any of our code — counting at the end would leave it retrying on every poke forever. For the same reason the runner calls a step off itself, after 150s. The limits in `lib/autopilot/runner.ts` were sized for Vercel's 60s functions (45s a step) and are now sized for the NAS: a poke keeps advancing runs for up to four minutes, and starts another step only while there is still room for the slowest one. Leaving its Hub setting on **draft** keeps one human gate at the far end and costs nothing else. Every run, including failures and their error text, is listed in the Routines tab under the routine that made it; there is no alerting beyond that page.

**Thai.** `language: "both"` doubles `maxTokens`. Separately, the Hub auto-translates on publish. These are two different mechanisms — do not assume one implies the other.

---

## 12. Where to change things

| To change | Edit |
|---|---|
| The article's writing instructions | Settings → Content (writes `app_settings["article.prompt"]`); default in `lib/article-template.ts` |
| Which models run which stage | Settings → API & models (`model.research` / `model.drafting`); routing in `lib/ai/models.ts` |
| Pillars or content directions | `lib/content-pillars.ts` **and** the Hub's `cms/src/lib/tags.ts` |
| Brand voice, terminology, audience | Settings → Brand (`brand_profiles` singleton) |
| System prompt / mode rules | `src/prompts/system.ts` (bump `PROMPT_VERSION`) |
| Per-stage task prompts | `src/prompts/tasks.ts` |
| Publish destination or payload | `lib/hub.ts` + `pipeline/[id]/publish-actions.ts` |
| Image providers | `lib/image/fal.ts`, registered in `lib/image/registry.ts` |
| Adding an inbound API | See §8.2 Option A |
| What a routine does, or how often | The Routines tab. The machine is `lib/autopilot/runner.ts`, the schedule maths `lib/autopilot/schedule.ts`; `workers/autopilot-poker` only decides how often the app is asked, not what runs |

---

## 13. Summary for a decision

If the goal is *"another app should be able to read Designally's articles"* — integrate with the **Knowledge Hub**, not with Content Studio. The Hub already has API-key auth, a REST/GraphQL surface, published/draft states, media handling, and both languages. Content Studio is the authoring tool behind it.

If the goal is *"another app should be able to trigger article generation"* — that capability does not exist yet and needs §8.2 Option A: an inbound auth path plus three or four endpoints wrapping logic that is already written. It is a contained piece of work, not a rewrite.
