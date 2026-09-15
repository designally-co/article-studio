import path from "node:path";
import fs from "node:fs";
import { drizzle as drizzlePglite, PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import * as schema from "./schema";
import { seedIfEmpty } from "./seed";
import { localFallbacksAllowed } from "../lib/local-fallbacks";

export type DB = PgliteDatabase<typeof schema> | PostgresJsDatabase<typeof schema>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");

type Cache = { db: DB; ready: Promise<void> };

const globalCache = globalThis as unknown as { __contentStudioDb?: Cache };

/**
 * Supabase's pooler serves session mode on :5432 and transaction mode on :6543.
 * Transaction mode is the usual serverless advice because it multiplexes, and
 * this used to rewrite :5432 -> :6543 automatically.
 *
 * That rewrite is now OPT-IN, because against this stack it broke the app:
 * queries Drizzle emits with a parameterised `LIMIT $n` crashed inside
 * postgres-js ("Cannot read properties of undefined (reading 'length')") and
 * other pages hung until Postgres' 120s statement_timeout. The same pages are
 * fast and stable on session mode. Session mode's ceiling is the pooler's Pool
 * Size, so keep that comfortably above peak concurrency (raised to 40) rather
 * than switching modes.
 *
 * Set DB_FORCE_TRANSACTION_POOLER=1 to re-enable the rewrite.
 */
const SUPABASE_SESSION_PORT = /(@[^/@\s]*\.pooler\.supabase\.com):5432\b/;

function preferTransactionPooler(rawUrl: string): string {
  if (process.env.DB_FORCE_TRANSACTION_POOLER !== "1") return rawUrl;
  if (!SUPABASE_SESSION_PORT.test(rawUrl)) return rawUrl;
  console.warn("[db] DB_FORCE_TRANSACTION_POOLER=1 — rewriting pooler port :5432 -> :6543.");
  // String replace rather than a URL round-trip so credentials are not re-encoded.
  return rawUrl.replace(SUPABASE_SESSION_PORT, "$1:6543");
}

function create(): Cache {
  const rawUrl = process.env.DATABASE_URL;
  const url = rawUrl ? preferTransactionPooler(rawUrl) : rawUrl;
  if (url) {
    // Supabase / any Postgres. `prepare: false` is required for Supabase's
    // transaction-mode connection pooler (port 6543).
    //
    // Keep the per-instance pool small: every serverless worker creates its own
    // client, and postgres-js defaults to max: 10, so a handful of concurrent
    // workers can exhaust the pooler and fail with EMAXCONNSESSION. A low max
    // plus a short idle timeout lets connections be recycled quickly.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require("postgres") as typeof import("postgres");
    const client = postgres(url, { prepare: false, max: 3, idle_timeout: 20 });
    const db = drizzlePostgres(client, { schema });

    // Every serverless cold start would otherwise run the full migrator (its
    // first statement is CREATE SCHEMA), which is pure overhead once the schema
    // is current and multiplies connections during request bursts. Set
    // SKIP_DB_MIGRATE=1 in a deployed environment and apply migrations from a
    // trusted place (a local boot, or `npm run db:migrate`) instead.
    const skipMigrate = process.env.SKIP_DB_MIGRATE === "1";
    const ready = (
      skipMigrate
        ? Promise.resolve()
        : migratePostgres(db, { migrationsFolder: MIGRATIONS }).then(() => seedIfEmpty(db))
    ).catch((error: unknown) => {
      // Never let a migration/seed hiccup take down every request: getDb()
      // awaits this, so a rejection here 500s the whole page even though the
      // schema is already applied. Log and continue; real query errors will
      // still surface normally.
      console.error("[db] migrate/seed failed, continuing without it:", error);
    });
    return { db, ready };
  }

  /* A PRODUCTION PROCESS WITHOUT DATABASE_URL STOPS HERE. Falling through
     boots an empty embedded database, migrates and seeds it, and every health
     check then passes against it — a deployment that looks fine and holds none
     of the data. `next build` is let through: it runs with NODE_ENV=production
     and has no business needing a database. */
  if (!localFallbacksAllowed() && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error("DATABASE_URL is not set. A production process does not fall back to an embedded database.");
  }

  // Local development: embedded Postgres (PGlite), zero external services.
  // Swaps to Supabase by setting DATABASE_URL — same schema, same queries.
  const dataDir = path.join(process.cwd(), "data", "pg");
  fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  const ready = migratePglite(db, { migrationsFolder: MIGRATIONS }).then(() =>
    seedIfEmpty(db)
  );
  return { db, ready };
}

export async function getDb(): Promise<DB> {
  if (!globalCache.__contentStudioDb) {
    globalCache.__contentStudioDb = create();
  }
  await globalCache.__contentStudioDb.ready;
  return globalCache.__contentStudioDb.db;
}

export { schema };
