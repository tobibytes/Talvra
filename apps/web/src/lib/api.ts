import { ApiError, CourseList, Health } from "@talvra/contracts";
import type { z } from "zod";

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8787";

/** Thrown for any non-2xx response; carries the server's error envelope. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(body?.error.message ?? `Request failed (${status})`);
  }
  get requestId() {
    return this.body?.error.requestId;
  }
}

async function request<T extends z.ZodType>(
  path: string,
  schema: T,
  init?: RequestInit,
): Promise<z.infer<T>> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include", ...init });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiError.safeParse(json);
    throw new ApiRequestError(res.status, parsed.success ? parsed.data : null);
  }
  // Validate responses too, so a contract drift fails loudly in dev.
  return schema.parse(json);
}

export const api = {
  health: () => request("/health", Health),
  courses: (params: { cursor?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.cursor) q.set("cursor", params.cursor);
    if (params.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request(`/v1/courses${qs ? `?${qs}` : ""}`, CourseList);
  },
};
