import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { ApiError, Me, UpdateMe } from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { eq, schema } from "@talvra/db";
import type { AppEnv } from "../env.js";
import { AppError } from "../lib/errors.js";
import { requireUser } from "../middleware/auth.js";

const { users, canvasConnections } = schema;
const json = <T>(s: T) => ({ "application/json": { schema: s } });
const unauthorized = { 401: { description: "Not signed in", content: json(ApiError) } };

export async function loadMe(db: Database, userId: string): Promise<Me> {
  const [row] = await db
    .select({ user: users, canvas: canvasConnections })
    .from(users)
    .leftJoin(canvasConnections, eq(canvasConnections.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) throw new AppError("unauthorized", "Your account no longer exists.");
  const { user, canvas } = row;
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      emailVerified: user.emailVerified,
    },
    onboarded: user.onboardedAt !== null,
    canvas: canvas
      ? {
          baseUrl: canvas.baseUrl,
          status: canvas.status,
          tokenLast4: canvas.tokenLast4,
          lastVerifiedAt: canvas.lastVerifiedAt?.toISOString() ?? null,
        }
      : null,
  };
}

const getMe = createRoute({
  method: "get",
  path: "/me",
  tags: ["account"],
  summary: "The signed-in user, onboarding state and Canvas connection",
  middleware: [requireUser] as const,
  responses: { 200: { description: "Me", content: json(Me) }, ...unauthorized },
});

const patchMe = createRoute({
  method: "patch",
  path: "/me",
  tags: ["account"],
  summary: "Update profile fields",
  middleware: [requireUser] as const,
  request: { body: { content: json(UpdateMe), required: true } },
  responses: { 200: { description: "Me", content: json(Me) }, ...unauthorized },
});

const completeOnboarding = createRoute({
  method: "post",
  path: "/me/onboarding/complete",
  tags: ["account"],
  summary: "Mark onboarding as finished",
  middleware: [requireUser] as const,
  responses: {
    200: { description: "Me", content: json(Me) },
    409: { description: "Canvas not connected yet", content: json(ApiError) },
    ...unauthorized,
  },
});

export const meRoutes = new OpenAPIHono<AppEnv>()
  .openapi(getMe, async (c) => c.json(await loadMe(c.var.db, c.get("userId") as string), 200))
  .openapi(patchMe, async (c) => {
    const userId = c.get("userId") as string;
    await c.var.db.update(users).set(c.req.valid("json")).where(eq(users.id, userId));
    return c.json(await loadMe(c.var.db, userId), 200);
  })
  .openapi(completeOnboarding, async (c) => {
    const userId = c.get("userId") as string;
    const me = await loadMe(c.var.db, userId);
    if (!me.canvas) throw new AppError("conflict", "Connect Canvas before finishing setup.");
    await c.var.db.update(users).set({ onboardedAt: new Date() }).where(eq(users.id, userId));
    return c.json({ ...me, onboarded: true }, 200);
  });
