-- PREVIEW ONLY (branch preview/article-direction-v1). Apply to a test database only.
-- Where each in-body image came from and who may use it, for the proposed
-- article direction. Nullable: every existing row and every image the current
-- behaviour makes leaves them empty.
ALTER TABLE "studio"."images" ADD COLUMN IF NOT EXISTS "block_id" text;--> statement-breakpoint
ALTER TABLE "studio"."images" ADD COLUMN IF NOT EXISTS "route" text;--> statement-breakpoint
ALTER TABLE "studio"."images" ADD COLUMN IF NOT EXISTS "caption" text;--> statement-breakpoint
ALTER TABLE "studio"."images" ADD COLUMN IF NOT EXISTS "alt" text;--> statement-breakpoint
ALTER TABLE "studio"."images" ADD COLUMN IF NOT EXISTS "credit" text;--> statement-breakpoint
ALTER TABLE "studio"."images" ADD COLUMN IF NOT EXISTS "source_url" text;--> statement-breakpoint
ALTER TABLE "studio"."images" ADD COLUMN IF NOT EXISTS "rights" text;
