import {
  ApiError,
  AssignmentList,
  CanvasCourseList,
  type ConnectCanvas,
  ConnectCanvasResult,
  CourseDetail,
  CourseDocument,
  CourseDocumentList,
  CourseList,
  CourseModuleList,
  DocumentContent,
  DocumentDetail,
  DocumentList,
  Health,
  Me,
  PublicConfig,
  SyncRun,
  SyncRunList,
  type UpdateMe,
} from "@talvra/contracts";
import { z } from "zod";

/** The API is served from the same origin under /api (Vite proxies it in dev). */
export const API_BASE = "/api";

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
  /** Message for a specific field from a validation_failed response. */
  fieldError(path: string) {
    return this.body?.error.details?.find((d) => d.path === path)?.message;
  }
}

async function request<T extends z.ZodType>(
  path: string,
  schema: T,
  init: Omit<RequestInit, "body"> & { json?: unknown } = {},
): Promise<z.infer<T>> {
  const { json, ...rest } = init;
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...rest,
    headers:
      json === undefined ? rest.headers : { "content-type": "application/json", ...rest.headers },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  if (res.status === 204) return schema.parse(undefined);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiError.safeParse(body);
    throw new ApiRequestError(res.status, parsed.success ? parsed.data : null);
  }
  // Validate responses too, so a contract drift fails loudly in dev.
  return schema.parse(body);
}

export const api = {
  health: () => request("/health", Health),
  config: () => request("/config", PublicConfig),
  /** The signed-in user, or null when signed out. */
  me: async () => {
    try {
      return await request("/v1/me", Me);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) return null;
      throw err;
    }
  },
  updateMe: (body: UpdateMe) => request("/v1/me", Me, { method: "PATCH", json: body }),
  completeOnboarding: () => request("/v1/me/onboarding/complete", Me, { method: "POST" }),
  connectCanvas: (body: ConnectCanvas) =>
    request("/v1/canvas/connection", ConnectCanvasResult, { method: "PUT", json: body }),
  verifyCanvas: () =>
    request("/v1/canvas/connection/verify", ConnectCanvasResult, { method: "POST" }),
  disconnectCanvas: () => request("/v1/canvas/connection", z.undefined(), { method: "DELETE" }),
  canvasCourses: () => request("/v1/canvas/courses", CanvasCourseList),
  selectCourses: (canvasIds: string[]) =>
    request("/v1/courses/selection", CourseList, { method: "PUT", json: { canvasIds } }),
  courses: (params: { cursor?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.cursor) q.set("cursor", params.cursor);
    if (params.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request(`/v1/courses${qs ? `?${qs}` : ""}`, CourseList);
  },
  course: (id: string) => request(`/v1/courses/${id}`, CourseDetail),
  courseModules: (id: string) => request(`/v1/courses/${id}/modules`, CourseModuleList),
  courseAssignments: (id: string) => request(`/v1/courses/${id}/assignments`, AssignmentList),
  courseDocuments: (id: string) => request(`/v1/courses/${id}/documents`, CourseDocumentList),
  startSync: (courseId?: string) =>
    request("/v1/sync", SyncRun, { method: "POST", json: courseId ? { courseId } : {} }),
  syncRuns: (limit = 10) => request(`/v1/sync/runs?limit=${limit}`, SyncRunList),
  document: (id: string) => request(`/v1/documents/${id}`, DocumentDetail),
  documentContent: (id: string) => request(`/v1/documents/${id}/content`, DocumentContent),
  documents: (source?: "upload") =>
    request(`/v1/documents${source ? `?source=${source}` : ""}`, DocumentList),
  retryDocument: (id: string) =>
    request(`/v1/documents/${id}/retry`, DocumentDetail, { method: "POST" }),
  deleteDocument: (id: string) =>
    request(`/v1/documents/${id}`, z.undefined(), { method: "DELETE" }),
  /** Multipart upload; the browser sets the boundary. */
  uploadDocument: async (file: File, courseId?: string) => {
    const form = new FormData();
    form.set("file", file);
    if (courseId) form.set("courseId", courseId);
    const res = await fetch(`${API_BASE}/v1/documents`, {
      method: "POST",
      body: form,
      credentials: "include",
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const parsed = ApiError.safeParse(body);
      throw new ApiRequestError(res.status, parsed.success ? parsed.data : null);
    }
    return CourseDocument.parse(body);
  },
  originalUrl: (id: string) => `${API_BASE}/v1/documents/${id}/original`,
};
