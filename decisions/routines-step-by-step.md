---
title: Article Studio's routines write an article in small steps, each started by a poke from outside
app: article-studio
decided:
author: ai
sources:
  - https://github.com/designally-co/article-studio/blob/5bc702305580cf12fde90ed7e19ea2ca137da7f9/README.md?plain=1#L196
---

## Context

A full article takes seven model and provider steps and several minutes. On Vercel, a function gets 60 seconds.

## Decision

A routine run is a state machine stored in routine_runs. Each call to /api/cron/autopilot moves runs forward a step at a time.

## Why

A crashed run resumes where it stopped instead of being lost, and two schedulers arriving at once cannot advance the same run twice. Steps were split further where one step took too long: the cover is three steps because doing it in one took 46 seconds and was killed every time.
