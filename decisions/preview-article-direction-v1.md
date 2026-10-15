---
title: The proposed article direction is tested on a preview branch, with labels, in-body image blocks and Hub upload placeholders
app: article-studio
decided: 2026-10-15
author: ai
sources:
  - Request in the build session, 2026-10-15 (branch preview/article-direction-v1; test of a proposal, not an approved direction)
  - Build session, 2026-10-15 ("have the rights to use online images and give them credits in the resource section"; "no need to ask the user about the right"; "the cover image must be at draft stage too"; "just draft and publish steps"; "when removed, leave the empty slot to add it again"; "the draft must be in edit mode only. user can edit the text at anytime"; "the draft box must be the rich text editor with prefilled generated output"; "when the draft is generated, the image must be already there too (use the image rule) but user must have the freedom to find online, prompt to generate, upload, remove and so on. the rule of having related image is only applied to the auto generated in the first time"; "on desktop, the content must be in the center. equal side paddings"; "simplify the image box"; "when user accidentally delete the title and want to add it back, they have no choice to add the format for the title")
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
- A labelled article has two steps, Draft and Publish. The cover is chosen in Draft, in a card above the article, by the type's cover route; the Image step is not shown.
- The draft box is a rich text editor, filled with the generated article, with a toolbar (normal text, title, section heading, sub-heading, bold, italic, link, lists, quote, undo, redo, Add image). Add image puts a new slot after the block the cursor is in, up to three in any type; a slot's caption and purpose are edited in its card. The content sits centred in the box with equal space on both sides.
- Every image box (the cover and the slots) has one plain layout: no header, status tag or dividers. No visible name ("Cover", "Image 2" read as buttons; build session, 2026-10-15); it stays as the box's accessible name. With a picture, Remove sits on its top-right, and the replace buttons sit under it; empty, only the buttons, centred. A message shows only when something needs attention.
- The type's image rules apply only to the first, automatic fill: once the first draft exists, the cover and every empty block are filled by the rules, once per article (`inputs.imagesAutoFilledAt`). After that every route is the editor's: Find (cited pages, then photo libraries), Generate with their own prompt or one written from the purpose, Draw, Upload, Remove, in any type, a case study included.
- The draft is always editable, in place, with no edit or preview switch: the Tiptap editor (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/markdown`, 3.31.0) edits the article as it reads, loads and saves Markdown, and shows each image block as its card through its own node, which writes the same ```image fence back. Edits save automatically, as manual edits already did.
- Removing a picture keeps its place: a block's Remove clears the picture and leaves the empty block, and only an empty block's Remove takes the slot out; the cover's Remove leaves no cover (every earlier cover goes too, so none comes back by itself). Once there is a cover, its buttons read Find another, Generate new and Upload new.
- Routines may fill only Generate and Draw blocks; no routine creates a labelled article on this branch.

## Why

Designally has the rights to use online images and credits them in References, so the editor is not asked about rights; the cover belongs in the Draft stage, with only Draft and Publish as steps; a removed picture leaves its slot to fill again; and the text can be edited at any time (build session, 2026-10-15). Tiptap was used because the article is stored as Markdown: its Markdown extension reads and writes it, so blocks, checks and publishing are unchanged.

Keeping the labels in the project's JSON and switching on their presence lets the same code run the current and the proposed behaviour side by side, with no Hub change and no change to live routines (request in the build session, 2026-10-15). The upload placeholder was chosen because it was measured: Payload 3.86's `convertMarkdownToLexical`, which the Hub's from-markdown endpoint uses, turns `![media:42]()` alone on a line into an upload node, while a standard `![alt](url)` arrives as literal text, and a placeholder inside a sentence replaces the whole paragraph.
