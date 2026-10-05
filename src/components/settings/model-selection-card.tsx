"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { saveModelSettingsAction } from "./actions";
import { DEFAULT_RESEARCH_MODEL, DEFAULT_DRAFTING_MODEL, type TextModelOption } from "@/lib/models";
import { Button } from "@/components/ui/button";
import { Section } from "./section";
import { Label } from "@/components/ui/label";

/**
 * Which model does the fast work, and which does the careful work.
 *
 * A NATIVE `select`, LIKE THE ROUTINE SHEET'S. The Radix Select these used
 * could not be opened at all from inside the settings sheet: a Select is itself
 * a modal layer, and nesting one in a Dialog leaves `pointer-events: none`
 * stranded on `document.body` when the two layers disagree about who is
 * closing. Measured with the sheet open — body pointer-events none, the trigger
 * unclickable, one combobox stuck reporting data-state="open" with nothing on
 * screen. Not a styling fault, and not fixable by styling.
 *
 * The routine sheet had already answered this: a plain `select` with the native
 * arrow suppressed and a chevron drawn beside it. It cannot strand anything,
 * it opens on a phone the way a phone expects, and it is the control this
 * product's other sheet already uses.
 *
 * Controlled, with hidden inputs carrying the values: React resets a form after
 * a server action, which would otherwise snap both fields back to their
 * mount-time defaults and make a saved choice look like it had reverted.
 */

/** Matches the routine sheet's field exactly, on the sheet's own ground. */
const FIELD =
  "h-11 w-full min-w-0 cursor-pointer appearance-none rounded-xl border-0 bg-(--sheet-field,var(--surface-deep)) px-4 pr-10 text-sm text-(--sheet-ink,var(--ink)) outline-none focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:2px]";

export function ModelSelectionCard({
  textModels,
  settings,
}: {
  textModels: TextModelOption[];
  settings: Record<string, string>;
}) {
  /* Falling back to `textModels[0]` put BOTH fields on the same model whenever
     nothing was saved — the first name alphabetically, for two jobs chosen for
     being different. The product's own defaults are the honest fallback. */
  const [research, setResearch] = useState(
    settings["model.research"] ?? DEFAULT_RESEARCH_MODEL
  );
  const [drafting, setDrafting] = useState(
    settings["model.drafting"] ?? DEFAULT_DRAFTING_MODEL
  );
  /* Empty means "the same as drafting", which is what wrote image prompts
     before this had its own setting — and stays true if drafting changes. */
  const [image, setImage] = useState(settings["model.image"] ?? "");
  const [saving, startSaving] = useTransition();

  return (
    <Section
      title="Model selection"
      description="Models for fast work, careful writing, and image prompts. The list comes from Anthropic, so new models appear here by themselves."
    >
      {/* SUBMITTED BY HAND, NOT `action=`. A form action resets the form when
          it finishes, and a reset puts every select back on its first option
          — the saved choice stayed saved, but all three fields showed the
          top of the list until the sheet was reopened. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startSaving(() => saveModelSettingsAction(data));
        }}
        className="grid gap-5"
      >
        <input type="hidden" name="research" value={research} />
        <input type="hidden" name="drafting" value={drafting} />
        <input type="hidden" name="image" value={image} />

        {/* SIDE BY SIDE: two parallel choices of the same kind, read as a pair.
            Stacked on a phone, where half the sheet is too narrow for a model
            name. */}
        <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
          <ModelField
            id="model-research"
            label="Research &amp; trends"
            value={research}
            onChange={setResearch}
            options={textModels}
          />
          <ModelField
            id="model-drafting"
            label="Outline, drafts &amp; refinement"
            value={drafting}
            onChange={setDrafting}
            options={textModels}
          />
          {/* Its own row: it reads a reference photograph and briefs a
              picture, and the best model for that may not be the one every
              article is drafted with. */}
          <ModelField
            id="model-image"
            label="Image prompts"
            value={image}
            onChange={setImage}
            options={textModels}
            sameAs={{ label: "Same as drafting" }}
          />
        </div>

        {/* On the right, where every other sheet puts its submit. It saves
            these three models and nothing else in the sheet. */}
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save models"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function ModelField({
  id,
  label,
  value,
  onChange,
  options,
  sameAs,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: TextModelOption[];
  /** An extra first choice that saves nothing of its own, shown with this label. */
  sameAs?: { label: string };
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {/* The chevron is drawn, not a background image: Tailwind cannot parse an
          arbitrary value containing spaces, so a data-URI arrow silently
          computed to `none` and left the control with no affordance at all. */}
      <div className="relative w-full">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={FIELD}
        >
          {sameAs && <option value="">{sameAs.label}</option>}
          {options.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
        />
      </div>
    </div>
  );
}
