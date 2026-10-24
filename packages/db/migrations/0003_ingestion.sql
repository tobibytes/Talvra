ALTER TYPE "public"."document_status" ADD VALUE 'unsupported';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "word_count" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "warnings" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "extracted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_status_updated_idx" ON "documents" USING btree ("status","updated_at");