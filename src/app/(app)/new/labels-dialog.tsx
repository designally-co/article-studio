"use client";

import { useMemo, useState } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PAGE_CLOSE_BUTTON } from "@/components/page-bar";
import { SHEET } from "@/components/sheet-dialog";
import { useDialogMotion } from "@/lib/dialog-motion";
import {
  ALLOWED_COMBINATIONS,
  LABEL_KEYWORDS,
  LABEL_PILLARS,
  LABEL_TOPICS,
  MAX_KEYWORDS,
  PILLAR_NAMES,
  TOPIC_NAMES,
  TYPE_NAMES,
  validateLabels,
  type ArticleLabels,
  type LabelPillar,
  type LabelTopic,
  type LabelType,
} from "@/lib/direction/labels";

/**
 * PREVIEW ONLY: confirm the labels for an article written the proposed way.
 *
 * The model proposes them from the topic; the editor confirms or changes them.
 * Only combinations the proposal allows can be chosen, and the same check runs
 * again on the server when the article is created.
 */
export function LabelsDialog({
  open,
  initial,
  note,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  initial: ArticleLabels;
  note?: string;
  onCancel: () => void;
  onConfirm: (labels: ArticleLabels) => void;
}) {
  const { mounted, setPanel, setOverlay } = useDialogMotion({ open, onExited: () => {}, shape: "centred" });
  const [pillar, setPillar] = useState<LabelPillar>(initial.pillar);
  const [type, setType] = useState<LabelType>(initial.type);
  const [topic, setTopic] = useState<LabelTopic>(initial.topic);
  const [topic2, setTopic2] = useState<LabelTopic | "">(initial.topic2 ?? "");
  const [keywords, setKeywords] = useState<string[]>(initial.keywords);

  const rule = ALLOWED_COMBINATIONS[pillar];
  const check = useMemo(
    () => validateLabels({ pillar, type, topic, topic2: topic2 || null, keywords }),
    [pillar, type, topic, topic2, keywords],
  );

  function choosePillar(next: LabelPillar) {
    const nextRule = ALLOWED_COMBINATIONS[next];
    setPillar(next);
    if (!nextRule.types.includes(type)) setType(nextRule.types[0]);
    if (!nextRule.topics.includes(topic)) setTopic(nextRule.topics[0]);
    if (!nextRule.secondTopic) setTopic2("");
  }

  function toggleKeyword(keyword: string) {
    setKeywords((current) =>
      current.includes(keyword)
        ? current.filter((value) => value !== keyword)
        : current.length >= MAX_KEYWORDS
          ? current
          : [...current, keyword],
    );
  }

  if (!mounted) return null;
  const field = "flex flex-col gap-1 text-xs font-medium text-(--sheet-ink-2)";
  return (
    <Dialog.Root open onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay ref={setOverlay} className="fixed inset-0 z-(--z-backdrop) bg-ink/25" />
        <div className="pointer-events-none fixed inset-0 z-(--z-modal) grid place-items-center">
          <Dialog.Content
            ref={setPanel}
            style={SHEET}
            className="pointer-events-auto max-h-[90dvh] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl bg-(--sheet-bg) p-5 shadow-[var(--shadow-pop)] outline-none sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <Dialog.Title className="font-heading text-[length:var(--text-h2)] font-medium tracking-tight text-(--sheet-ink)">
                Article labels (preview)
              </Dialog.Title>
              <Dialog.Close aria-label="Close" className={`-mr-1 -mt-1 ${PAGE_CLOSE_BUTTON}`}>
                <X aria-hidden className="size-5" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="mt-2 text-sm leading-relaxed text-(--sheet-ink-2)">
              Proposed from your topic. Check them: they decide the article&apos;s shape, length and images. Testing a proposal; the Hub still gets the one direction tag.
            </Dialog.Description>
            {note && <p className="mt-2 text-xs text-(--sheet-ink-2)">{note}</p>}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className={field}>
                Pillar
                <select className="cs-select" value={pillar} onChange={(event) => choosePillar(event.target.value as LabelPillar)}>
                  {LABEL_PILLARS.map((value) => (
                    <option key={value} value={value}>{PILLAR_NAMES[value]}</option>
                  ))}
                </select>
              </label>
              <label className={field}>
                Type
                <select className="cs-select" value={type} onChange={(event) => setType(event.target.value as LabelType)}>
                  {rule.types.map((value) => (
                    <option key={value} value={value}>{TYPE_NAMES[value]}</option>
                  ))}
                </select>
              </label>
              <label className={field}>
                Topic
                <select className="cs-select" value={topic} onChange={(event) => setTopic(event.target.value as LabelTopic)}>
                  {rule.topics.map((value) => (
                    <option key={value} value={value}>{TOPIC_NAMES[value]}</option>
                  ))}
                </select>
              </label>
              <label className={field}>
                Second topic {rule.secondTopic ? "(optional)" : "(All Things AI only)"}
                <select
                  className="cs-select"
                  value={topic2}
                  disabled={!rule.secondTopic}
                  onChange={(event) => setTopic2(event.target.value as LabelTopic | "")}
                >
                  <option value="">None</option>
                  {LABEL_TOPICS.filter((value) => value !== topic).map((value) => (
                    <option key={value} value={value}>{TOPIC_NAMES[value]}</option>
                  ))}
                </select>
              </label>
            </div>

            <fieldset className="mt-4">
              <legend className="text-xs font-medium text-(--sheet-ink-2)">
                Keywords: 2 to 4 of the Hub&apos;s tags ({keywords.length} chosen)
              </legend>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {LABEL_KEYWORDS.map((keyword) => {
                  const on = keywords.includes(keyword);
                  return (
                    <button
                      key={keyword}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleKeyword(keyword)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] ${
                        on ? "bg-ink text-surface" : "bg-sunken text-ink-2 hover:bg-deep"
                      }`}
                    >
                      {keyword}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {!check.ok && (
              <ul role="alert" className="mt-4 list-disc space-y-1 pl-5 text-xs text-danger-ink">
                {check.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="button" disabled={!check.ok} onClick={() => check.ok && onConfirm(check.labels)}>
                Create article
              </Button>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
