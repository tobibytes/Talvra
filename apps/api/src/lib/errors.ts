import { type ApiError, type ErrorCode, errorStatus } from "@talvra/contracts";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodError } from "zod";
import type { AppEnv } from "../env.js";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export function errorBody(c: Context<AppEnv>, err: AppError): ApiError {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
      requestId: c.get("requestId") ?? "unknown",
    },
  };
}

export function sendError(c: Context<AppEnv>, err: AppError) {
  return c.json(errorBody(c, err), errorStatus[err.code] as ContentfulStatusCode);
}

export function fromZod(error: ZodError): AppError {
  return new AppError(
    "validation_failed",
    "Some fields are invalid.",
    error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}
