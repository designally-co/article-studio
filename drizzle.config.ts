import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Every table lives in the schema `studio` (decisions/tables-in-schema-studio.md),
  // and so does the migrations' bookkeeping (src/db/index.ts, MIGRATIONS_SCHEMA).
  schemaFilter: ["studio"],
  migrations: { schema: "studio" },
});
