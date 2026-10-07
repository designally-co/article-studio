---
title: Article Studio connects through Supabase's session pooler, not the transaction pooler
app: article-studio
decided:
author: ai
sources:
  - https://github.com/designally-co/article-studio/blob/5bc702305580cf12fde90ed7e19ea2ca137da7f9/INTEGRATION.md?plain=1#L424
---

## Context

The usual advice for serverless apps is the transaction pooler (port 6543).

## Decision

Keep the session pooler (port 5432). Switching is possible only with DB_FORCE_TRANSACTION_POOLER, off by default.

## Why

With this stack the transaction pooler broke the app: queries with a parameterised LIMIT crashed inside postgres-js, and other pages hung until Postgres' 120-second timeout. Session mode is stable.
