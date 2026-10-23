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
 * Rule for this schema: every table except `users` and `verifications` has a non-null `user_id`
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
    /** Set when the onboarding wizard finishes; null sends the user back to it. */
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`)],
);

/*
 * Better Auth tables. Column sets follow Better Auth's core schema; the
 * property names are what its Drizzle adapter reads.
 */

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: owner(),
    /** Opaque token stored in the signed session cookie. */
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("sessions_token_idx").on(t.token), index("sessions_user_idx").on(t.userId)],
);

/** Login methods: "credential" (password hash) or an OAuth provider like "google". */
export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: owner(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("accounts_provider_account_idx").on(t.providerId, t.accountId),
    index("accounts_user_idx").on(t.userId),
  ],
);

/** Short-lived tokens: email verification and password reset. No user_id by design. */
export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
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

export const moduleItemKind = pgEnum("module_item_kind", [
  "file",
  "page",
  "assignment",
  "quiz",
  "discussion",
  "external_url",
  "external_tool",
  "subheader",
]);

export type ModuleItemKind = (typeof moduleItemKind.enumValues)[number];

/** The ordered contents of a Canvas module; drives the Modules tab. */
export const moduleItems = pgTable(
  "module_items",
  {
    id: id(),
    userId: owner(),
    courseId: uuid("course_id").notNull(),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    canvasId: text("canvas_id").notNull(),
    position: integer("position").notNull().default(0),
    indent: integer("indent").notNull().default(0),
    title: text("title").notNull(),
    kind: moduleItemKind("kind").notNull(),
    /** Canvas id of the linked file/assignment/etc., or the page url slug. */
    refCanvasId: text("ref_canvas_id"),
    htmlUrl: text("html_url"),
    externalUrl: text("external_url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("module_items_user_course_canvas_idx").on(t.userId, t.courseId, t.canvasId),
    index("module_items_module_idx").on(t.moduleId, t.position),
    foreignKey({
      name: "module_items_course_owner_fk",
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
    unlockAt: timestamp("unlock_at", { withTimezone: true }),
    lockAt: timestamp("lock_at", { withTimezone: true }),
    pointsPossible: integer("points_possible"),
    submissionTypes: text("submission_types").array().notNull().default(sql`'{}'::text[]`),
    published: boolean("published").notNull().default(true),
    htmlUrl: text("html_url"),
    /** Canvas `updated_at`; unchanged means the incremental sync skips the row. */
    canvasUpdatedAt: timestamp("canvas_updated_at", { withTimezone: true }),
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
    /** Canvas API url of the file/page (stable). Download urls are short-lived, so never stored. */
    canvasUrl: text("canvas_url"),
    /** Canvas folder, e.g. "course files/Lectures". */
    folderPath: text("folder_path"),
    /** Canvas pages are small: their HTML is stored inline. */
    bodyHtml: text("body_html"),
    canvasUpdatedAt: timestamp("canvas_updated_at", { withTimezone: true }),
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

export type SyncCounts = {
  modules: number;
  moduleItems: number;
  assignments: number;
  files: number;
  pages: number;
};

export type SyncCourseProgress = {
  courseId: string;
  name: string;
  state: "waiting" | "running" | "done" | "failed";
  counts: SyncCounts;
  /** Set when a course fails without failing the whole run (e.g. it was removed). */
  error?: string;
};

export type SyncProgress = {
  stage: "queued" | "loading" | "courses" | "finishing" | "done";
  coursesDone: number;
  coursesTotal: number;
  courses: SyncCourseProgress[];
};

/** A durable record of each Canvas sync so progress survives restarts. */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: id(),
    userId: owner(),
    /** Null for a whole-account run; set to sync just one course. */
    courseId: uuid("course_id"),
    trigger: text("trigger", { enum: ["manual", "onboarding", "schedule"] }).notNull(),
    status: syncRunStatus("status").notNull().default("queued"),
    stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
    progress: jsonb("progress").$type<SyncProgress | null>(),
    error: text("error"),
    /** Machine-readable failure, e.g. "canvas_token_invalid". */
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("sync_runs_user_created_idx").on(t.userId, t.createdAt),
    // At most one run in flight per user. Starting another while one is queued
    // or running fails on this index, which the API turns into a 409.
    uniqueIndex("sync_runs_one_active_idx")
      .on(t.userId)
      .where(sql`${t.status} in ('queued', 'running')`),
    foreignKey({
      name: "sync_runs_course_owner_fk",
      columns: [t.courseId, t.userId],
      foreignColumns: [courses.id, courses.userId],
    }).onDelete("cascade"),
  ],
);
