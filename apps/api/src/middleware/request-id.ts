import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env.js";

const VALID = /^[A-Za-z0-9._-]{8,128}$/;

/** Reuses a sane incoming X-Request-Id (e.g. from Cloudflare) or mints one. */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header("x-request-id");
  const id = incoming && VALID.test(incoming) ? incoming : `req_${crypto.randomUUID()}`;
  c.set("requestId", id);
  c.header("X-Request-Id", id);
  await next();
});
