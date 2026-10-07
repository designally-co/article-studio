# Decision notes

The "why" behind how Article Studio is built. One Markdown file per decision.

Every night the **Designally Brain** reads this folder from `main`. Anyone can then ask it "why is it like this?" in Claude, through the Designally Brain connector.

## When to write one

At the end of a build session, write one note for each decision the session made. The AI working in this repo does this without being asked, and commits the note with the work. There is no approval step: Buk fixes mistakes when they are noticed.

A decision is a choice someone could later ask "why?" about. For example:

- a library, service or tool that was chosen;
- how the data is shaped;
- how the app is deployed or hosted;
- a rule users meet (who can sign in, what is free);
- an approach that was tried and dropped.

Small fixes and routine changes need no note.

## Rules

- **Read the notes here first.** If one already covers the decision, edit it instead of writing a second one.
- **Never guess.** Every fact comes from a source: a link pinned to a commit, a file in this repo, or what a person said in the session (write it as "Buk, 2026-10-07"). If the reason is not clear, ask the person once. If it is still unknown, leave `## Why` empty, and the brain will answer "I do not know". If the date is unknown, leave `decided:` empty.
- **Keep the history.** Git keeps every version. To reverse a decision, write a new note that says what changed and why.
- **No secrets.** No API keys, passwords, tokens, client contact details or personal data. The brain refuses a note that looks like it holds a key or a password.

## Format

File name: lowercase words joined by dashes, for example `routines-step-by-step.md`.

```markdown
---
title: One sentence that names the decision
app: article-studio        # this app; another app's slug only when the decision is about that app
decided: 2026-09-15  # YYYY-MM-DD; empty when unknown
author: ai           # who wrote this note: ai or human
sources:             # where the facts come from
  - https://github.com/designally-co/article-studio/blob/<commit>/README.md?plain=1#L10
  - Buk, 2026-10-07
---

## Context

What was true before, and what problem needed a choice. Optional.

## Decision

What was decided. Required.

## Why

The reasons, as the sources state them. Empty when they do not say.
```

Only these three sections are allowed, each once. The front matter takes only the five keys shown.

The brain checks every note each night. A note that fails the check is not loaded (its earlier version stays in the brain) and the nightly run reports it. The full format is kept in the brain's repo: `designally-co/designally-brain`, file `decisions/README.md`.
