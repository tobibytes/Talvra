CREATE TYPE "public"."canvas_connection_status" AS ENUM('active', 'invalid', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."document_source" AS ENUM('canvas_file', 'canvas_page', 'upload');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending', 'downloading', 'extracting', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sync_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"canvas_id" text NOT NULL,
	"name" text NOT NULL,
	"description_html" text,
	"due_at" timestamp with time zone,
	"points_possible" integer,
	"html_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"base_url" text NOT NULL,
	"token_ciphertext" "bytea" NOT NULL,
	"token_iv" "bytea" NOT NULL,
	"token_last4" text NOT NULL,
	"status" "canvas_connection_status" DEFAULT 'active' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"canvas_id" text NOT NULL,
	"name" text NOT NULL,
	"course_code" text,
	"term" text,
	"selected" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_id_user_key" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid,
	"module_id" uuid,
	"source" "document_source" NOT NULL,
	"canvas_id" text,
	"title" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"content_sha256" text,
	"r2_key" text,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"page_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"canvas_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" "sync_run_status" DEFAULT 'queued' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_course_owner_fk" FOREIGN KEY ("course_id","user_id") REFERENCES "public"."courses"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_connections" ADD CONSTRAINT "canvas_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_course_owner_fk" FOREIGN KEY ("course_id","user_id") REFERENCES "public"."courses"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_course_owner_fk" FOREIGN KEY ("course_id","user_id") REFERENCES "public"."courses"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_user_course_canvas_idx" ON "assignments" USING btree ("user_id","course_id","canvas_id");--> statement-breakpoint
CREATE INDEX "assignments_user_due_idx" ON "assignments" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_connections_user_idx" ON "canvas_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_user_canvas_idx" ON "courses" USING btree ("user_id","canvas_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_user_source_canvas_idx" ON "documents" USING btree ("user_id","source","canvas_id") WHERE "documents"."canvas_id" is not null;--> statement-breakpoint
CREATE INDEX "documents_user_course_idx" ON "documents" USING btree ("user_id","course_id");--> statement-breakpoint
CREATE INDEX "documents_user_sha_idx" ON "documents" USING btree ("user_id","content_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "modules_user_course_canvas_idx" ON "modules" USING btree ("user_id","course_id","canvas_id");--> statement-breakpoint
CREATE INDEX "sync_runs_user_created_idx" ON "sync_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));