# Article Studio on the Designally NAS

How Article Studio moves from Vercel to the Designally NAS: Portainer, Caddy,
images from GHCR.

**This document and the pull request that adds it change nothing in production.**
Every step marked **Ake approves** is a gate from the infrastructure runbook,
and nothing past it happens without that approval: deploying, DNS or Caddy,
Portainer access, database transfer or restore, entering or rotating secrets,
calling the production cron, and deleting or resetting data.

No value of any secret appears here, and none should ever be added: not in this
file, the compose file, a pull request, a ticket or a chat.

---

## 1. What runs where

| Part | Today | After cutover |
|---|---|---|
| App | Vercel, `sin1` | Container `article-studio` on the NAS, behind Caddy on `caddy_default` |
| Public URL | `https://article-studio.designally.co` | Unchanged |
| Database | Supabase Postgres, session pooler, 28 migrations | Unchanged. This plan moves the runtime only (see §9) |
| Images | Cloudflare R2, public custom domain | Unchanged |
| Scheduler | Cloudflare Worker `autopilot-poker` every 2 min, plus Vercel cron daily | The Worker only (see §6) |
| Publishing | `https://hub.designally.co` | Unchanged |
| Sign-in | Google OAuth, designally.co only | Unchanged callback (see §7) |

---

## 2. The image

`ghcr.io/designally-co/article-studio:sha-<full 40-character commit>`, linux/amd64.
Images published before the repository was renamed, on 16 September 2026, are
under `ghcr.io/designally-co/content-studio` — including the one production is
running. That package is kept, so a rollback to it needs the image name changed
as well as the tag.
Built by [`.github/workflows/release.yml`](../.github/workflows/release.yml).

**On every pull request** the workflow runs lint, the type check and the
production build. It then builds the image and checks it:

- the image is `linux/amd64` and has a `HEALTHCHECK`;
- no credential-shaped string is in its layer history;
- `scripts/migrate.ts`, run inside the image, applies every migration to a
  throwaway Postgres 17;
- the server starts against that database, and `/api/health` reports:
  - the commit it was built from;
  - the database answering;
  - every migration applied;
  - sharp loading;
  - image storage refusing local disk when R2 is absent.

Nothing is pushed.

**To release**, tag a commit that is already on `main`:

```bash
git tag release-2026-09-22 <full commit>
```

```bash
git push origin release-2026-09-22
```

The same checks run, and the exact image that passed is pushed as
`sha-<commit>`. The run summary records the image, its digest and the commit:
that is the release evidence. A manual run of the workflow on `main` does the
same. There is no `latest` tag, and the publish job refuses a commit that is
not on `main`.

### Where it differs from the runbook's template

- **Dependencies install on the target platform, not `$BUILDPLATFORM`.** `npm ci`
  installs sharp's native binaries for the platform it runs on, so installing on
  an ARM builder would put arm64 binaries in an amd64 image. The release runner
  is amd64, so no emulation is involved.
- **sharp's `@img` packages are copied in whole.** Next's file tracer leaves out
  the libvips library sharp links against, which is why sharp never loaded on
  Vercel. Generated images need sharp, and `/api/health` counts it towards `ok`.
- **The migration command ships in the same image.** It includes `drizzle/`,
  `scripts/migrate.ts`, `postgres` and `drizzle-orm`, so a release is migrated
  by the image that serves it (see §5).
- **The build gets placeholder Google values for one command.** `src/auth.ts`
  refuses a production build without them. They are not credentials, they are
  not kept in the image's environment, and the real values are read at runtime.

---

## 3. The stack

[`deploy/compose.production.yml`](../deploy/compose.production.yml):

- container `article-studio`, `restart: unless-stopped`;
- no published ports, attached to the external `caddy_default` network;
- the runbook's health check;
- logs capped at 3 × 10 MB.

Every value comes from Portainer stack variables. A required variable that is
missing stops the stack from starting.

Caddy, for Ake to add when routing is approved:

```
article-studio.designally.co {
	reverse_proxy article-studio:3000
}
```

---

## 4. Runtime variables

Names only. Values are entered in Portainer by Ake, copied from the current
Vercel production environment. They never pass through Git, tickets or chat.

| Name | Required | Notes |
|---|---|---|
| `IMAGE_TAG` | yes | `sha-<full commit>` from the release run summary. |
| `DATABASE_URL` | yes | Supabase **session** pooler, port 5432. Not the transaction pooler on 6543 (INTEGRATION.md §11). |
| `AUTH_SECRET` | yes | **Copy the exact value.** A different one signs everybody out. |
| `AUTH_GOOGLE_ID` | yes | The existing OAuth client. |
| `AUTH_GOOGLE_SECRET` | yes | The existing OAuth client. |
| `ENCRYPTION_KEY` | yes | **Copy the exact value.** Saved provider keys are AES-256-GCM encrypted with it, and a different value cannot read them. Any plan that would change it is a stop condition. |
| `ANTHROPIC_API_KEY` | yes | All text generation. A rejected key makes `/api/health` 503. |
| `FAL_KEY` | optional | Image generation through fal. |
| `UNSPLASH_ACCESS_KEY` | optional | Reference photographs. Openverse is used without it. |
| `CRON_SECRET` | yes | **Copy the exact value.** It must equal the Worker's `AUTOPILOT_SECRET`, or every poke answers 401. |
| `HUB_BASE_URL` | yes | `https://hub.designally.co` |
| `HUB_API_KEY` | yes | The Hub `users` API key the Vercel deployment uses today. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` | yes | All five. `R2_PUBLIC_URL` must stay the same domain: stored image rows are that domain plus the key. |

The stack sets these itself: `NODE_ENV=production`, `HOSTNAME=0.0.0.0`,
`PORT=3000`, `AUTH_URL=https://article-studio.designally.co` and
`SKIP_DB_MIGRATE=1`. The image sets `APP_COMMIT_SHA`.

**Never set on the NAS:**

- `ALLOW_LOCAL_FALLBACKS` — it re-enables PGlite, local image files and a
  generated encryption key;
- `DB_MIGRATE_ON_BUILD` — Vercel only;
- `DB_FORCE_TRANSACTION_POOLER`.

A production process now refuses to run without `DATABASE_URL`,
`ENCRYPTION_KEY` or R2, instead of quietly using local disk. `/api/health`
names whatever is missing.

---

## 5. Migrations

The container never migrates on start (`SKIP_DB_MIGRATE=1`). Migrations are a
one-off command, run with the release's own image:

```bash
docker run --rm --env DATABASE_URL ghcr.io/designally-co/article-studio:sha-<full commit> node --experimental-strip-types scripts/migrate.ts
```

`--env DATABASE_URL`, with no `=`, passes the value from the environment it is
run in, so the connection string never appears on a command line or in shell
history.

**Ake approves** each run against production. Before it:

- a verified backup;
- the migration count from `/api/health` (`schema.applied`).

After it, `schema.applied` must equal `schema.expected`. This pull request adds
no migrations; production has 28.

**One owner, and only one.** Vercel used to apply migrations on every
production deploy, through a `vercel-build` script. That script and
`scripts/migrate-deploy.ts` are gone: the NAS owns the schema now, and a Vercel
deploy — including the internal clone this project becomes (§9a) — can no
longer change any database.

---

## 6. The scheduler

Routines are driven by `POST /api/cron/autopilot` with `CRON_SECRET`. Today
three things can call it or step a run:

1. **The Cloudflare Worker** `autopilot-poker`, every 2 minutes, at the
   Worker's `AUTOPILOT_URL`.
2. **Vercel cron** (`vercel.json`), daily at 02:00 UTC, as a backstop.
3. **An open browser tab** on a routine, which steps a run too.

After cutover, **the Worker is the only scheduler.**

- **The Worker follows DNS.** If its `AUTOPILOT_URL` is the public hostname, it
  reaches the NAS as soon as DNS and Caddy point there, with no change. It
  cannot be read back, so this needs confirming (§9).
- **Vercel cron does not follow DNS.** It calls the Vercel deployment directly,
  which keeps writing to the same database. It has to be switched off at cutover
  (§8, step 7), as a separate reviewed change: remove the `crons` entry, or
  disconnect or pause the Vercel project.
- **Overlap is safe, but not allowed.** The runner claims a run with
  `FOR UPDATE SKIP LOCKED`, so two schedulers would not step the same run
  twice. The runbook forbids two schedulers regardless.
- **Before DNS moves, nothing pokes the NAS container.** Do not call the
  endpoint by hand to test it without approval.

The NAS has no 60-second function limit. The runner still ends each step at
45 seconds, which remains correct and needs no change.

---

## 7. Sign-in

The Google OAuth callback is
`https://article-studio.designally.co/api/auth/callback/google`. It does not
change as long as the hostname does not.

**`AUTH_URL` is required, and the stack sets it.** Without it, sign-in breaks
behind Caddy. The standalone server reports its own address as
`0.0.0.0:3000`, and Auth.js builds the Google callback from that despite
`trustHost: true`. Google is then sent back to
`https://0.0.0.0:3000/api/auth/callback/google` and refuses. That happened for
a few minutes at cutover on 15 September 2026, until `AUTH_URL` was added.
It is a runtime variable, not a rebuild.

Check it without signing in. `GET /api/auth/providers` must show `callbackUrl`
on `https://article-studio.designally.co`. Then confirm it with the login smoke
test (§10).

---

## 8. Cutover, proposed

Each step waits for the one before it.

1. Merge this pull request. Vercel stays production.
2. Tag a release (§2). Record the image, digest and commit.
3. **Ake approves:** create the Portainer stack with `IMAGE_TAG` and the §4
   variables. Record the rollback point: the current Vercel production
   deployment and its commit.
4. Start the stack. Check health inside the NAS, before any traffic:

   ```bash
   docker exec article-studio wget -qO- http://127.0.0.1:3000/api/health
   ```

   Expect all of these:
   - `ok: true`;
   - `commitSha` equal to the release commit;
   - `schema.applied` = `schema.expected` = 28;
   - `imageStorage.backend: "r2"`;
   - `sharp.ok` and `hub.ok` true.
5. **Ake approves:** the Caddy route and the DNS change.
6. Check public health: `https://article-studio.designally.co/api/health`
   shows the release commit.
7. **Ake approves:** switch off Vercel cron, and disconnect Vercel Git
   deployments. Keep the Vercel project itself for rollback.
8. Run the smoke suite (§10).
9. The agreed observation window.

---

## 9. Rollback

No data moves in this plan. Vercel and the NAS use the same database and the
same R2 bucket.

- **The NAS is unhealthy after routing.** Point DNS back at Vercel, and switch
  Vercel cron back on if it was switched off.
- **A bad release on the NAS.** Set `IMAGE_TAG` to the previous `sha-…` and
  redeploy the stack.
- **A release that ran a migration.** Migrations here are additive, so older
  code still runs. Rolling back across one still needs its own reviewed plan.

---

## 9a. Vercel afterwards: the internal clone

Vercel is kept, not deleted, and it has two jobs that must not overlap in time.

**Until Ake signs off it is the rollback.** That means leaving it as it is now:
the production database, cron off, Git disconnected. Rollback is then one DNS
change away.

**After sign-off it becomes a clone** — a running copy to try things on:

| | Clone |
|---|---|
| Address | the `*.vercel.app` one only; `article-studio.designally.co` stays on the NAS |
| Database | **its own**, never production |
| Cron | **off.** Two schedulers on one database is a stop condition |
| Deploys | from `main`, which is what makes it a clone worth having |
| Images | its own R2 bucket, or accept test images in the real one |
| Hub | its own key, or expect test drafts in the Hub |
| Access | Vercel's deployment protection on |

Migrations are no longer a risk there: the `vercel-build` script is gone, so a
Vercel deploy cannot change any schema (§5).

**Do not convert it before sign-off**, because the day it points at a clone
database it stops being a rollback.

---

## 10. Acceptance

The runbook's smoke suite:

- log in with Google;
- list existing articles and drafts;
- create and save a test draft;
- upload a test image and confirm its R2 URL;
- one controlled AI generation;
- confirm an existing saved provider key still decrypts;
- publish test content to the Hub;
- one controlled routine run (**Ake approves**);
- `/api/health` shows the release commit and 28 migrations.

The release record keeps only redacted evidence. Its fields are listed in the
runbook's "Evidence packet per release".

---

## 11. Open decisions for Ake

- [ ] **Supabase.** Keep the current project for this release, as a
      runtime-only move? Or transfer it? Who owns it, and in which organisation
      and region?
- [ ] **GHCR.** Package visibility for `article-studio`, the package the next
      release publishes to. The registry login Portainer already uses covers
      the organisation; confirm with the first pull under the new name.
- [ ] **Portainer access.** A non-admin account for Buk, limited to this stack.
- [ ] **Secret entry.** Who copies the §4 values from Vercel into Portainer,
      and how, without them passing through chat or tickets.
- [ ] **Worker.** Confirm `AUTOPILOT_URL` is the public hostname, not a
      `*.vercel.app` address.
- [ ] **Vercel.** How long the project stays as the rollback, and when it
      becomes the internal clone instead (§9a) — including which database the
      clone points at.
- [ ] **Resources.** A memory limit for the container on the 4 GB host.
- [ ] **Order with the Hub.** Article Studio publishes to
      `hub.designally.co`. If the Hub moves too, which goes first.
- [ ] **Window.** The maintenance window and the rollback deadline.
