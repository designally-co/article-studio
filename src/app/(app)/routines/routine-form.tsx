"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Dialog, Collapsible } from "radix-ui";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/switch";
import {
  TIME_ZONES,
  WEEKDAY_NAMES,
  ordinal,
  type RoutineScheduleKind,
} from "@/lib/autopilot/schedule";
import type { RoutineView } from "@/lib/autopilot/views";
import { PAGE_CLOSE_BUTTON } from "@/components/page-bar";
/* Title and Close still come from Radix: they read the Dialog context the
   shell provides, so they work anywhere inside it. */
import { SheetDialog } from "@/components/sheet-dialog";

/**
 * One routine's settings, as a dialog.
 *
 * The same form creates and edits — the only difference is a hidden id and
 * which action it posts to — because two forms that must stay identical
 * eventually stop being identical.
 *
 * WHAT IT IS BEFORE WHEN IT RUNS. Name, then description, then the schedule:
 * the description used to sit at the bottom under the heading "Prompt", which
 * put the sentence explaining a routine below every mechanical detail of it.
 * You decide what a thing is for before you decide what time it happens.
 *
 * THE SCHEDULE IS ONE ROW THAT CHANGES SHAPE. Cadence first, then only the
 * fields that cadence actually needs — a weekday appears for a weekly routine
 * and for nothing else, and a routine run by hand shows no time at all,
 * because there is no time at which it happens.
 */

/*
 * THE SHEET CARRIES ITS OWN PALETTE, and it is a neutral grey rather than the
 * app's warm one. Specified value by value, and scoped to this element so it
 * stays a decision about this sheet instead of drifting into the rest of the
 * product: the cards behind it are still on the warm ramp.
 */
/** A filled control on the dialog's own ground: no border, the fill is the field. */
const RING =
  "focus-visible:[outline:2px_solid_var(--sheet-ring)] focus-visible:[outline-offset:2px]";

const FIELD = `h-11 w-full min-w-0 rounded-xl border-0 bg-(--sheet-field) px-4 text-sm text-(--sheet-ink) placeholder:text-(--sheet-placeholder) outline-none ${RING}`;

/** The same, for a `select`: no native arrow, and room for the drawn one. */
const SELECT = `${FIELD} cursor-pointer appearance-none pr-10`;

/**
 * A select and the chevron that marks it.
 *
 * DRAWN, NOT PAINTED ON. The chevron was a data-URI background, and Tailwind
 * cannot parse an arbitrary value containing spaces — the whole utility was
 * dropped and `background-image` computed to `none`, so the control had no
 * affordance at all. An icon element cannot fail that way, and it takes the
 * sheet's own ink instead of a colour hard-coded inside an encoded SVG.
 */
function SelectShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-full">
      {children}
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-(--sheet-ink-2)"
      />
    </div>
  );
}

function Field({
  label,
  htmlFor,
  className = "",
  children,
}: {
  label: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-(--sheet-ink)"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * A setting that is a decision rather than a value: a white plate on the
 * dialog's ground, its consequence spelled out under its name.
 */
function Plate({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-(--sheet-line) bg-(--sheet-plate) p-4 sm:p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function RoutineForm({
  routine,
  directions,
  action,
  onCancel,
  submitLabel,
  title,
}: {
  routine?: RoutineView;
  directions: { id: string; name: string }[];
  action: (formData: FormData) => void;
  onCancel: () => void;
  submitLabel: string;
  title: string;
}) {
  const [kind, setKind] = useState<RoutineScheduleKind>(
    routine?.scheduleKind ?? "daily",
  );
  const [runAt, setRunAt] = useState(routine?.runAt ?? "09:00");
  const [timeZone, setTimeZone] = useState(routine?.timeZone ?? "Asia/Bangkok");
  const [weekday, setWeekday] = useState(routine?.weekday ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState(routine?.dayOfMonth ?? 1);
  /* A toggle, not a two-option select. Publishing live is the consequential
     choice on this form and it deserves a control that looks like a decision,
     with what OFF means written next to it rather than left to be inferred. */
  const [autoPublish, setAutoPublish] = useState(
    routine?.hubStatus === "published",
  );

  const scheduled = kind !== "manual";

  return (
    <SheetDialog onClose={onCancel}>
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Dialog.Title className="font-heading text-[length:var(--text-h2)] font-medium tracking-tight text-(--sheet-ink)">
                {title}
              </Dialog.Title>
              {/* A DECK, LIKE EVERY SECTION IN SETTINGS. "New routine" and
                  "Edit routine" name the act and say nothing about what is
                  being asked for, so the form opened with four fields and no
                  statement of what they add up to. A phrase, at the length the
                  settings decks settled on — it names what the section holds
                  and stops. The same line for both titles, because it is the
                  same form either way. */}
              <p className="mt-1 text-sm leading-relaxed text-(--sheet-ink-2)">
                What it writes, and when
              </p>
            </div>
            <Dialog.Close
              aria-label="Close"
            /* THE SHEET'S CLOSE, from the one constant every close in the app
               uses. A rounded-lg ghost button was the odd one out on a surface
               of pills, and it only appeared on hover — a dismissal you had to
               find rather than see. The dialog's ground is the app's own
               (#f8f8f7), so the disc's grey lands on it exactly as it does on
               a bottom sheet. */
              /* No negative right margin: the sheet's corner radius is derived
                 from this disc's distance to the edge, and pulling it 4px
                 further out would leave the two curves disagreeing. */
              className={`-mt-1 ${PAGE_CLOSE_BUTTON}`}
            >
              <X aria-hidden className="size-5" />
            </Dialog.Close>
          </div>

          {/*
            PROXIMITY, NOT A UNIFORM RHYTHM. Every gap in this form was 20px,
            so five unrelated things read as one flat list: a label sat as far
            from its own field's neighbour as the whole schedule sat from the
            settings below it.

            Three distances now, by what the things ARE. 8px holds a label to
            its control. 20px separates the three fields that describe the
            routine. 28px opens between describing it and configuring it — and
            again before the actions, which belong to the dialog rather than to
            the form. The two setting plates close to 10px, because they are
            the same kind of thing and were drifting apart at 20.
          */}
          <form action={action}>
            {routine && <input type="hidden" name="id" value={routine.id} />}

            <Field label="Name" htmlFor="name">
              <input
                id="name"
                name="name"
                defaultValue={routine?.name ?? ""}
                placeholder="Weekly design systems"
                maxLength={80}
                className={FIELD}
              />
            </Field>

            {/* Above the schedule, because what a routine is for outranks what
                time it happens. */}
            <Field label="Description" htmlFor="description" className="mt-5">
              <textarea
                id="description"
                name="description"
                defaultValue={routine?.description ?? ""}
                placeholder="What this one is for — one line, shown on its card."
                maxLength={200}
                rows={3}
                className={`${FIELD} h-auto resize-y py-3 leading-relaxed`}
              />
            </Field>

            <Field label="Schedule" htmlFor="scheduleKind" className="mt-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <SelectShell>
                  <select
                    id="scheduleKind"
                    name="scheduleKind"
                    value={kind}
                    onChange={(event) =>
                      setKind(event.target.value as RoutineScheduleKind)
                    }
                    className={SELECT}
                  >
                    <option value="daily">Every day</option>
                    <option value="weekly">Once a week</option>
                    <option value="monthly">Once a month</option>
                    <option value="manual">Only when I press Run now</option>
                    {/* Not offered any more, but a routine already set to it keeps
                      it rather than being silently changed by opening its form. */}
                    {routine?.scheduleKind === "weekdays" && (
                      <option value="weekdays">Monday to Friday</option>
                    )}
                  </select>
                </SelectShell>

                {kind === "weekly" && (
                  <SelectShell>
                    <select
                      name="weekday"
                      aria-label="Day of the week"
                      value={weekday}
                      onChange={(event) =>
                        setWeekday(Number(event.target.value))
                      }
                      className={SELECT}
                    >
                      {WEEKDAY_NAMES.map((name, index) => (
                        <option key={name} value={index}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </SelectShell>
                )}
                {kind !== "weekly" && (
                  <input type="hidden" name="weekday" value={weekday} />
                )}

                {kind === "monthly" && (
                  <SelectShell>
                    <select
                      name="dayOfMonth"
                      aria-label="Day of the month"
                      value={dayOfMonth}
                      onChange={(event) => setDayOfMonth(Number(event.target.value))}
                      className={SELECT}
                    >
                      {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                        <option key={day} value={day}>
                          {ordinal(day)}
                        </option>
                      ))}
                    </select>
                  </SelectShell>
                )}
                {kind !== "monthly" && (
                  <input type="hidden" name="dayOfMonth" value={dayOfMonth} />
                )}

                {scheduled && (
                  /* ANY MINUTE, NOT EVERY THIRTIETH. This was a list of the 48
                     half-hours, on the reasoning that a native time input
                     brings its own clock button and reads as a gadget beside
                     two dropdowns. That was a judgement about the row's looks,
                     and it was quietly deciding that 09:15 was not a time you
                     were allowed to pick. The affordance is worth less than
                     the minute. */
                  <div className="w-full min-w-0 sm:w-40 sm:shrink-0">
                    {/* NATIVE LOOK OFF. iOS Safari gives a time input its own
                        intrinsic width and ignores `width: 100%`, so on a phone
                        it ran past the sheet's edge. Without the native
                        appearance it takes the width it is given; the value
                        then centres, so it is put back on the left where the
                        selects above it keep theirs. */}
                    <input
                      type="time"
                      name="runAt"
                      aria-label="Time of day"
                      value={runAt}
                      onChange={(event) => setRunAt(event.target.value || "09:00")}
                      className={`${FIELD} block cursor-pointer appearance-none text-left [&::-webkit-date-and-time-value]:text-left`}
                    />
                  </div>
                )}
                {!scheduled && (
                  <input type="hidden" name="runAt" value={runAt} />
                )}
              </div>
            </Field>

            <Plate className="mt-7">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-(--sheet-ink)">
                    Publish automatically
                  </p>
                  {/* One line, and it still has to carry the warning: the
                      difference between the two states is whether anybody
                      reads the article before the public does. */}
                  <p className="mt-0.5 text-sm leading-relaxed text-(--sheet-ink-2)">
                    {autoPublish
                      ? "Goes live with nobody reading it first."
                      : "Waits in the Hub as a draft."}
                  </p>
                </div>
                <Switch
                  checked={autoPublish}
                  onChange={setAutoPublish}
                  label="Publish automatically"
                />
              </div>
              <input
                type="hidden"
                name="hubStatus"
                value={autoPublish ? "published" : "draft"}
              />
            </Plate>

            <Collapsible.Root className="mt-2.5 rounded-2xl border border-(--sheet-line) bg-(--sheet-plate)">
              <Collapsible.Trigger className="group/adv flex w-full items-start justify-between gap-4 p-4 text-left outline-none focus-visible:shadow-[var(--shadow-focus)] focus-visible:rounded-2xl sm:p-5">
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-(--sheet-ink)">
                    Advanced settings
                  </span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-(--sheet-ink-2)">
                    Content direction and time zone.
                  </span>
                </span>
                <ChevronDown
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-(--sheet-ink-2) transition-transform duration-(--duration-fast) ease-(--ease-out) group-data-open/adv:rotate-180"
                />
              </Collapsible.Trigger>
              <Collapsible.Content className="overflow-hidden data-open:animate-in data-open:slide-in-from-top-1 data-closed:animate-out data-closed:slide-out-to-top-1 motion-reduce:animate-none">
                <div className="space-y-5 border-t border-(--sheet-line) p-4 sm:p-5">
                  <Field label="Content direction" htmlFor="categoryId">
                    <SelectShell>
                      <select
                        id="categoryId"
                        name="categoryId"
                        defaultValue={routine?.categoryId ?? ""}
                        className={SELECT}
                      >
                        {/* Rotation is first because a schedule pinned to one
                          direction publishes the same corner of the territory
                          every time. */}
                        <option value="">Rotate through all of them</option>
                        {directions.map((direction) => (
                          <option key={direction.id} value={direction.id}>
                            {direction.name}
                          </option>
                        ))}
                      </select>
                    </SelectShell>
                  </Field>

                  <Field label="Time zone" htmlFor="timeZone">
                    <SelectShell>
                      <select
                        id="timeZone"
                        name="timeZone"
                        value={timeZone}
                        onChange={(event) => setTimeZone(event.target.value)}
                        className={SELECT}
                      >
                        {TIME_ZONES.map((zone) => (
                          <option key={zone} value={zone}>
                            {zone.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    </SelectShell>
                  </Field>

                </div>
              </Collapsible.Content>
            </Collapsible.Root>

            <Footer submitLabel={submitLabel} onCancel={onCancel} />
          </form>
    </SheetDialog>
  );
}

/**
 * The wait belongs on the button that started it.
 *
 * `useFormStatus` reads the pending state of the form this sits inside, which
 * is the only way to know without threading a flag back down from the caller.
 * Cancel goes unavailable with it: half-saved is not a state anybody should be
 * offered a way out of.
 */
function Footer({
  submitLabel,
  onCancel,
}: {
  submitLabel: string;
  onCancel: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="mt-7 flex justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={onCancel}
        disabled={pending}
      >
        Cancel
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </div>
  );
}
