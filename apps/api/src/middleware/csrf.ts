import { createMiddleware } from "hono/factory";
import { type AppEnv, appOrigins } from "../env.js";
import { AppError } from "../lib/errors.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cookies are SameSite=Lax, but don't rely on that alone: a state-changing
 * request must come from the app's own origin. Browsers always send Origin on
 * cross-origin POST/PUT/PATCH/DELETE; Sec-Fetch-Site covers the rest.
 */
export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (!SAFE.has(c.req.method)) {
    const origin = c.req.header("origin");
    const site = c.req.header("sec-fetch-site");
    const ok = origin
      ? appOrigins(c.env).includes(origin)
      : !site || site === "same-origin" || site === "none";
    if (!ok) throw new AppError("forbidden", "Cross-site request refused.");
  }
  await next();
});
