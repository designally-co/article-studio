/**
 * PREVIEW ONLY: Cancel for a picture being found, generated or drawn (build
 * session, 2026-10-15: "finding image must have cancel button").
 *
 * The browser cannot stop a server action it has started, and Next.js runs a
 * page's server actions one at a time, so Cancel cannot be another action: it
 * is a plain request to `/api/pipeline/[id]/cancel-fill` with the fill's ticket.
 * The fill checks its ticket between its steps and before it saves anything,
 * so a cancelled fill never replaces the picture the editor kept. A provider
 * call already under way still finishes (and is still paid for).
 *
 * Kept in memory: Studio runs as one server process. On `globalThis` so the
 * route handler and the server actions share one list.
 */

type Store = Map<string, number>;

const KEY = Symbol.for("article-studio.cancelled-fills");
const KEEP_MS = 30 * 60 * 1000;

function store(): Store {
  const holder = globalThis as unknown as Record<symbol, Store | undefined>;
  return (holder[KEY] ??= new Map());
}

export class FillCancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "FillCancelled";
  }
}

export function cancelFill(ticket: string): void {
  const now = Date.now();
  const cancelled = store();
  for (const [old, at] of cancelled) if (now - at > KEEP_MS) cancelled.delete(old);
  cancelled.set(ticket, now);
}

export function isFillCancelled(ticket: string | undefined): boolean {
  return Boolean(ticket && store().has(ticket));
}

export function throwIfCancelled(ticket: string | undefined): void {
  if (isFillCancelled(ticket)) throw new FillCancelled();
}
