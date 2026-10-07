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
