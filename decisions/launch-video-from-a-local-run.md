---
title: The launch video is filmed from a local run of the app, with Claude and Fal.ai mocked
app: article-studio
decided: 2026-10-08
author: ai
sources:
  - Request in the build session, 2026-10-08
  - launch/README.md
---

## Context

Article Studio needed a 25–30 second launch video for LinkedIn that follows one article from topic to the live Hub page. A first cut had been made from real recordings, where each shot showed a different article and the waits were real.

## Decision

The video is filmed by `launch/run.sh` from a local production build of Article Studio and a local Knowledge Hub on a throwaway SQLite database. A mock answers the Claude API and Fal.ai from one fixed article (`launch/story.mjs`), and every other outbound request from the app is blocked. The article is "Why Refillable Packaging Design Is Harder Than It Looks", copied with its cover from the published Knowledge Hub page. Playwright controls the page clock and films 2× screenshots frame by frame. A Python script crops, retimes and scores the frames.

The video opens with a topic being typed into the Create screen (not the Auto Direction ideas search). It has sound: interface effects synthesised in `launch/edit/sound.py` and a voice-over read by Kokoro, an open-source text-to-speech model (Apache 2.0) that runs locally (`launch/edit/voice.py`), with an SRT caption file for LinkedIn. A synthesised music bed was tried and dropped, at the person's request; it is still available with `MUSIC=builtin`. A Higgsfield voice was considered first; the account had 1 credit against a cost of 2.2, and this cloud session could not download Higgsfield's files. The cover image is `launch/assets/cover.png`, which the mock returns as the "generated" image.

## Why

The request said not to run generations against production or spend real Claude or Fal.ai credits, to drive each state deterministically, and to keep the capture and edit scripts in `launch/` so the video can be made again. It also asked for no real emails, keys, error states or third-party stock photos in frame. Typing the topic, adding sound, adding a voice-over, using the free voice, leaving out the music, and using the refillable packaging article (which the person called "already perfect") were the person's choices in the session.
