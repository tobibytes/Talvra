import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env.js";
import { AppError } from "../lib/errors.js";

/**
 * Every /v1 route except health sits behind this. Session 3 wires Better Auth
 * in front of it to set `userId`; until then all user routes return 401.
 */
export const requireUser = createMiddleware<AppEnv & { Variables: { userId: string } }>(
  async (c, next) => {
    if (!c.get("userId")) throw new AppError("unauthorized", "Sign in to continue.");
    await next();
  },
);
