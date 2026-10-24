CREATE TYPE "public"."draft_status" AS ENUM('ready', 'failed', 'submitted');--> statement-breakpoint
CREATE TABLE "homework_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"status" "draft_status" DEFAULT 'ready' NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"instructions" text,
	"error" text,
	"model" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "homework_drafts" ADD CONSTRAINT "homework_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_drafts" ADD CONSTRAINT "homework_drafts_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "homework_drafts_assignment_idx" ON "homework_drafts" USING btree ("user_id","assignment_id");