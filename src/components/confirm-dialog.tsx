"use client";

import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PAGE_CLOSE_BUTTON } from "@/components/page-bar";
import { SHEET } from "@/components/sheet-dialog";
import { useDialogMotion } from "@/lib/dialog-motion";

/**
 * An irreversible thing, asked properly.
 *
 * IT WAS AN INLINE PANEL INSIDE THE CARD, which put a destructive button in
 * the same few hundred pixels as the menu that opens it — one stray click from
 * the trigger and the confirmation is already under the cursor. A confirmation
 * that appears where the pointer already is confirms nothing. Two of these
 * disappeared during review without anybody meaning to delete them.
 *
 * So it takes the screen: focus moves into it, Escape and the overlay cancel,
 * and Delete is somewhere the pointer has to travel to.
 *
 * THE BODY NAMES THE CONSEQUENCE, not the action. "Are you sure" asks the
 * reader to supply the stakes themselves, so each caller passes the one thing
 * worth knowing — what survives this and what does not.
 */

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Delete",
  tone = "danger",
  open,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: React.ReactNode;
  /* Named for the act, not for the dialog. "Confirm" makes the reader look
     back up at the title to find out what they are confirming; the word on the
     button should be the thing that is about to happen. */
  confirmLabel?: string;
  /* Red for something that cannot be taken back, which is what every caller
     asked before. "primary" for a confirmation that is not a loss — saying you
     have permission to use a picture is a go-ahead, and a red button reads as
     a warning against it. */
  tone?: "danger" | "primary";
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  /* `centred` at every width: this is a 28rem box asking one question, not a
     surface with an edge to have come from. It resolves in place. */
  const { mounted, setPanel, setOverlay } = useDialogMotion({
    open,
    onExited: () => {},
    shape: "centred",
  });

  if (!mounted) return null;

  return (
    /* Radix stays open for as long as the panel is mounted — presence belongs
       to the motion hook now, and letting Radix close would take the content
       away before it had finished leaving. */
    <Dialog.Root open onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay ref={setOverlay} className="fixed inset-0 z-(--z-backdrop) bg-ink/25" />
        {/* Centred by a grid frame, not a translate — the same reason as the
            sheet dialog: GSAP animates the panel's transform and folds a CSS
            `translate` into it at whatever size the panel had at that instant. */}
        <div className="pointer-events-none fixed inset-0 z-(--z-modal) grid place-items-center">
        <Dialog.Content
          ref={setPanel}
          style={SHEET}
          className="pointer-events-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl bg-(--sheet-bg) p-5 shadow-[var(--shadow-pop)] outline-none sm:p-6"
        >
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="font-heading text-[length:var(--text-h2)] font-medium tracking-tight text-(--sheet-ink)">
              {title}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
            /* THE SHEET'S CLOSE, from the one constant every close in the app
               uses. A rounded-lg ghost button was the odd one out on a surface
               of pills, and it only appeared on hover — a dismissal you had to
               find rather than see. The dialog's ground is the app's own
               (#f8f8f7), so the disc's grey lands on it exactly as it does on
               a bottom sheet. */
              className={`-mr-1 -mt-1 ${PAGE_CLOSE_BUTTON}`}
            >
              <X aria-hidden className="size-5" />
            </Dialog.Close>
          </div>

          <Dialog.Description className="mt-2 text-sm leading-relaxed text-(--sheet-ink-2)">
            {description}
          </Dialog.Description>

          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" variant={tone === "primary" ? "default" : "destructive"} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
