---
title: A Cloudflare Worker, not GitHub Actions, pokes Article Studio's autopilot every 2 minutes
app: article-studio
decided:
author: ai
sources:
  - https://github.com/designally-co/article-studio/blob/5bc702305580cf12fde90ed7e19ea2ca137da7f9/INTEGRATION.md?plain=1#L412
  - https://github.com/designally-co/article-studio/blob/5bc702305580cf12fde90ed7e19ea2ca137da7f9/INTEGRATION.md?plain=1#L414
---

## Context

A GitHub Actions workflow was set to run every 30 minutes. Vercel's free cron fires only about once a day.

## Decision

The Cloudflare Worker autopilot-poker calls /api/cron/autopilot every 2 minutes. It carries no schedule of its own; the app decides what is due.

## Why

Measured over two days, GitHub delivered the 30-minute schedule only every two to four hours, because it throttles frequent schedules and drops most of them. Routines due at a set time sat waiting. The interval was later cut from 5 to 2 minutes after a measured 25-minute article showed the interval set the pace.
