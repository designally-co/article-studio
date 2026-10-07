---
title: Article Studio database migrations run as their own approved step, never on app start
app: article-studio
decided:
author: ai
sources:
  - https://github.com/designally-co/article-studio/blob/5bc702305580cf12fde90ed7e19ea2ca137da7f9/INTEGRATION.md?plain=1#L404
  - https://github.com/designally-co/article-studio/blob/5bc702305580cf12fde90ed7e19ea2ca137da7f9/README.md?plain=1#L134
---

## Context

A release once added five columns to image_references, nothing applied the migration, and every article page answered 500 while the health check still said the database was healthy.

## Decision

Deployed environments set SKIP_DB_MIGRATE=1. On the NAS a release is migrated as its own approved step with the release's image. The health check now reports which migrations are missing.

## Why

Running the migrator on every cold start is overhead once the schema is current, and the failure above showed a release can reach production without its migration unless the step is explicit and checked.
