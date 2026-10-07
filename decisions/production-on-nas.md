---
title: Article Studio's production moved from Vercel to the Designally NAS
app: article-studio
decided: 2026-09-15
author: ai
sources:
  - https://github.com/designally-co/article-studio/blob/5bc702305580cf12fde90ed7e19ea2ca137da7f9/INTEGRATION.md?plain=1#L408
  - https://github.com/designally-co/article-studio/blob/5bc702305580cf12fde90ed7e19ea2ca137da7f9/docs/deploy-nas.md?plain=1#L1
---

## Context

Article Studio first ran on Vercel.

## Decision

Since 15 September 2026, production is a container from ghcr.io/designally-co/article-studio, run by Portainer behind Caddy on the NAS, released by tagging a commit on main. A push to main no longer changes the live site. The Vercel project is kept as an internal clone.

## Why

