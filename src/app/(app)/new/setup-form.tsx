"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, LoaderCircle, Maximize2, Minimize2, RefreshCw, Sparkle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/page-heading";
import { PageBar, PAGE_ACTION_BUTTON_QUIET } from "@/components/page-bar";
import OrbitingCirclesGlobe from "@/components/ui/orbiting-circles-02";
import { createProjectAction, inferArticleSetupAction } from "./actions";
import { streamNdjson } from "@/lib/ndjson-client";
import { PillarDirectionPicker, pillarIcon } from "./pillar-direction-picker";
import type { TopicIdea } from "@/lib/pipeline/views";

export type PillarGroup = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  directions: { id: string; name: string }[];
};

type Selection = { pillarId: string; directionId: string };

export function SetupForm({ pillars, anthropicReady }: { pillars: PillarGroup[]; anthropicReady: boolean }) {
  const [pending, setPending] = useState(false);
  const [articleInput, setArticleInput] = useState("");
  const [inputExpanded, setInputExpanded] = useState(false);
  const [inputNeedsExpansion, setInputNeedsExpansion] = useState(false);
  const [selection, setSelection] = useState<Selection>({ pillarId: "", directionId: "" });
  const [pickerOpen, setPickerOpen] = useState(false);
  /* THE CARD'S DIRECTION IS ITS OWN. The card asks for ideas; the dock's picker
     says which direction a topic the editor TYPED belongs to. Two questions, so
     two selections — sharing one meant choosing a direction for a brief quietly
     narrowed the ideas the card would find, and the other way round. */
  const [cardSelection, setCardSelection] = useState<Selection>({ pillarId: "", directionId: "" });
  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  // The direction the last ideas request was scoped to, so Regenerate asks the
  // same question again whichever control asked it the first time.
  const [ideasDirectionId, setIdeasDirectionId] = useState("");
  const [topics, setTopics] = useState<TopicIdea[]>([]);
  const [generatingTopics, setGeneratingTopics] = useState(false);
  const [searchSlow, setSearchSlow] = useState(false);
  // The pillar a shortcut card asked for, kept so Regenerate asks again for
  // the same thing rather than silently widening to the whole territory.
  const [ideasPillar, setIdeasPillar] = useState<PillarGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);


  const selectedPillar = pillars.find((pillar) => pillar.id === selection.pillarId);
  const selectedDirection = selectedPillar?.directions.find((direction) => direction.id === selection.directionId);
  const cardPillar = pillars.find((pillar) => pillar.id === cardSelection.pillarId);
  const cardDirection = cardPillar?.directions.find((direction) => direction.id === cardSelection.directionId);
  // The composer owns the page until the editor asks for ideas. From that point
  // the search and its results are the page, and the way back is explicit.
  const showComposer = topics.length === 0 && !generatingTopics;
  const hasInput = articleInput.trim().length > 0;
  const ideasBusy = generatingTopics || pending || !anthropicReady;

  /* THE DOCK'S HEIGHT USED TO BE MEASURED, because the composer was centred on
     the viewport and the maths needed half of it. Anchored to the foot instead,
     nothing downstream depends on the number — so the ResizeObserver, the state
     it fed and the custom property it wrote all went with it. */

  // Live web search makes this call slow enough that a second, honest message
  // is worth more than a spinner that says nothing after the first few seconds.
  useEffect(() => {
    if (!generatingTopics) return;
    const timer = setTimeout(() => setSearchSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [generatingTopics]);

  /* Two ways in. The "No topic yet?" card asks within the direction its own
     dropdown is set to, or the whole territory on Auto. A pillar pill asks
     within that pillar and ignores any direction — the pill is the scope.
     Neither reads the dock's picker, which belongs to a typed topic.

     Called with no arguments (Regenerate), it repeats the last request's
     scope. */
  async function generateTopics(
    pillar: PillarGroup | null = ideasPillar,
    directionId: string = ideasDirectionId
  ) {
    setGeneratingTopics(true);
    setSearchSlow(false);
    setError(null);
    setIdeasPillar(pillar);
    setIdeasDirectionId(pillar ? "" : directionId);
    const body = {
      categoryId: pillar ? undefined : directionId || undefined,
      pillarSlug: pillar?.slug,
      language: "en",
    };
    try {
      const result = await requestTopicIdeas(body);
      if (result.length === 0) throw new Error("No topic ideas were returned. Try again or choose a direction.");
      setTopics(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not generate topic ideas.");
    } finally {
      setGeneratingTopics(false);
    }
  }

  /* OVER A STREAM, WITH ONE RETRY. The ideas used to come back from a Server
     Action that said nothing for the whole 20–35 seconds the model took, and
     on a phone that silence is what the network gives up on — Safari reports
     it as "Load failed" and the function log shows nothing, because the
     function was still running when the phone stopped listening. The route
     sends a heartbeat every few seconds instead, so the connection is never
     idle. If the connection still drops (a tunnel, a network handoff), the
     request is made once more before the editor is told. */
  async function requestTopicIdeas(body: Record<string, unknown>, attempt = 1): Promise<TopicIdea[]> {
    try {
      for await (const event of streamNdjson<{ t: string; topics?: TopicIdea[]; m?: string }>("/api/topic-ideas", body)) {
        if (event.t === "done") return event.topics ?? [];
        if (event.t === "error") throw new Error(event.m || "Could not generate topic ideas.");
      }
      throw new Error("The connection closed before any ideas arrived. Try again.");
    } catch (reason) {
      // A TypeError from fetch is the network, not the server: "Load failed"
      // on WebKit, "Failed to fetch" on Chromium. Anything else is an answer.
      if (reason instanceof TypeError && attempt < 2) return requestTopicIdeas(body, attempt + 1);
      if (reason instanceof TypeError) throw new Error("The connection dropped before the ideas arrived. Check your signal and try again.");
      throw reason;
    }
  }

  async function submitArticle(topic?: TopicIdea) {
    const text = topic?.title ?? articleInput.trim();
    if (!text || pending) return;
    setPending(true);
    setError(null);

    try {
      const setup = topic
        ? {
            inputKind: "topic" as const,
            directionId: topic.directionId,
            directionName: topic.directionName,
            workingTitle: topic.title,
          }
        : await inferArticleSetupAction({ text, categoryId: selection.directionId || undefined });

      const data = new FormData();
      data.set("articleMode", "editorial");
      data.set("language", "en");
      data.set("articleInput", topic ? "" : text);
      data.set("inputKind", setup.inputKind);
      data.set("workingTitle", setup.workingTitle);
      data.set("categoryId", setup.directionId);
      if (topic) {
        data.set("chosenTopic", topic.title);
        data.set("chosenAngle", topic.angle || "");
        data.set("chosenWhyTimely", topic.whyTimely || "");
        data.set("chosenSearchIntent", topic.searchIntent || "");
        data.set("chosenResearchSources", JSON.stringify(topic.researchSources || []));
      }
      await createProjectAction(data);
    } catch (reason) {
      setPending(false);
      setPickerOpen(true);
      setError(reason instanceof Error ? reason.message : "Could not create the article. Choose a direction and try again.");
    }
  }

  /* THE LIST IS A PAGE, NOT A STATE OF THE COMPOSER. It used to render inside
     the composer's column with a heading of its own invention, so it was the
     one list in the app that did not look like Library or Routines. It now
     opens the way those two do: the name in the bar on a phone, the heading
     with its deck and its actions on one line on a desktop, the same container,
     and one card per idea in the card the routines use. */
  if (topics.length > 0) {
    const directionCount = new Set(topics.map((topic) => topic.directionName)).size;
    const deck = `${topics.length} ideas across ${directionCount} direction${directionCount === 1 ? "" : "s"}${ideasPillar ? ` in ${ideasPillar.name}` : ""}`;
    const startOver = () => {
      setTopics([]);
      setError(null);
    };
    return (
      <div className="mx-auto w-full max-w-7xl px-3 pb-24 pt-4 sm:px-8 sm:pt-14 lg:px-12 xl:px-16">
        <div className="w-full space-y-4">
          {/* The phone's one action is another set; the way back is at the foot
              of the list, where you arrive having read it. */}
          <PageBar
            title="Ideas"
            action={
              <button
                type="button"
                onClick={() => void generateTopics()}
                disabled={ideasBusy}
                aria-label="Regenerate ideas"
                title="Regenerate ideas"
                /* The quiet disc, like Library's search: another set of ideas
                   commits nothing, and the accent is for the press that does. */
                className={PAGE_ACTION_BUTTON_QUIET}
              >
                <RefreshCw aria-hidden className="size-5" />
              </button>
            }
          />

          <div className="hidden lg:mb-10 lg:block">
            <PageHeading
              title="Ideas"
              description={deck}
              actions={
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={startOver} disabled={pending}>
                    Start over
                  </Button>
                  <Button type="button" onClick={() => void generateTopics()} disabled={ideasBusy}>
                    Regenerate
                  </Button>
                </div>
              }
            />
          </div>

          {error && (
            <p className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</p>
          )}

          {/* One card per idea, and the title is the control — the same shape
              Routines uses: a stretched pseudo-element under the whole card,
              so the accessible name is the idea rather than a card's worth of
              text.

              THE RECOMMENDATION IS THE LINE, NOT A WORD. The lead idea draws
              its hairline in a light tint of the accent instead of carrying
              a "Recommended" tag: the same 1px, one colour off, which is
              enough to pick it out of a column without adding a label to
              read. The 300 step, not the fill: at full strength the line
              read as a warning, and a hairline needs far less colour than a
              button does to be seen. No arrow: on a
              card that is entirely a target it was saying what the card's
              shape already says. The direction is a chip, the one the
              publish stage uses, under the text. */}
          {topics.map((topic, index) => {
            const lead = index === 0;
            const sources = topic.researchSources?.map((source) => source.name).join(", ") || null;
            return (
              <section
                key={`${topic.title}-${index}`}
                style={{ animationDelay: `${Math.min(index, 7) * 45}ms` }}
                className={`relative rounded-2xl border bg-surface p-3.5 transition-shadow duration-(--duration-base) ease-(--ease-out) hover:shadow-[var(--shadow-card)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both motion-safe:duration-300 sm:p-5 ${lead ? "border-(--orange-300)" : "border-line"}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="max-w-3xl text-balance font-heading text-[length:var(--text-h3)] font-medium leading-snug tracking-tight text-ink">
                      <button
                        type="button"
                        onClick={() => void submitArticle(topic)}
                        disabled={pending}
                        className="rounded-sm text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:2px] disabled:cursor-not-allowed"
                      >
                        {topic.title}
                      </button>
                    </h3>
                    {topic.angle && (
                      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-2">{topic.angle}</p>
                    )}
                    {/* The lead entry makes the full case; the rest give just
                        enough to judge. */}
                    {lead && topic.whyTimely && (
                      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-2">{topic.whyTimely}</p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="inline-flex items-center rounded-full bg-sunken px-2.5 py-1 text-xs font-semibold text-ink-2">
                        {topic.directionName}
                      </span>
                      {sources && <span className="text-xs font-semibold text-ink-3">{sources}</span>}
                    </div>
                  </div>
                </div>
              </section>
            );
          })}

          {/* The way back, on a phone. The desktop heading carries it. */}
          <div className="pt-2 lg:hidden">
            <Button type="button" variant="outline" className="w-full" onClick={startOver} disabled={pending}>
              Start over
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submitArticle();
      }}
      /* 12 on a phone, like every other page. This one was still on 16, which
         is 8px of the headline's measure spent on gutters wider than the ones
         the rest of the app settled on. */
      /* A COLUMN THE HEIGHT OF THE SCREEN, so the composer can sit at the foot
         of it without anybody having to compute where the foot is. The old
         layout centred the dock on `50svh` and hung the headline off its top
         edge, which is why the dock's height had to be measured: half of it
         was a term in the offset. Flex does the same arithmetic without being
         told the number. */
      /* THE FOOT IS THE FOOT ON EVERY SCREEN. The dock used to centre with
         the welcome above `lg`; now it sits at the bottom everywhere, the
         way a chat composer does, and the padding under it is the same kind
         of gutter at every size — room to breathe, not a shelf. There is no
         caption under the dock any more, so nothing else claims that space.

         `dvh`, NOT `svh`, ON A PHONE. Safari's small viewport is measured
         against its bottom bar at full height, and the bar is compact almost
         all of the time — so `100svh` stopped some 40px short of the bar and
         the dock hung above it over nothing. `dvh` is the viewport as it is
         right now. The page is locked so the bar never collapses on scroll,
         which is what makes the dynamic unit stable enough to build on. */
      className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-7xl flex-col px-3 pb-4 sm:px-6 sm:pb-8 lg:min-h-svh lg:px-12 lg:pb-10 xl:px-16"
      /* The composer and the search stage fill the screen exactly, so on a
         phone the page is locked in its frame while either is up (see the
         rule in globals.css). The list of ideas is its own page, rendered
         above instead of this form, and carries no marker: it is taller than
         the screen by design. */
      data-fits-viewport=""
    >
      {/* TWO MEASURES. The composer is a place to write, so it takes the wider
          column; the question, the card and the pillars above it are read at a
          glance and sit on a narrower one centred over it. */}
      <div className="mx-auto flex w-full max-w-[62rem] flex-1 flex-col">
        {showComposer && (
        /* ONE ARRANGEMENT AT EVERY SIZE. The dock goes to the foot and the
           welcome — headline and the four pillar cards — centres in whatever
           is left above it. This used to switch at `lg` to centring the pair
           together, on the grounds that a field pinned to the floor of a tall
           window is a long way from its headline; with the cards between them
           the welcome is tall enough to carry the eye down, and a composer at
           the bottom is where a composer is expected. */
        <section className="relative flex flex-1 flex-col">
          {/* THE WELCOME KEEPS THE SPACE ABOVE, and is centred in whatever is
              left once the dock has taken the foot — so it holds its place on
              the screen rather than riding down with the thing it used to hang
              off. `pb` keeps it from settling onto the dock when the field
              grows and the space above shrinks. */}
          <div className="flex flex-1 items-center justify-center pb-10 sm:pb-14">
          <div className="w-full text-center">
            {!anthropicReady && (
              <div className="mb-6 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3.5 text-left text-sm text-ink-2">
                <strong>No Anthropic API key is configured.</strong> Article generation will be unavailable until <code>ANTHROPIC_API_KEY</code> is configured.
              </div>
            )}
            {/* One line, one colour. The supporting sentence moved into the
                field's own placeholder, where it explains the input at the
                moment the editor is looking at the input. */}
            {/* WIDER THAN THE COLUMN'S DEFAULT MEASURE. A headline is not body
                text — it is read in one glance rather than line by line — and
                at 2xl this one broke across two lines on a phone with room to
                spare on both sides of it. */}
            <h1 className="mx-auto max-w-3xl font-heading text-[length:var(--text-h1)] font-medium leading-[1.1] tracking-[-0.02em] text-ink motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200 sm:text-balance sm:text-[length:var(--text-hero)]">
              {/* BROKEN WHERE THE SENTENCE BREAKS, on a phone. `text-balance`
                  was evening the two lines by width and landing on "What
                  should the / industry read next?" — which splits the subject
                  from its verb and puts the emphasis on "industry" rather than
                  on what is being asked. It was never a width problem: at this
                  size "What should the industry" is 249px in a 351px column.

                  So the break is stated, and balance is left to `sm` and up
                  where the line does not need one — above `sm` the whole
                  question fits on a single line and the `br` is not rendered. */}
              What should the industry{" "}
              <br className="sm:hidden" />
              read next?
            </h1>

            {/* AS WIDE AS THE FOUR PILLS, on a desk. The pills hug their labels
                and hold one line, and this column shrinks to fit them, so the
                card above is exactly the row's width. On a phone the column is
                the screen's and the pills wrap. */}
            <div className="mx-auto mt-8 w-full text-left sm:mt-10 sm:w-fit">
              {/* THE WAY IN FOR SOMEBODY WITH NOTHING TO TYPE. It was the dock's
                  orange Generate button, which put "I have no topic" in the one
                  place built for having one. It is its own card now, above the
                  pillars it widens: the whole territory, or the direction the
                  composer's picker is set to. The picture is what the ideas
                  turn into — finished brand work — and it is decoration, so it
                  is hidden from assistive technology. */}
              <div
                className="cs-idea-card motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both motion-safe:duration-300"
              >
                <IdeaCardArt />
                <div className="cs-idea-card-copy">
                  {/* THE CARD IS THE BUTTON. Its sentence is the control, and an
                      ::after stretches it over the whole card, so pressing
                      anywhere on the card asks for ideas — the same shape the
                      ideas list uses for a card whose title is its link. */}
                  <button
                    type="button"
                    onClick={() => void generateTopics(null, cardSelection.directionId)}
                    disabled={ideasBusy}
                    className="cs-idea-card-title"
                    aria-label={
                      cardDirection
                        ? `Generate ideas in ${cardDirection.name}`
                        : "Generate ideas with auto direction"
                    }
                  >
                    {/* WHAT PRESSING IT DOES, not an invitation to press. The
                        ideas come from a live search of recent creative-industry
                        sources, so the line says where they come from. */}
                    No topic yet?
                    <br />
                    Find one in the latest news
                  </button>
                  {/* WHICH DIRECTION, CHOSEN BEFORE PRESSING. Auto until somebody
                      picks one, and then it says which — the pill is the value
                      and the way to change it. It sits above the card's stretched
                      button as a control of its own, with a selection of its own:
                      the dock's picker is for a typed topic and does not move it. */}
                  <PillarDirectionPicker
                    pillars={pillars}
                    selection={cardSelection}
                    open={cardPickerOpen}
                    onOpenChange={setCardPickerOpen}
                    onChange={setCardSelection}
                  >
                    <button
                      type="button"
                      className="cs-idea-card-btn"
                      aria-label={`Content direction for ideas: ${cardDirection?.name ?? "Auto direction"}`}
                    >
                      {cardPillar ? (
                        (() => {
                          const Icon = pillarIcon(cardPillar.slug);
                          return <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.8} />;
                        })()
                      ) : (
                        /* THE STAR FOR "AUTO" — the same mark the dock's picker
                           and the menu's Auto direction row wear, so the three
                           read as one control. Filled and unstroked for the
                           reason given at the dock: an outlined four-point star
                           this small closes up into a cross. A chosen direction
                           swaps it for that pillar's icon. */
                        <Sparkle aria-hidden className="size-4 shrink-0" fill="currentColor" strokeWidth={0} />
                      )}
                      <span className="min-w-0 truncate">{cardDirection?.name ?? "Auto Direction"}</span>
                    </button>
                  </PillarDirectionPicker>
                </div>
              </div>

              {/* ONE PILL PER PILLAR. Each asks for ideas from across that
                  pillar — narrower than "anything", wider than one direction —
                  in the pillar doc's own order. Pills rather than the tinted
                  cards they were: under the card they are its options, and a
                  second row of cards would read as four more of it. They wrap
                  on a phone and hold one line on a desk. */}
              {/* One line on a desk — the line whose width the column takes. */}
              <div className="mt-3 flex flex-wrap gap-2.5 sm:flex-nowrap">
                {pillars.map((pillar, index) => {
                  const Icon = pillarIcon(pillar.slug);
                  return (
                    <button
                      key={pillar.id}
                      type="button"
                      onClick={() => void generateTopics(pillar, "")}
                      disabled={ideasBusy}
                      data-pillar={pillar.slug}
                      style={{ animationDelay: `${60 + index * 45}ms` }}
                      className="cs-pillar-chip motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both motion-safe:duration-300"
                      aria-label={`Generate ideas from the ${pillar.name} pillar`}
                    >
                      <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.8} />
                      {pillar.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          </div>

          {/* ABOVE THE DOCK, NOT BELOW IT. The dock is the last thing on the
              screen, so an answer to something the editor just did has to
              land where the eye already is — between what they pressed and
              what they will press next — rather than under the foot, where on
              a locked phone screen it was pushing the dock up off its edge. */}
          {error && (
            <p className="mb-4 shrink-0 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</p>
          )}

          {/* AT THE FOOT. `shrink-0` so the dock keeps its own height while the
              block above gives up whatever the column needs. */}
          <div className="relative shrink-0">
          {/* Sibling, not child: as a child it would paint over the dock's own
              white background instead of sitting behind it. */}
          <div aria-hidden className="cs-dock-glow" />

          <div className="cs-dock">
            <label className="sr-only" htmlFor="article-input">Topic or article brief</label>
            <div className="cs-dock-input-viewport">
            <textarea
              ref={inputRef}
              id="article-input"
              name="articleInput"
              /* Matches the CSS floor, so the first paint and every paint
                 after it agree — `rows` sets the intrinsic height before the
                 `input` handler has ever run. */
              rows={2}
              value={articleInput}
              onChange={(event) => setArticleInput(event.target.value)}
              onInput={(event) => {
                const field = event.currentTarget;
                field.style.height = "auto";
                const needsExpansion = field.scrollHeight > 320;
                setInputNeedsExpansion(needsExpansion);
                if (!needsExpansion && inputExpanded) setInputExpanded(false);
                field.style.height = `${inputExpanded ? field.scrollHeight : Math.min(field.scrollHeight, 320)}px`;
              }}
              className={`cs-dock-input ${inputNeedsExpansion ? "cs-dock-input--scrollable pr-12" : ""} ${inputExpanded ? "max-h-none" : ""}`}
              placeholder="Describe a topic, or paste a full brief…"
            />
            </div>
            {inputNeedsExpansion && (
              <button
                type="button"
                onClick={() => {
                  const nextExpanded = !inputExpanded;
                  setInputExpanded(nextExpanded);
                  requestAnimationFrame(() => {
                    const field = inputRef.current;
                    if (!field) return;
                    field.style.height = "auto";
                    field.style.height = `${nextExpanded ? field.scrollHeight : Math.min(field.scrollHeight, 320)}px`;
                    field.focus();
                  });
                }}
                className="absolute right-3 top-3 grid size-10 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                aria-label={inputExpanded ? "Collapse article input" : "Expand article input"}
                aria-controls="article-input"
              >
                {inputExpanded ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}
              </button>
            )}
            <div className="cs-dock-controls">
              <PillarDirectionPicker
                pillars={pillars}
                selection={selection}
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                onChange={(next) => {
                  setSelection(next);
                  setTopics([]);
                }}
              >
                <button
                  type="button"
                  // A chosen direction is a setting, not an achievement: it reads
                  // as full ink against the muted default, the way a select shows
                  // a value against its placeholder. No accent, no fill, no rule
                  // — which also puts its icon back on the field's 16px gutter.
                  /* A DISC UNTIL THERE IS SOMETHING TO SAY. "Auto direction"
                     is the absence of a choice, and printing the absence took
                     a third of the dock's control row to tell the reader that
                     nothing had happened — beside a placeholder that is
                     already telling them what to do. As a disc it is the
                     affordance without the announcement; the moment a
                     direction is picked, the control becomes a pill and says
                     which, because now there IS something to say.

                     Both states are 40 tall, so choosing a direction does not
                     change the height of the row the dock's actions sit on. */
                  className={`inline-flex items-center rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                    selectedDirection
                      ? "min-h-10 max-w-[55%] gap-2 px-3"
                      : "size-10 justify-center"
                  } ${
                    /* FILLED, LIKE EVERY OTHER DISC IN THE APP. Transparent, it
                       was a control you had to already know was there — a bare
                       icon on the dock's white ground with nothing to say where
                       its edges are, which matters more now that the default
                       state has no label to give it a shape. The close discs'
                       grey, on the same white it sits on there. */
                    pickerOpen
                      ? "bg-chrome-active text-ink"
                      : `bg-chrome hover:bg-chrome-active hover:text-ink ${selectedDirection ? "text-ink" : "text-ink-2"}`
                  }`}
                >
                  {selectedPillar ? (() => {
                    const Icon = pillarIcon(selectedPillar.slug);
                    return <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.8} />;
                  })() : (
                    /* ONE STAR, AND FILLED. `Sparkles` was three shapes at
                       three sizes in a 16px space, which renders as a smudge
                       rather than as a mark. The singular is the same idea
                       drawn once — and solid rather than outlined, because a
                       four-pointed outline at 16px is mostly the hole in the
                       middle: the stroke has to describe eight edges around a
                       shape too small to hold them, and what survives is a
                       blur. Filled, it is one silhouette at any size.

                       AND NO STROKE AT ALL. Filled AND stroked, a 1.5px
                       outline runs around all eight edges of a 16px star and
                       fattens its waist until the concave curves between the
                       points close up — at which point it is a plus sign. The
                       fill alone keeps those curves, which are the entire
                       difference between a star and a cross.

                       `fill` and `strokeWidth` as attributes rather than
                       classes, since lucide ships `fill="none"` and a stroke
                       width on the svg itself, and a utility would be fighting
                       an attribute. 20px, half the disc, because the taper
                       between the points is the whole shape and it needs room
                       to be seen — at 16 it is a cross with soft corners. */
                    <Sparkle aria-hidden className="size-5 shrink-0" fill="currentColor" strokeWidth={0} />
                  )}
                  {/* KEPT, NOT REMOVED, when the control is a disc: a button
                      whose only content is a decorative icon has no accessible
                      name at all. `sr-only` leaves the name for anyone not
                      reading it off the screen. */}
                  <span className={selectedDirection ? "truncate" : "sr-only"}>
                    {selectedDirection?.name ?? "Auto direction"}
                  </span>
                  {/* NO CHEVRON. It only ever appeared in the selected state,
                      where the pill is already the odd shape out in the dock
                      and the name inside it is plainly a value rather than a
                      label — nothing else here needs an arrow to say it can be
                      pressed. In the default state there was never room for
                      one, so it was marking the state that needed it least. */}
                </button>
              </PillarDirectionPicker>
              {/* ONE SEND, ALWAYS IN THE CORNER. Asking for ideas moved up into
                  the "No idea?" card, so the dock does one thing: send what was
                  written. With nothing written it is a quiet grey disc that
                  cannot be pressed; the moment there is a topic it takes the
                  accent, which is the signal that it now goes somewhere. */}
              <button
                type="submit"
                disabled={pending || !hasInput}
                className="cs-dock-send"
                aria-label={pending ? "Creating article" : "Continue to draft"}
                title={pending || !hasInput ? undefined : "Continue to draft"}
              >
                {pending
                  ? <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
                  : <ArrowUp aria-hidden className="size-5" strokeWidth={2} />}
              </button>
            </div>
          </div>
          </div>
        </section>
        )}

          {/* The search stage is sized to the viewport, so it takes no top
              offset and cancels the form's bottom padding exactly (pb-4/8/10
              above) — otherwise that padding counts as content and pushes the
              stage upward. The list of ideas is its own page above. */}
          <div className={showComposer ? "mt-6" : "-mb-4 sm:-mb-8 lg:-mb-10"}>
          <div aria-live="polite">
          {generatingTopics ? (
            /* The globe orbits the very publications this call is searching, so
               it reports the work rather than decorating the wait. The text
               carries it for anyone on reduced motion, where it sits still.

               No card. The globe is a horizon composition — its sphere is
               centred on its own bottom edge, so the lower half is clipped, and
               a card was only ever there to give that clip an edge to land on.
               A mask dissolves the cut instead, which frees the stage to sit on
               the canvas and centre itself the way the composer it replaced did. */
            /* TWO COMPOSITIONS. On a phone the stage is the screen: the globe
               sits on the bottom edge, edge to edge, its horizon on the edge
               itself so the screen is the cut and no mask is needed, and the
               text centres in the room above it. On a desktop the pair centres
               together as before, with the mask dissolving the sphere's lower
               half into the canvas.

               The exact height (viewport minus the 3rem strip) rather than a
               minimum: a minimum would let the globe push the column taller
               than the screen, and the page is locked, so anything past the
               edge is simply gone. */
            <div className="flex h-[calc(100dvh-3rem)] flex-col text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200 lg:h-auto lg:min-h-svh lg:items-center lg:justify-center">
              <div className="flex min-h-0 flex-1 items-center justify-center px-6 lg:flex-none">
                <div>
                  <p className="font-heading text-[length:var(--text-h2)] font-medium leading-tight tracking-tight text-ink">
                    Searching creative-industry sources…
                  </p>
                  <p className="mx-auto mt-2.5 min-h-6 max-w-md text-balance leading-relaxed text-ink-2">
                    {searchSlow ? "Still searching — this can take up to a minute." : "Reading what has actually happened recently."}
                  </p>
                </div>
              </div>
              {/* Negative margins undo the form's side gutters (px-3, sm:px-6)
                  so the rings run under both edges of the phone. Above `lg`
                  the column is narrower than the window anyway, so the gutters
                  stay and the mask returns. */}
              <div className="-mx-3 shrink-0 sm:-mx-6 lg:mx-0 lg:mt-10 lg:w-full lg:[mask-image:linear-gradient(to_bottom,#000_72%,transparent_100%)]">
                <OrbitingCirclesGlobe />
              </div>
            </div>
          ) : null}
          </div>

          </div>
      </div>
    </form>
  );
}

/**
 * The picture in the "No topic yet?" card: finished brand work — posters, cards,
 * a newsletter — which is what an idea turns into. Decoration, so it has empty
 * alternative text and is hidden from assistive technology.
 *
 * A plain `img` rather than `next/image`: it is already a compressed JPEG, and
 * it is one picture on one page. The artwork arrived on black; the black around
 * and between the posters was replaced with white so it sits on the white card.
 */
function IdeaCardArt() {
  return (
    <div aria-hidden className="cs-idea-card-art">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="cs-idea-card-art-image"
        src="/create/no-idea.jpg"
        alt=""
        width={1200}
        height={800}
        decoding="async"
      />
    </div>
  );
}
