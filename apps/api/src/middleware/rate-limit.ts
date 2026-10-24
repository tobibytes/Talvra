import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env.js";
import { AppError } from "../lib/errors.js";

export type LimiterName = "RL_AUTH" | "RL_HEAVY" | "RL_API";
export type Limiters = Partial<Record<LimiterName, RateLimit>>;

/**
 * Cloudflare Rate Limiting binding (fixed window per key). `key` decides who
 * shares a bucket: the client IP for sign-in, the user id elsewhere. Missing
 * binding (local dev) = no limit.
 */
export function rateLimit(name: LimiterName, by: "ip" | "user", injected?: Limiters) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const limiter = injected?.[name] ?? c.env[name];
    if (limiter) {
      const who =
        by === "user"
          ? c.get("userId")
          : (c.req.header("cf-connecting-ip") ??
            c.req.header("x-forwarded-for")?.split(",")[0]?.trim());
      if (who) {
        const { success } = await limiter.limit({ key: `${name}:${who}` });
        if (!success) {
          c.header("Retry-After", "60");
          throw new AppError("rate_limited", "Too many requests. Wait a minute and try again.");
        }
      }
    }
    await next();
  });
}
