import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Rule for this schema: every table except `users` has a non-null `user_id`
 * that cascades on delete. Queries must always filter by it; the API's data
 * layer takes `userId` as its first argument so it can't be forgotten.
 */

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const owner = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    image: text("image"),
    emailVerified: boolean("email_verified").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`)],
);

export const canvasConnectionStatus = pgEnum("canvas_connection_status", [
  "active",
  "invalid",
  "revoked",
]);

/** One Canvas connection per user. The token is AES-GCM encrypted at rest. */
export const canvasConnections = pgTable(
  "canvas_connections",
  {
    id: id(),
    userId: owner(),
    baseUrl: text("base_url").notNull(),
    tokenCiphertext: bytea("token_ciphertext").notNull(),
    tokenIv: bytea("token_iv").notNull(),
    tokenLast4: text("token_last4").notNull(),
    status: canvasConnectionStatus("status").notNull().default("active"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("canvas_connections_user_idx").on(t.userId)],
);

export const courses = pgTable(
  "courses",
  {
    id: id(),
    userId: owner(),
    canvasId: text("canvas_id").notNull(),
    name: text("name").notNull(),
    courseCode: text("course_code"),
    term: text("term"),
    selected: boolean("selected").notNull().default(false),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("courses_user_canvas_idx").on(t.userId, t.canvasId),
    // Target for the composite FKs below, so a child row can only point at a
    // course owned by the same user.
    unique("courses_id_user_key").on(t.id, t.userId),
  ],
);

export const modules = pgTable(
  "modules",
  {
    id: id(),
    userId: owner(),
    courseId: uuid("course_id").notNull(),
    canvasId: text("canvas_id").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("modules_user_course_canvas_idx").on(t.userId, t.courseId, t.canvasId),
    foreignKey({
      name: "modules_course_owner_fk",
      columns: [t.courseId, t.userId],
      foreignColumns: [courses.id, courses.userId],
    }).onDelete("cascade"),
  ],
);

export const assignments = pgTable(
  "assignments",
  {
    id: id(),
    userId: owner(),
    courseId: uuid("course_id").notNull(),
    canvasId: text("canvas_id").notNull(),
    name: text("name").notNull(),
    descriptionHtml: text("description_html"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    pointsPossible: integer("points_possible"),
    htmlUrl: text("html_url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("assignments_user_course_canvas_idx").on(t.userId, t.courseId, t.canvasId),
    index("assignments_user_due_idx").on(t.userId, t.dueAt),
    foreignKey({
      name: "assignments_course_owner_fk",
      columns: [t.courseId, t.userId],
      foreignColumns: [courses.id, courses.userId],
    }).onDelete("cascade"),
  ],
);

export const documentSource = pgEnum("document_source", ["canvas_file", "canvas_page", "upload"]);
export const documentStatus = pgEnum("document_status", [
  "pending",
  "downloading",
  "extracting",
  "ready",
  "failed",
]);

export const documents = pgTable(
  "documents",
  {
    id: id(),
    userId: owner(),
    courseId: uuid("course_id"),
    moduleId: uuid("module_id").references(() => modules.id, { onDelete: "set null" }),
    source: documentSource("source").notNull(),
    /** Canvas file/page id; null for direct uploads. */
    canvasId: text("canvas_id"),
    title: text("title").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    /** Dedupe is per user, never across users. */
    contentSha256: text("content_sha256"),
    /** R2 key of the original bytes. Extracted text lives next to it. */
    r2Key: text("r2_key"),
    status: documentStatus("status").notNull().default("pending"),
    error: text("error"),
    pageCount: integer("page_count"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("documents_user_source_canvas_idx")
      .on(t.userId, t.source, t.canvasId)
      .where(sql`${t.canvasId} is not null`),
    index("documents_user_course_idx").on(t.userId, t.courseId),
    index("documents_user_sha_idx").on(t.userId, t.contentSha256),
    foreignKey({
      name: "documents_course_owner_fk",
      columns: [t.courseId, t.userId],
      foreignColumns: [courses.id, courses.userId],
    }).onDelete("cascade"),
  ],
);

export const syncRunStatus = pgEnum("sync_run_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);

/** A durable record of each Canvas sync so progress survives restarts. */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: id(),
    userId: owner(),
    trigger: text("trigger", { enum: ["manual", "onboarding", "schedule"] }).notNull(),
    status: syncRunStatus("status").notNull().default("queued"),
    stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("sync_runs_user_created_idx").on(t.userId, t.createdAt)],
);
