ALTER TYPE "public"."draft_status" ADD VALUE 'submitting' BEFORE 'submitted';--> statement-breakpoint
ALTER TABLE "homework_drafts" ADD COLUMN "messages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "homework_drafts" ADD COLUMN "verification" jsonb;--> statement-breakpoint
ALTER TABLE "homework_drafts" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "homework_drafts" ADD COLUMN "operation" text DEFAULT 'generate' NOT NULL;