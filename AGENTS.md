<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Rules this repository learned the hard way

**Never re-export a type from a `"use server"` file.** Not `export type { X }`,
not `export { type X }`. The server-actions transform turns every export of
such a module into a registered server reference — including a type-only one —
and emits a runtime export of a name that exists only in the type system. The
build passes. The module then throws `ReferenceError: X is not defined` the
first time it is evaluated, which in production means every page that imports
it answers 500. A local type alias (`export type X = { … }`) is fine; it is the
re-export of an imported name that breaks.

Shapes that a client component and a server module both need go in a plain
module with no directive — `src/lib/pipeline/views.ts` is the one that exists —
and everyone imports them from there.

**Verify the built app, not just the build.** `next build` succeeded on the
change that shipped the above. Run `next start` and load the pages the change
touches before calling it done. Against local PGlite that is
`ALLOW_LOCAL_FALLBACKS=1 npm start` — a production process otherwise refuses
to run without `DATABASE_URL`.

# Decision notes for the Designally Brain

Before you finish a build session, write a note for each decision the session made, in `decisions/`, and commit it with the work. Do this without being asked; there is no approval step. Format and rules: `decisions/README.md`.

- A decision is a choice someone could later ask "why is it like this?" about: a library or service, the data shape, hosting and deploys, a rule users meet, an approach tried and dropped. Small fixes need no note.
- Read `decisions/` first. If a note already covers it, update that note.
- Never guess. Take facts only from sources: a link pinned to a commit, a file in this repo, or what the person said in the session ("Buk, 2026-10-07"). If the reason is not clear, ask the person once; if it is still unknown, leave `## Why` empty.
- Write `author: ai`. No secrets, passwords, client contact details or personal data.

# Keep `brain.yaml` true

`brain.yaml` at the repo root is how the Designally Brain knows what this app is and does. The Brain reads it from `main` every night, and nothing else updates it: the loader never edits it. So when a change makes anything in it untrue, update it in the same change, without being asked.

- Check it whenever a change touches what a person can do, what the app is for, its address, its stack, its tables or its links to other apps. Examples: a feature added, removed or hidden; a language turned off; a new table; a move to another database.
- Edit only what the change made untrue. Keep the rest exactly as it is, and leave `generated` alone (the person who merges the change checks the file).
- Format: `https://github.com/designally-co/designally-brain/blob/main/docs/brain-yaml.md`. Same rules as the notes: no guessing (unknown stays empty), no secrets, no personal data.
- Name the update in the pull request, so the reviewer checks it.
- Facts that live outside the code (a Portainer or Vercel setting, a release that went live) cannot be seen by the Brain. When the session learns one that matters later, write it in a decision note or in the right doc listed under `docs:` in `brain.yaml`.
- The Brain does not have to wait for the night. After the change is merged into `main`, a person can load it at once: in `designally-co/designally-brain`, open Actions, then **Brain loader**, then **Run workflow** on `main` with mode **load** (the default, `dry-run`, writes nothing). Search by meaning catches up a few minutes later. The AI cannot start it (GitHub refuses with 403). So when a session ends with a merged change the Brain should know about, tell the person they can run it now.
