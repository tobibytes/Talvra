import type { SyncRun } from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { and, asc, desc, eq, gt, inArray, lt, schema, sql } from "@talvra/db";
import { type IngestMessage, pendingDocumentIds } from "../ingest/process.js";
import { CanvasClient, type CanvasClientOptions, CanvasError, type Fetch } from "../lib/canvas.js";
import { decryptSecret } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";
import { syncCourse } from "./sync-course.js";

const { syncRuns, canvasConnections, courses, users } = schema;

/** In-flight runs older than this are considered dead. */
export const STALE_RUN_MS = 2 * 60 * 60 * 1000;

export type SyncParams = { userId: string; syncRunId: string };
export type SyncTrigger = "manual" | "onboarding" | "schedule";

/**
 * Runs a named, durable unit of work. In the Workflow this is `step.do` (retried,
 * and skipped on replay once it succeeded); in tests it just calls `fn`.
 */
export type Step = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

export type SyncDeps = {
  db: Database;
  /** base64 AES key for Canvas tokens. */
  tokenKey: string;
  fetch?: Fetch;
  canvas?: CanvasClientOptions;
  /** Pushes the run's latest state to the user's live connection(s). */
  notify?: (userId: string, run: SyncRun) => Promise<void>;
  /** Hands new/changed documents to the ingest pipeline. */
  enqueue?: (messages: IngestMessage[]) => Promise<void>;
};

/** An error that must not be retried and ends the whole run. */
export class FatalSyncError extends Error {
  constructor(
    readonly code: "canvas_token_invalid" | "canvas_not_connected" | "run_missing",
    message: string,
  ) {
    super(message);
  }
  /** Survives the trip through Workflows, which only keeps the message. */
  encode() {
    return `fatal:${this.code}:${this.message}`;
  }
  static decode(err: unknown): FatalSyncError | null {
    if (err instanceof FatalSyncError) return err;
    const m = String((err as Error)?.message ?? "").match(/fatal:([a-z_]+):(.*)$/s);
    return m ? new FatalSyncError(m[1] as FatalSyncError["code"], m[2] ?? "") : null;
  }
}

export function toSyncRun(r: typeof syncRuns.$inferSelect): SyncRun {
  return {
    id: r.id,
    courseId: r.courseId,
    trigger: r.trigger,
    status: r.status,
    progress: r.progress ?? null,
    stats: r.stats,
    error: r.error,
    errorCode: r.errorCode,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * Records a queued run and hands it to `launch` (which creates the Workflow
 * instance). Only one run per user can be queued or running; a second start
 * gets a 409 with the run already in flight.
 */
export async function startSync(
  db: Database,
  input: { userId: string; trigger: SyncTrigger; courseId?: string | null },
  launch: (params: SyncParams) => Promise<void>,
): Promise<SyncRun> {
  const { userId, trigger, courseId = null } = input;
  // A run whose Workflow died without finishing would block syncing forever
  // (one in-flight run per user). Runs never legitimately take this long.
  await db
    .update(syncRuns)
    .set({
      status: "failed",
      error: "This sync stopped responding.",
      errorCode: "stale",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(syncRuns.userId, userId),
        inArray(syncRuns.status, ["queued", "running"]),
        lt(syncRuns.createdAt, new Date(Date.now() - STALE_RUN_MS)),
      ),
    );
  const [inFlight] = await db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(and(eq(syncRuns.userId, userId), inArray(syncRuns.status, ["queued", "running"])))
    .limit(1);
  if (inFlight) throw new AppError("conflict", "A sync is already running.");
  if (trigger === "manual") {
    const [recent] = await db
      .select({ id: syncRuns.id })
      .from(syncRuns)
      .where(
        and(
          eq(syncRuns.userId, userId),
          eq(syncRuns.trigger, "manual"),
          gt(syncRuns.createdAt, new Date(Date.now() - 60_000)),
        ),
      )
      .limit(1);
    if (recent) throw new AppError("rate_limited", "You just synced. Try again in a minute.");
  }
  let row: typeof syncRuns.$inferSelect | undefined;
  try {
    [row] = await db
      .insert(syncRuns)
      .values({
        userId,
        trigger,
        courseId,
        status: "queued",
        progress: { stage: "queued", coursesDone: 0, coursesTotal: 0, courses: [] },
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("conflict", "A sync is already running.");
    throw err;
  }
  if (!row) throw new Error("insert returned nothing");
  try {
    await launch({ userId, syncRunId: row.id });
  } catch (err) {
    await db
      .update(syncRuns)
      .set({
        status: "failed",
        error: "Couldn't start the sync.",
        errorCode: "launch_failed",
        finishedAt: new Date(),
      })
      .where(eq(syncRuns.id, row.id));
    throw err;
  }
  return toSyncRun(row);
}

async function loadRun(db: Database, { userId, syncRunId }: SyncParams) {
  const [run] = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.userId, userId), eq(syncRuns.id, syncRunId)))
    .limit(1);
  if (!run) throw new FatalSyncError("run_missing", "This sync no longer exists.");
  return run;
}

async function saveRun(
  deps: SyncDeps,
  params: SyncParams,
  patch: Partial<typeof syncRuns.$inferInsert>,
) {
  const [run] = await deps.db
    .update(syncRuns)
    .set(patch)
    .where(and(eq(syncRuns.userId, params.userId), eq(syncRuns.id, params.syncRunId)))
    .returning();
  if (run) await deps.notify?.(params.userId, toSyncRun(run)).catch(() => {});
  return run;
}

async function canvasClientFor(deps: SyncDeps, userId: string) {
  const [conn] = await deps.db
    .select()
    .from(canvasConnections)
    .where(eq(canvasConnections.userId, userId))
    .limit(1);
  if (!conn) throw new FatalSyncError("canvas_not_connected", "Connect Canvas to sync.");
  if (conn.status !== "active") {
    throw new FatalSyncError(
      "canvas_token_invalid",
      "Your Canvas token stopped working. Replace it in Settings.",
    );
  }
  const token = await decryptSecret(
    deps.tokenKey,
    { ciphertext: conn.tokenCiphertext, iv: conn.tokenIv },
    userId,
  );
  return new CanvasClient(conn.baseUrl, token, deps.fetch, deps.canvas);
}

async function markTokenInvalid(db: Database, userId: string) {
  await db
    .update(canvasConnections)
    .set({ status: "invalid", lastVerifiedAt: new Date() })
    .where(eq(canvasConnections.userId, userId));
}

/**
 * The whole sync, as durable steps: load → one step per course → finish.
 * A crash resumes at the next unfinished course. A 401 from Canvas marks the
 * connection invalid and stops immediately (never retried).
 */
export async function executeSync(deps: SyncDeps, params: SyncParams, step: Step) {
  const { userId } = params;
  try {
    const targets = await step("load", async () => {
      const run = await loadRun(deps.db, params);
      await canvasClientFor(deps, userId); // fails fast without a usable token
      const rows = await deps.db
        .select({ id: courses.id, name: courses.name })
        .from(courses)
        .where(
          and(
            eq(courses.userId, userId),
            run.courseId ? eq(courses.id, run.courseId) : eq(courses.selected, true),
          ),
        )
        .orderBy(asc(courses.name));
      await saveRun(deps, params, {
        status: "running",
        startedAt: run.startedAt ?? new Date(),
        progress: {
          stage: "courses",
          coursesDone: 0,
          coursesTotal: rows.length,
          courses: rows.map((c) => ({
            courseId: c.id,
            name: c.name,
            state: "waiting",
            counts: { modules: 0, moduleItems: 0, assignments: 0, files: 0, pages: 0 },
          })),
        },
      });
      return rows;
    });

    for (const course of targets) {
      const update = async (
        state: schema.SyncCourseProgress["state"],
        counts?: schema.SyncCounts,
        error?: string,
      ) => {
        const run = await loadRun(deps.db, params);
        const progress = run.progress ?? {
          stage: "courses",
          coursesDone: 0,
          coursesTotal: targets.length,
          courses: [],
        };
        const courses = progress.courses.map((c) =>
          c.courseId === course.id
            ? { ...c, state, counts: counts ?? c.counts, ...(error ? { error } : {}) }
            : c,
        );
        await saveRun(deps, params, {
          progress: {
            ...progress,
            courses,
            coursesDone: courses.filter((c) => c.state === "done" || c.state === "failed").length,
          },
        });
      };

      try {
        await step(`course:${course.id}`, async () => {
          const client = await canvasClientFor(deps, userId);
          await update("running");
          try {
            const counts = await syncCourse(
              deps.db,
              client,
              { userId, courseId: course.id },
              (stage, counts) => update(stage === "done" ? "done" : "running", counts),
            );
            return counts;
          } catch (err) {
            if (err instanceof CanvasError && err.kind === "unauthorized") {
              await markTokenInvalid(deps.db, userId);
              throw new FatalSyncError(
                "canvas_token_invalid",
                "Canvas stopped accepting your token. Replace it in Settings.",
              );
            }
            // Deterministic: retrying won't help. Record it and move on.
            if (
              err instanceof CanvasError &&
              (err.kind === "not_found" || err.kind === "forbidden")
            ) {
              await update(
                "failed",
                undefined,
                err.kind === "not_found"
                  ? "This course is no longer available in Canvas."
                  : "Canvas doesn't let your account read this course.",
              );
              return null;
            }
            throw err;
          }
        });
        // Start extracting this course's new/changed files while the next course syncs.
        if (deps.enqueue) {
          await step(`enqueue:${course.id}`, async () => {
            const ids = await pendingDocumentIds(deps.db, userId, course.id);
            await deps.enqueue?.(ids.map((documentId) => ({ userId, documentId })));
            return ids.length;
          });
        }
      } catch (err) {
        if (FatalSyncError.decode(err)) throw err;
        // This course failed even after retries (e.g. removed from Canvas).
        // Record it and carry on with the others.
        await step(`course-failed:${course.id}`, async () => {
          const message =
            err instanceof CanvasError && err.kind === "not_found"
              ? "This course is no longer available in Canvas."
              : "Couldn't sync this course. It'll be retried next time.";
          await update("failed", undefined, message);
          return null;
        });
      }
    }

    await step("finish", async () => {
      const run = await loadRun(deps.db, params);
      const progress = run.progress;
      const totals = { modules: 0, moduleItems: 0, assignments: 0, files: 0, pages: 0 };
      let failed = 0;
      for (const c of progress?.courses ?? []) {
        if (c.state === "failed") failed++;
        for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += c.counts[k];
      }
      const allFailed = failed > 0 && failed === (progress?.courses.length ?? 0);
      await saveRun(deps, params, {
        status: allFailed ? "failed" : "succeeded",
        error: allFailed ? "None of your courses could be synced." : null,
        errorCode: allFailed ? "all_courses_failed" : null,
        stats: { ...totals, failedCourses: failed },
        progress: progress ? { ...progress, stage: "done" } : null,
        finishedAt: new Date(),
      });
      return null;
    });
  } catch (err) {
    const fatal = FatalSyncError.decode(err);
    await step("fail", async () => {
      const run = await loadRun(deps.db, params).catch(() => null);
      if (!run) return null;
      await saveRun(deps, params, {
        status: "failed",
        error: fatal?.message ?? "The sync failed. Try again in a few minutes.",
        errorCode: fatal?.code ?? "sync_failed",
        progress: run.progress ? { ...run.progress, stage: "done" } : null,
        finishedAt: new Date(),
      });
      return null;
    });
    if (!fatal) throw err;
  }
}

/**
 * Users due for a scheduled sync: active Canvas connection, finished onboarding,
 * nothing in flight, and no successful run in the last `staleAfterMs`. Oldest first.
 */
export async function dueForScheduledSync(
  db: Database,
  { limit = 25, staleAfterMs = 6 * 60 * 60 * 1000 } = {},
) {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const lastOk = sql<Date | null>`(
    select max(${syncRuns.finishedAt}) from ${syncRuns}
    where ${syncRuns.userId} = ${canvasConnections.userId} and ${syncRuns.status} = 'succeeded'
  )`;
  const rows = await db
    .select({ userId: canvasConnections.userId })
    .from(canvasConnections)
    .innerJoin(users, eq(users.id, canvasConnections.userId))
    .where(
      and(
        eq(canvasConnections.status, "active"),
        sql`${users.onboardedAt} is not null`,
        sql`not exists (
          select 1 from ${syncRuns}
          where ${syncRuns.userId} = ${canvasConnections.userId}
            and ${syncRuns.status} in ('queued', 'running')
        )`,
        sql`coalesce(${lastOk}, 'epoch'::timestamptz) < ${cutoff.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(sql`coalesce(${lastOk}, 'epoch'::timestamptz) asc`)
    .limit(limit);
  return rows.map((r) => r.userId);
}

export async function latestRuns(db: Database, userId: string, limit: number) {
  const rows = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.userId, userId))
    .orderBy(desc(syncRuns.createdAt))
    .limit(limit);
  return rows.map(toSyncRun);
}
