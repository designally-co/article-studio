/**
 * Standalone migration runner for a Postgres/Supabase DATABASE_URL.
 * Usage: DATABASE_URL=postgres://… npm run db:migrate
 *
 * THE ONLY RUNNER. It ships inside the container image, and a release is
 * migrated by running it there as a deliberate step — see docs/deploy-nas.md
 * §5. Nothing migrates on deploy: the `vercel-build` script that once did was
 * removed when the NAS took over the schema.
 *
 * The app can also migrate on boot (src/db/index.ts), but deployed environments
 * set SKIP_DB_MIGRATE=1 and therefore do not. Do not count on it.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Set it to your Postgres/Supabase connection string.");
  process.exit(1);
}

const client = postgres(url, { prepare: false, max: 1 });
const db = drizzle(client);

/**
 * The migrations' bookkeeping lives in the schema `studio`, beside the tables
 * (decisions/tables-in-schema-studio.md). Until migration 0030 it lived in
 * Drizzle's default schema, `drizzle`. A database migrated before then has its
 * history there and none in `studio`, and the migrator would read "nothing
 * applied" and run 0000 again over tables that exist. So, once, the history is
 * copied across, timestamps included: Drizzle runs every migration newer than
 * the last recorded one, so with the copy it runs only what is really new. The
 * old table is left in place, untouched. Keep this identical to the copy in
 * src/db/index.ts; it is repeated because the release image ships this file on
 * its own.
 */
await client.unsafe(`DO $adopt$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL
     AND to_regclass('studio.__drizzle_migrations') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS studio;
    CREATE TABLE studio.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
    INSERT INTO studio.__drizzle_migrations (hash, created_at)
      SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;
  END IF;
END $adopt$`);

await migrate(db, { migrationsFolder: "drizzle", migrationsSchema: "studio" });
await client.end();
console.log("Migrations applied.");
