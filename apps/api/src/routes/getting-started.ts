import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { ApiError, GettingStarted } from "@talvra/contracts";
import { and, type Database, eq, inArray, schema } from "@talvra/db";
import type { AppEnv } from "../env.js";
import { requireUser } from "../middleware/auth.js";

const {
  users,
  canvasConnections,
  studyAids,
  flashcardReviews,
  usageEvents,
  apiKeys,
  oauthConsents,
} = schema;
const json = <T>(s: T) => ({ "application/json": { schema: s } });
const unauthorized = { 401: { description: "Not signed in", content: json(ApiError) } };

const get = createRoute({
  method: "get",
  path: "/me/getting-started",
  tags: ["account"],
  summary: "The Today checklist: which first steps the data shows are done",
  middleware: [requireUser] as const,
  responses: { 200: { description: "Checklist", content: json(GettingStarted) }, ...unauthorized },
});

const dismiss = createRoute({
  method: "post",
  path: "/me/getting-started/dismiss",
  tags: ["account"],
  summary: "Hide the checklist for good",
  middleware: [requireUser] as const,
  responses: { 200: { description: "Checklist", content: json(GettingStarted) }, ...unauthorized },
});

/** Each step is done when a matching row exists for this user (one indexed lookup each). */
export async function loadGettingStarted(db: Database, userId: string): Promise<GettingStarted> {
  const any = async (rows: Promise<unknown[]>) => (await rows).length > 0;
  const [user, canvas, studyAid, review, ask, key, consent] = await Promise.all([
    db
      .select({ dismissedAt: users.gettingStartedDismissedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    any(
      db
        .select({ id: canvasConnections.id })
        .from(canvasConnections)
        .where(eq(canvasConnections.userId, userId))
        .limit(1),
    ),
    any(
      db.select({ id: studyAids.id }).from(studyAids).where(eq(studyAids.userId, userId)).limit(1),
    ),
    any(
      db
        .select({ id: flashcardReviews.id })
        .from(flashcardReviews)
        .where(eq(flashcardReviews.userId, userId))
        .limit(1),
    ),
    // Ask is metered on Talvra's AI and the basic model; a student's own key isn't metered.
    any(
      db
        .select({ id: usageEvents.id })
        .from(usageEvents)
        .where(and(eq(usageEvents.userId, userId), inArray(usageEvents.kind, ["ask", "basic_ask"])))
        .limit(1),
    ),
    any(db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.userId, userId)).limit(1)),
    any(
      db
        .select({ id: oauthConsents.id })
        .from(oauthConsents)
        .where(eq(oauthConsents.userId, userId))
        .limit(1),
    ),
  ]);
  return {
    steps: { canvas, studyAid, review, ask, assistant: key || consent },
    dismissed: !!user[0]?.dismissedAt,
  };
}

export const gettingStartedRoutes = new OpenAPIHono<AppEnv>()
  .openapi(get, async (c) =>
    c.json(await loadGettingStarted(c.var.db, c.get("userId") as string), 200),
  )
  .openapi(dismiss, async (c) => {
    const userId = c.get("userId") as string;
    await c.var.db
      .update(users)
      .set({ gettingStartedDismissedAt: new Date() })
      .where(eq(users.id, userId));
    return c.json(await loadGettingStarted(c.var.db, userId), 200);
  });
