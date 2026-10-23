import { z } from "zod";

/**
 * Every non-2xx API response uses this envelope, so the web app (and the MCP
 * server later) can handle failures in one place.
 */
export const ErrorCode = z.enum([
  "bad_request",
  "validation_failed",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    /** Field-level problems for validation_failed. */
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    /** Echoes the X-Request-Id header so users can quote it in bug reports. */
    requestId: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const errorStatus: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};
