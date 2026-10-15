---
title: The proposed article direction is tested on a preview branch, with labels, in-body image blocks and Hub upload placeholders
app: article-studio
decided: 2026-10-15
author: ai
sources:
  - Request in the build session, 2026-10-15 (branch preview/article-direction-v1; test of a proposal, not an approved direction)
  - Build session, 2026-10-15 ("have the rights to use online images and give them credits in the resource section"; "no need to ask the user about the right")
  - src/lib/direction/labels.ts
  - src/lib/direction/image-routing.ts
  - src/lib/direction/image-blocks.ts
  - src/prompts/direction.ts
  - src/lib/pipeline/image-blocks.ts
  - src/lib/pipeline/publish.ts
  - drizzle/0031_direction_image_blocks.sql
  - https://github.com/designally-co/designally-knowledge-hub/blob/main/cms/src/endpoints/fromMarkdown.ts
---

## Context

A proposal (Labs page "Proposal: one article direction with in-body images") asks for article labels (pillar, type, topic, second topic, keywords), a fixed article shape, type-specific lengths, and up to three body images per article, routed by type and styled by pillar. It is a proposal, not an approved direction, and it had to be tested end to end without touching production, the Hub's taxonomy or the live routines.

## Decision

The proposal is built on the branch `preview/article-direction-v1` and is never merged as is.

- Labels live in the project's `inputs.labels` (JSON), chosen on Create behind a "New direction (preview)" switch: the model proposes them and the editor confirms. Allowed combinations are checked in code, on the client and again on the server. An article without labels keeps the current behaviour everywhere, so one subject can be run both ways. Publishing still sends the one content-direction tag.
- For a labelled article, the proposal's prompts replace the conflicting parts of the current ones (the four old pillars, the 1,200 to 2,000 word template, the draft task); they are not appended.
- Body images are fenced ```image blocks in the draft's Markdown. The draft is normalised in code to what the type allows (count, role, route, ids img-1 to img-3). A filled block is a row in `images` with `position` as its slot; migration 0031 adds `block_id`, `route`, `caption`, `alt`, `credit`, `source_url` and `rights` (nullable, unused by the current behaviour).
- Routes per type are one table (`TYPE_IMAGE_POLICY`). A case study never generates and never uses a stock library, for the cover as well as the body. Draw renders a model-written SVG to an image with sharp, so text in figures never comes from an image model.
- At publish each filled block is uploaded with the Hub's existing `/api/media/from-url` and written as the Hub's own upload placeholder `![media:<id>]()` on its own line, with the caption as an italic line. Its credit ("Image courtesy of …", linked to the page it came from) is added to the article's References, as the cover's credit already is.
- Rights are recorded automatically and the editor is never asked: online images (cited pages and photo libraries) are `licensed`, generated, drawn and uploaded pictures are `own`. An empty block sends the article as a Hub draft whatever was asked for; so would an image marked `unknown` or `permission_pending`, but nothing sets those now.
- Routines may fill only Generate and Draw blocks; no routine creates a labelled article on this branch.

## Why

Designally has the rights to use online images and credits them in References, so the editor is not asked about rights (build session, 2026-10-15).

Keeping the labels in the project's JSON and switching on their presence lets the same code run the current and the proposed behaviour side by side, with no Hub change and no change to live routines (request in the build session, 2026-10-15). The upload placeholder was chosen because it was measured: Payload 3.86's `convertMarkdownToLexical`, which the Hub's from-markdown endpoint uses, turns `![media:42]()` alone on a line into an upload node, while a standard `![alt](url)` arrives as literal text, and a placeholder inside a sentence replaces the whole paragraph.
