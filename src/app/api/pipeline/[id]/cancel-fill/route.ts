import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { cancelFill } from "@/lib/pipeline/fill-cancel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PREVIEW ONLY: Cancel on an image box. A route, not a server action, because
 * a page's server actions run one at a time: a Cancel action would wait for
 * the very fill it is meant to stop. See @/lib/pipeline/fill-cancel.
 */
export async function POST(request: NextRequest) {
  if (!(await getSessionUser())) return Response.json({ ok: false }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { ticket?: unknown } | null;
  const ticket = typeof body?.ticket === "string" ? body.ticket.slice(0, 100) : "";
  if (!ticket) return Response.json({ ok: false }, { status: 400 });
  cancelFill(ticket);
  return Response.json({ ok: true });
}
