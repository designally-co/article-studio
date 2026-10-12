import "server-only";
import { sql } from "drizzle-orm";
import journal from "../../drizzle/meta/_journal.json";
import type { getDb } from "@/db";

/**
 * Whether the database has the schema this build expects.
 *
 * This exists because it was missed once, in the worst possible way. A release
 * added five columns and every article page 500'd with `column "origin" does
 * not exist` — while `/api/health` reported the database healthy, because
 * `select 1` succeeds perfectly well against a schema that is two migrations
 * behind the code querying it.
 *
 * Two things make that a silent failure rather than a loud one. Deployed
 * environments set `SKIP_DB_MIGRATE=1`, so nothing applies migrations on boot;
 * and when the migrator does run, `src/db/index.ts` deliberately swallows its
 * errors so a hiccup cannot take down every request. Both are defensible on
 * their own. Together they mean a schema change can ship, deploy green, and
 * break only the pages that touch the new column.
 *
 * The bookkeeping lives in `studio` (src/db/index.ts, MIGRATIONS_SCHEMA).
 *
 * The count of applied migrations against the count this build ships is enough
 * to catch it, and it is one cheap query. Unlike the Hub, this IS part of `ok`:
 * a database behind the code is not a degraded feature, it is pages that 500.
 */
export type SchemaCheck = {
  ok: boolean | null;
  applied?: number;
  expected: number;
  pending?: string[];
  note?: string;
};

/** How many migrations this build ships. */
export const expectedMigrationCount = journal.entries.length;

export async function checkSchema(db: Awaited<ReturnType<typeof getDb>>): Promise<SchemaCheck> {
  const expected = journal.entries.length;
  try {
    const result = await db.execute(
      sql`select count(*)::int as applied from studio."__drizzle_migrations"`
    );
    // postgres-js returns the rows directly; PGlite wraps them in `.rows`.
    const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows) ?? [];
    const applied = Number((rows[0] as { applied?: number } | undefined)?.applied ?? 0);
    if (applied >= expected) return { ok: true, applied, expected };
    return {
      ok: false,
      applied,
      expected,
      // Named, so the fix is "apply these" rather than "work out which".
      pending: journal.entries.slice(applied).map((entry) => entry.tag),
      note: "The database is behind this build. Run `npm run db:migrate`, or apply the listed files in the SQL editor.",
    };
  } catch (error) {
    // A missing bookkeeping table means no migration has ever been applied
    // here, which is its own answer. Anything else is unknown, not unhealthy.
    const message = error instanceof Error ? error.message : "unknown";
    return /__drizzle_migrations|does not exist/i.test(message)
      ? { ok: false, expected, note: "No migrations have been applied to this database." }
      : { ok: null, expected, note: `could not be read: ${message.slice(0, 120)}` };
  }
}

