CREATE TYPE "public"."brief_status" AS ENUM('generating', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "assignment_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"status" "brief_status" DEFAULT 'generating' NOT NULL,
	"content" jsonb,
	"error" text,
	"model" text,
	"input_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"estimate_minutes" integer,
	"planned_for" text,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "submission_state" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "missing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "late" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assignment_briefs" ADD CONSTRAINT "assignment_briefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_briefs" ADD CONSTRAINT "assignment_briefs_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_steps" ADD CONSTRAINT "plan_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_steps" ADD CONSTRAINT "plan_steps_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_briefs_assignment_idx" ON "assignment_briefs" USING btree ("user_id","assignment_id");--> statement-breakpoint
CREATE INDEX "plan_steps_assignment_idx" ON "plan_steps" USING btree ("user_id","assignment_id","position");