import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { ApiError, DeleteAccount } from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { eq, schema } from "@talvra/db";
import type { AppEnv, Bindings } from "../env.js";
import type { FileStore } from "../ingest/process.js";
import { AppError } from "../lib/errors.js";
import { requireUser } from "../middleware/auth.js";
import { searchDepsFor } from "./search.js";

const json = <T>(s: T) => ({ "application/json": { schema: s } });

/** Everything about a student, minus secrets (password hash, tokens, ciphertext). */
export async function exportAccount(db: Database, userId: string) {
  const by = <T extends { userId: unknown }>(t: T) => eq(t.userId as never, userId);
  const s = schema;
  const [user] = await db
    .select({
      id: s.users.id,
      email: s.users.email,
      name: s.users.name,
      createdAt: s.users.createdAt,
      onboardedAt: s.users.onboardedAt,
    })
    .from(s.users)
    .where(eq(s.users.id, userId));
  const [canvas] = await db
    .select({
      baseUrl: s.canvasConnections.baseUrl,
      status: s.canvasConnections.status,
      tokenLast4: s.canvasConnections.tokenLast4,
    })
    .from(s.canvasConnections)
    .where(by(s.canvasConnections));
  // The student's own AI key: which provider and model, never the key itself.
  const [ai] = await db
    .select({
      provider: s.aiSettings.provider,
      model: s.aiSettings.model,
      keyLast4: s.aiSettings.keyLast4,
      status: s.aiSettings.status,
    })
    .from(s.aiSettings)
    .where(by(s.aiSettings));
  const [
    courses,
    modules,
    assignments,
    documents,
    studyAids,
    flashcards,
    reviews,
    briefs,
    plan,
    reminderPrefs,
    notifications,
    syncRuns,
    videos,
  ] = await Promise.all([
    db.select().from(s.courses).where(by(s.courses)),
    db.select().from(s.modules).where(by(s.modules)),
    db.select().from(s.assignments).where(by(s.assignments)),
    db
      .select({
        id: s.documents.id,
        courseId: s.documents.courseId,
        source: s.documents.source,
        title: s.documents.title,
        mimeType: s.documents.mimeType,
        sizeBytes: s.documents.sizeBytes,
        status: s.documents.status,
        createdAt: s.documents.createdAt,
      })
      .from(s.documents)
      .where(by(s.documents)),
    db.select().from(s.studyAids).where(by(s.studyAids)),
    db.select().from(s.flashcards).where(by(s.flashcards)),
    db.select().from(s.flashcardReviews).where(by(s.flashcardReviews)),
    db.select().from(s.assignmentBriefs).where(by(s.assignmentBriefs)),
    db.select().from(s.planSteps).where(by(s.planSteps)),
    db.select().from(s.reminderPrefs).where(by(s.reminderPrefs)),
    db.select().from(s.notifications).where(by(s.notifications)),
    db.select().from(s.syncRuns).where(by(s.syncRuns)),
    db.select().from(s.videos).where(by(s.videos)),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    note: "Your Talvra data. Original files can be downloaded from each document page.",
    user,
    canvas: canvas ?? null,
    aiKey: ai ?? null,
    courses,
    modules,
    assignments,
    documents,
    studyAids,
    flashcards,
    flashcardReviews: reviews,
    assignmentBriefs: briefs,
    planSteps: plan,
    reminderPrefs,
    notifications,
    syncRuns,
    videos,
  };
}

/** Deletes every file under the user's R2 prefix. */
async function purgeFiles(files: Pick<R2Bucket, "list" | "delete">, userId: string) {
  let cursor: string | undefined;
  do {
    const page = await files.list({ prefix: `u/${userId}/`, cursor, limit: 1000 });
    if (page.objects.length) await files.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

const exportRoute = createRoute({
  method: "get",
  path: "/me/export",
  tags: ["account"],
  summary: "Download all your data as JSON",
  middleware: [requireUser] as const,
  responses: {
    200: { description: "Export (attachment)" },
    401: { description: "Not signed in", content: json(ApiError) },
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/me",
  tags: ["account"],
  summary: "Permanently delete the account and everything in it",
  middleware: [requireUser] as const,
  request: { body: { content: json(DeleteAccount), required: true } },
  responses: {
    204: { description: "Deleted" },
    422: { description: "Confirmation didn't match", content: json(ApiError) },
    401: { description: "Not signed in", content: json(ApiError) },
  },
});

export function accountRoutes(opts: { files?: FileStore & Pick<R2Bucket, "list"> } = {}) {
  const filesOf = (env: Bindings) => opts.files ?? env.FILES;
  return new OpenAPIHono<AppEnv>()
    .openapi(exportRoute, async (c) => {
      const data = await exportAccount(c.var.db, c.get("userId") as string);
      return new Response(JSON.stringify(data, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="talvra-export-${new Date().toISOString().slice(0, 10)}.json"`,
          "cache-control": "no-store",
        },
      }) as never;
    })
    .openapi(deleteRoute, async (c) => {
      const userId = c.get("userId") as string;
      const db = c.var.db;
      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      if (!user) throw new AppError("unauthorized", "Sign in to continue.");
      const { confirm } = c.req.valid("json");
      if (confirm.toLowerCase() !== user.email.toLowerCase()) {
        throw new AppError("validation_failed", "Type your email exactly to confirm.", [
          { path: "confirm", message: "Doesn't match your email" },
        ]);
      }
      // Search vectors first (they're keyed by chunk id, which the cascade removes).
      const { vectors } = searchDepsFor(c.env);
      if (vectors) {
        const ids = (
          await db
            .select({ id: schema.chunks.id })
            .from(schema.chunks)
            .where(eq(schema.chunks.userId, userId))
        ).map((r) => r.id);
        for (let i = 0; i < ids.length; i += 500)
          await vectors.deleteByIds(ids.slice(i, i + 500)).catch(() => {});
      }
      const files = filesOf(c.env);
      if (files && "list" in files) await purgeFiles(files, userId);
      // Cascades to every user-owned row, including sessions.
      await db.delete(schema.users).where(eq(schema.users.id, userId));
      console.log(JSON.stringify({ msg: "account deleted", userId }));
      // Better Auth cookies use the "talvra" prefix; __Secure- variants need Secure to be cleared.
      for (const base of ["talvra.session_token", "talvra.session_data"]) {
        c.header("Set-Cookie", `${base}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`, {
          append: true,
        });
        c.header(
          "Set-Cookie",
          `__Secure-${base}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
          {
            append: true,
          },
        );
      }
      return c.body(null, 204);
    });
}
