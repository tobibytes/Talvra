CREATE TYPE "public"."module_item_kind" AS ENUM('file', 'page', 'assignment', 'quiz', 'discussion', 'external_url', 'external_tool', 'subheader');--> statement-breakpoint
CREATE TABLE "module_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"canvas_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"indent" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"kind" "module_item_kind" NOT NULL,
	"ref_canvas_id" text,
	"html_url" text,
	"external_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "unlock_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "lock_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "submission_types" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "published" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "canvas_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "canvas_url" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "folder_path" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "body_html" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "canvas_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "course_id" uuid;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "progress" jsonb;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "module_items" ADD CONSTRAINT "module_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_items" ADD CONSTRAINT "module_items_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_items" ADD CONSTRAINT "module_items_course_owner_fk" FOREIGN KEY ("course_id","user_id") REFERENCES "public"."courses"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "module_items_user_course_canvas_idx" ON "module_items" USING btree ("user_id","course_id","canvas_id");--> statement-breakpoint
CREATE INDEX "module_items_module_idx" ON "module_items" USING btree ("module_id","position");--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_course_owner_fk" FOREIGN KEY ("course_id","user_id") REFERENCES "public"."courses"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_runs_one_active_idx" ON "sync_runs" USING btree ("user_id") WHERE "sync_runs"."status" in ('queued', 'running');