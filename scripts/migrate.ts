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

await migrate(db, { migrationsFolder: "drizzle" });
await client.end();
console.log("Migrations applied.");
