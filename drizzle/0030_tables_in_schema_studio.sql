-- Every table moves from `public` to the schema `studio`.
--
-- Article Studio is moving into Project Friday, the one Supabase project the
-- company keeps. Other apps' tables are there already, two of them with the
-- same names as ours (`projects`, `users`), and Friday also holds HR and payroll
-- data. One schema per app keeps the names apart and lets this app connect as a
-- database user that can reach `studio` and nothing else.
--
-- SET SCHEMA moves a table with its rows, indexes, constraints and foreign keys
-- (and the RLS lockdown of 0028 stays on), so nothing is copied and nothing is
-- lost. IF EXISTS keeps a re-run harmless.
--
-- Run it in the old project first, where the app has always lived: the move is
-- proven against the real data before the data changes project. The migrations'
-- own bookkeeping moves to `studio` in code (src/db/index.ts,
-- scripts/migrate.ts), not here: it has to be in place before this file runs.
-- Decision note: decisions/tables-in-schema-studio.md.

CREATE SCHEMA IF NOT EXISTS "studio";
--> statement-breakpoint
ALTER TABLE IF EXISTS "public"."users" SET SCHEMA "studio";
--> statement-breakpoint
ALTER TABLE IF EXISTS "public"."brand_profiles" SET SCHEMA "studio";
--> statement-breakpoint
ALTER TABLE IF EXISTS "public"."pillars" SET SCHEMA "studio";
--> statement-breakpoint
ALTER TABLE IF EXISTS "public"."categories" SET SCHEMA "studio";
--> statement-breakpoint
ALTER TABLE IF EXISTS "public"."projects" SET SCHEMA "studio";
--> statement-breakpoint
ALTER TABLE IF EXISTS "public"."drafts" SET SCHEMA "studio";
--> statement-breakpoint
ALTER TABLE IF EXISTS "public"."refinements" SET SCHEMA "studio";
--> statement-breakpoint
ALTER TABLE IF EXISTS "public"."images" SET SCHEMA "studio";
--> statement-breakpoint
ALTER TABLE IF EXISTS "public"."routines" SET SCHEMA "studio";
--> statement-breakpoint
ALTER TABLE IF EXISTS "public"."routine_runs" SET SCHEMA "studio";
--> statement-breakpoint
ALTER TABLE IF EXISTS "public"."image_references" SET SCHEMA "studio";
--> statement-breakpoint
ALTER TABLE IF EXISTS "public"."api_usage_log" SET SCHEMA "studio";
--> statement-breakpoint
ALTER TABLE IF EXISTS "public"."pricing" SET SCHEMA "studio";
--> statement-breakpoint
ALTER TABLE IF EXISTS "public"."app_settings" SET SCHEMA "studio";
--> statement-breakpoint
ALTER TABLE IF EXISTS "public"."api_keys" SET SCHEMA "studio";
