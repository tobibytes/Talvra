import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env.js";
import { AppError } from "../lib/errors.js";

/** Guards every /api/v1 route. The session middleware in app.ts sets `userId`. */
export const requireUser = createMiddleware<AppEnv & { Variables: { userId: string } }>(
  async (c, next) => {
    if (!c.get("userId")) throw new AppError("unauthorized", "Sign in to continue.");
    await next();
  },
);
