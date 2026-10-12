---
title: Article Studio's tables live in the Postgres schema studio, not public
app:
decided: 2026-10-12
author: ai
sources:
  - "Buk, 2026-10-09 (P Aek decided that every Supabase project is combined into Project Friday, the company's one project)"
  - "Buk, 2026-10-12 (agreed to move Article Studio in three phases: code first, then the schema move in the old project, then the copy into Project Friday)"
  - drizzle/0030_tables_in_schema_studio.sql
  - src/db/schema.ts
  - src/db/index.ts
  - scripts/migrate.ts
  - "https://github.com/designally-co/designally-brain/blob/main/docs/app-moves.md"
---

## Context

Article Studio had its own Supabase project, with its 15 tables in `public` and Drizzle's migration history in the schema `drizzle`. It is moving into Project Friday, which already holds other apps' tables (two with the same names as ours, `projects` and `users`) and HR and payroll data. The brain moved there first, into its own schema `brain`, with database users that reach that schema only.

## Decision

Every table is defined in the schema `studio` (`pgSchema("studio")` in `src/db/schema.ts`), and migration 0030 moves the existing tables there with `ALTER TABLE ... SET SCHEMA`, rows, indexes, foreign keys and row-level security included. The migrations' history moves to `studio.__drizzle_migrations`: on the first run after 0030, the migrators copy the old `drizzle.__drizzle_migrations` rows across, timestamps included, so only 0030 runs; the old table is left as it was. They copy it only from Studio's own old layout (its tables still in `public`), and look the old table up in the catalog: in a shared database another app's `drizzle` history must never be adopted, and Studio's user may have no right to open that schema at all. Raw SQL names its tables through the Drizzle table objects, never bare. The move happens in three steps: this code; then migration 0030 on the current production database, in the old project; then copying the `studio` schema into Project Friday, where the app connects as its own user, `studio_app`. That user owns `studio` (so it passes row security with no policies and can run its migrations), reads nothing outside it, and may create schemas, because Drizzle's migrator runs `CREATE SCHEMA IF NOT EXISTS` before every run and PostgreSQL checks that right even when the schema exists. Its setup and the copy are in the Designally Brain repo (`move/sql/studio-app-user.sql`, workflow "Studio move", `docs/app-moves.md`).

## Why

One schema per app keeps the table names apart inside the one shared project, and lets the app connect as a database user that can reach `studio` and nothing else, so it can never read Friday's HR or payroll tables. Keeping the history in `studio` too means everything of Article Studio is in that one schema, so it can be copied and given to its own user as a whole. Moving the tables in the old project first proves the change against the real data before the data changes project.
