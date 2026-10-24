ALTER TYPE "public"."draft_status" ADD VALUE 'working' BEFORE 'ready';--> statement-breakpoint
ALTER TABLE "homework_drafts" ADD COLUMN "progress" text;