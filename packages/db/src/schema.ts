import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  doublePrecision,
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
    /** Canvas's id for the person the token belongs to: one Talvra account per Canvas user. */
    canvasUserId: text("canvas_user_id"),
    status: canvasConnectionStatus("status").notNull().default("active"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("canvas_connections_user_idx").on(t.userId),
    uniqueIndex("canvas_connections_canvas_user_idx").on(t.baseUrl, t.canvasUserId),
  ],
);

/** A student's own AI provider key (bring your own key). Encrypted like Canvas tokens. */
export const aiProvider = pgEnum("ai_provider", ["anthropic", "openai"]);
export const aiKeyStatus = pgEnum("ai_key_status", ["active", "invalid"]);

export const aiSettings = pgTable(
  "ai_settings",
  {
    id: id(),
    userId: owner(),
    provider: aiProvider("provider").notNull(),
    model: text("model").notNull(),
    keyCiphertext: bytea("key_ciphertext").notNull(),
    keyIv: bytea("key_iv").notNull(),
    keyLast4: text("key_last4").notNull(),
    /** Model capabilities read at save time (e.g. whether `effort` is accepted). */
    supportsEffort: boolean("supports_effort").notNull().default(false),
    status: aiKeyStatus("status").notNull().default("active"),
    /** Why the key stopped working (shown in Settings). */
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("ai_settings_user_idx").on(t.userId)],
);

/**
 * Personal API keys for the MCP server (/api/mcp). Only the SHA-256 hash is kept; the key is
 * shown once when made. Revoking deletes the row.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    userId: owner(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyLast4: text("key_last4").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_keys_hash_idx").on(t.keyHash), index("api_keys_user_idx").on(t.userId)],
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
    /** The student's submission, from Canvas: unsubmitted | submitted | graded | pending_review. */
    submissionState: text("submission_state"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    missing: boolean("missing").notNull().default(false),
    late: boolean("late").notNull().default(false),
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
  /** A type Talvra can't read (video, zip, …) or too large. Not retried. */
  "unsupported",
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
    wordCount: integer("word_count"),
    /** Extractor notes, e.g. "little_text" for scanned PDFs. */
    warnings: text("warnings").array().notNull().default(sql`'{}'::text[]`),
    extractedAt: timestamp("extracted_at", { withTimezone: true }),
    /** Processing attempts since the last success; drives give-up and backoff. */
    attempts: integer("attempts").notNull().default(0),
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
    // The cron's "stuck documents" sweep.
    index("documents_status_updated_idx").on(t.status, t.updatedAt),
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

export const studyAidKind = pgEnum("study_aid_kind", ["notes", "flashcards", "quiz"]);
export const studyAidStatus = pgEnum("study_aid_status", [
  "queued",
  "generating",
  "ready",
  "failed",
]);

/**
 * AI-made study material for one document. Each regeneration is a new version;
 * the newest ready version is what the UI shows. `content` is validated JSON
 * (see @talvra/contracts study.ts) whose citations point at document anchors.
 */
export const studyAids = pgTable(
  "study_aids",
  {
    id: id(),
    userId: owner(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    kind: studyAidKind("kind").notNull(),
    version: integer("version").notNull(),
    status: studyAidStatus("status").notNull().default("queued"),
    model: text("model"),
    /** sha256 of the extracted Markdown + prompt version; reused when unchanged. */
    inputSha256: text("input_sha256"),
    content: jsonb("content"),
    error: text("error"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("study_aids_doc_kind_version_idx").on(t.documentId, t.kind, t.version),
    index("study_aids_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/** One card from a flashcards aid, with its FSRS schedule. */
export const flashcards = pgTable(
  "flashcards",
  {
    id: id(),
    userId: owner(),
    aidId: uuid("aid_id")
      .notNull()
      .references(() => studyAids.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    front: text("front").notNull(),
    back: text("back").notNull(),
    cite: jsonb("cite")
      .$type<{ kind: "page" | "slide" | "section"; n: number }[]>()
      .notNull()
      .default([]),
    // FSRS state (ts-fsrs Card)
    due: timestamp("due", { withTimezone: true }).notNull().defaultNow(),
    stability: doublePrecision("stability").notNull().default(0),
    difficulty: doublePrecision("difficulty").notNull().default(0),
    scheduledDays: integer("scheduled_days").notNull().default(0),
    learningSteps: integer("learning_steps").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    /** 0 New, 1 Learning, 2 Review, 3 Relearning */
    state: integer("state").notNull().default(0),
    lastReview: timestamp("last_review", { withTimezone: true }),
    /** Hidden from review (e.g. a newer version of the deck replaced it). */
    suspended: boolean("suspended").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("flashcards_user_due_idx").on(t.userId, t.suspended, t.due),
    index("flashcards_aid_idx").on(t.aidId, t.position),
  ],
);

/** Every review, for stats and (later) FSRS parameter tuning. */
export const flashcardReviews = pgTable(
  "flashcard_reviews",
  {
    id: id(),
    userId: owner(),
    flashcardId: uuid("flashcard_id")
      .notNull()
      .references(() => flashcards.id, { onDelete: "cascade" }),
    /** 1 Again, 2 Hard, 3 Good, 4 Easy */
    rating: integer("rating").notNull(),
    stateBefore: integer("state_before").notNull(),
    scheduledDays: integer("scheduled_days").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("flashcard_reviews_user_time_idx").on(t.userId, t.reviewedAt)],
);

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/**
 * Searchable pieces of a document (~300 words), each tied to the page/slide/
 * section it came from. `tsv` powers keyword search; the same ids are the
 * vector ids in Vectorize (semantic search), always queried with a userId filter.
 */
export const chunks = pgTable(
  "chunks",
  {
    id: id(),
    userId: owner(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    courseId: uuid("course_id"),
    position: integer("position").notNull(),
    anchorKind: text("anchor_kind", { enum: ["page", "slide", "section"] }).notNull(),
    anchorN: integer("anchor_n").notNull(),
    heading: text("heading").notNull(),
    text: text("text").notNull(),
    tsv: tsvector("tsv")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', coalesce(heading, '')), 'B') || setweight(to_tsvector('english', text), 'A')`,
      ),
    /** Set once the vector is in Vectorize. */
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("chunks_user_doc_idx").on(t.userId, t.documentId, t.position),
    index("chunks_user_course_idx").on(t.userId, t.courseId),
    index("chunks_tsv_idx").using("gin", t.tsv),
  ],
);

/** Metered actions (e.g. "ask") for per-user daily limits. */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    userId: owner(),
    kind: text("kind").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("usage_events_user_kind_time_idx").on(t.userId, t.kind, t.createdAt)],
);

export const briefStatus = pgEnum("brief_status", ["generating", "ready", "failed"]);

/**
 * Claude's reading of an assignment: what's asked, deliverables, constraints,
 * rubric points, questions to ask the instructor. Never the answer.
 */
export const assignmentBriefs = pgTable(
  "assignment_briefs",
  {
    id: id(),
    userId: owner(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    status: briefStatus("status").notNull().default("generating"),
    content: jsonb("content"),
    error: text("error"),
    model: text("model"),
    /** sha256 of the assignment text + prompt version: unchanged means reuse. */
    inputSha256: text("input_sha256"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("assignment_briefs_assignment_idx").on(t.userId, t.assignmentId)],
);

/**
 * "Do my homework" (all signed-in accounts): the latest AI-written files for an
 * assignment, kept in R2, and whether they were submitted to Canvas.
 */
export const draftStatus = pgEnum("draft_status", [
  "working",
  "ready",
  "failed",
  "submitting",
  "submitted",
]);

export const homeworkDrafts = pgTable(
  "homework_drafts",
  {
    id: id(),
    userId: owner(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    status: draftStatus("status").notNull().default("ready"),
    /** [{ name, contentType, size, key }] (key: the R2 object). */
    files: jsonb("files").notNull().default(sql`'[]'::jsonb`),
    /** What the model did and what to double-check. */
    notes: text("notes"),
    /** The student's instructions for this version, if any. */
    instructions: text("instructions"),
    /** While working: what the agent is doing now ("Running the notebook"). */
    progress: text("progress"),
    messages: jsonb("messages").notNull().default(sql`'[]'::jsonb`),
    verification: jsonb("verification"),
    /** Identifies the queued operation; stale deliveries cannot overwrite newer work. */
    runId: uuid("run_id"),
    operation: text("operation").notNull().default("generate"),
    error: text("error"),
    model: text("model"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("homework_drafts_assignment_idx").on(t.userId, t.assignmentId)],
);

/** The student's own plan for an assignment: ordered, checkable steps. */
export const planSteps = pgTable(
  "plan_steps",
  {
    id: id(),
    userId: owner(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    estimateMinutes: integer("estimate_minutes"),
    /** Day the student means to do it (local date, no time). */
    plannedFor: text("planned_for"),
    done: boolean("done").notNull().default(false),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("plan_steps_assignment_idx").on(t.userId, t.assignmentId, t.position)],
);

/** How and when a student wants to be reminded. One row per user (created on first save). */
export const reminderPrefs = pgTable(
  "reminder_prefs",
  {
    id: id(),
    userId: owner(),
    emailEnabled: boolean("email_enabled").notNull().default(true),
    /** Minutes before the due time to remind, e.g. {1440, 180} = 1 day and 3 hours. */
    offsets: integer("offsets").array().notNull().default(sql`'{1440,180}'::int[]`),
    digestEnabled: boolean("digest_enabled").notNull().default(true),
    /** Local hour (0-23) for the daily digest. */
    digestHour: integer("digest_hour").notNull().default(7),
    /** IANA time zone, e.g. America/New_York. */
    timezone: text("timezone").notNull().default("America/New_York"),
    /** No reminders between these local hours (start inclusive, end exclusive). */
    quietStart: integer("quiet_start").notNull().default(22),
    quietEnd: integer("quiet_end").notNull().default(7),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("reminder_prefs_user_idx").on(t.userId)],
);

export const notificationStatus = pgEnum("notification_status", [
  "pending",
  "sent",
  "skipped",
  "failed",
]);

/**
 * Every reminder/digest, planned then sent. `dedupeKey` makes planning
 * idempotent: the cron can run any number of times without double-sending.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: owner(),
    kind: text("kind", { enum: ["due_reminder", "digest", "test"] }).notNull(),
    assignmentId: uuid("assignment_id").references(() => assignments.id, { onDelete: "cascade" }),
    offsetMinutes: integer("offset_minutes"),
    dedupeKey: text("dedupe_key").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: notificationStatus("status").notNull().default("pending"),
    subject: text("subject"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe_idx").on(t.userId, t.dedupeKey),
    index("notifications_due_idx").on(t.status, t.scheduledFor),
    index("notifications_user_time_idx").on(t.userId, t.createdAt),
  ],
);

export const videoStatus = pgEnum("video_status", ["queued", "rendering", "ready", "failed"]);

/** A narrated slideshow made from a document's study notes. */
export const videos = pgTable(
  "videos",
  {
    id: id(),
    userId: owner(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** The notes version it was made from. */
    aidId: uuid("aid_id").references(() => studyAids.id, { onDelete: "set null" }),
    status: videoStatus("status").notNull().default("queued"),
    r2Key: text("r2_key"),
    captionsKey: text("captions_key"),
    sizeBytes: integer("size_bytes"),
    durationSeconds: integer("duration_seconds"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("videos_user_doc_idx").on(t.userId, t.documentId, t.createdAt)],
);
