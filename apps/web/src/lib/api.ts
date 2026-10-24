import {
  AiModelList,
  AiSettings,
  ApiError,
  type AskEvent,
  AskEvent as AskEventSchema,
  type AskInput,
  AssignmentDetail,
  AssignmentList,
  BriefResponse,
  CanvasCourseList,
  type ConnectCanvas,
  ConnectCanvasResult,
  CourseDetail,
  CourseDocument,
  CourseDocumentList,
  CourseList,
  CourseModuleList,
  DocumentAids,
  DocumentContent,
  DocumentDetail,
  DocumentList,
  FlashcardList,
  Health,
  HomeworkList,
  type ListAiModels,
  Me,
  Plan,
  PlanSuggestion,
  PublicConfig,
  RemindersOverview,
  ReviewResult,
  type SaveAiKey,
  type SavePlan,
  SearchResult,
  StudyAid,
  type StudyAidKind,
  StudySummary,
  SyncRun,
  SyncRunList,
  Today,
  type UpdateMe,
  type UpdateReminderPrefs,
  Video,
  VideoState,
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
  exportUrl: `${API_BASE}/v1/me/export`,
  deleteAccount: (confirm: string) =>
    request("/v1/me", z.undefined(), { method: "DELETE", json: { confirm } }),
  completeOnboarding: () => request("/v1/me/onboarding/complete", Me, { method: "POST" }),
  connectCanvas: (body: ConnectCanvas) =>
    request("/v1/canvas/connection", ConnectCanvasResult, { method: "PUT", json: body }),
  verifyCanvas: () =>
    request("/v1/canvas/connection/verify", ConnectCanvasResult, { method: "POST" }),
  disconnectCanvas: () => request("/v1/canvas/connection", z.undefined(), { method: "DELETE" }),
  aiSettings: () => request("/v1/me/ai", AiSettings),
  aiModels: (body: ListAiModels) =>
    request("/v1/me/ai/models", AiModelList, { method: "POST", json: body }),
  saveAiKey: (body: SaveAiKey) => request("/v1/me/ai", AiSettings, { method: "PUT", json: body }),
  removeAiKey: () => request("/v1/me/ai", AiSettings, { method: "DELETE" }),
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
  documentAids: (id: string) => request(`/v1/documents/${id}/aids`, DocumentAids),
  generateAid: (id: string, kind: StudyAidKind, regenerate = false) =>
    request(`/v1/documents/${id}/aids`, StudyAid, { method: "POST", json: { kind, regenerate } }),
  dueCards: (params: { courseId?: string; documentId?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
    return request(`/v1/flashcards/due?${q}`, FlashcardList);
  },
  reviewCard: (id: string, rating: 1 | 2 | 3 | 4) =>
    request(`/v1/flashcards/${id}/review`, ReviewResult, { method: "POST", json: { rating } }),
  studySummary: () => request("/v1/study/summary", StudySummary),
  search: (params: { q: string; courseId?: string; limit?: number }) => {
    const q = new URLSearchParams({ q: params.q });
    if (params.courseId) q.set("courseId", params.courseId);
    if (params.limit) q.set("limit", String(params.limit));
    return request(`/v1/search?${q}`, SearchResult);
  },
  homework: (params: { courseId?: string; scope?: "open" | "all" } = {}) => {
    const q = new URLSearchParams();
    if (params.courseId) q.set("courseId", params.courseId);
    if (params.scope) q.set("scope", params.scope);
    return request(`/v1/homework?${q}`, HomeworkList);
  },
  assignment: (id: string) => request(`/v1/homework/${id}`, AssignmentDetail),
  brief: (id: string) => request(`/v1/homework/${id}/brief`, BriefResponse),
  makeBrief: (id: string, regenerate = false) =>
    request(`/v1/homework/${id}/brief`, BriefResponse, { method: "POST", json: { regenerate } }),
  resources: (id: string) => request(`/v1/homework/${id}/resources`, SearchResult),
  plan: (id: string) => request(`/v1/homework/${id}/plan`, Plan),
  savePlan: (id: string, body: SavePlan) =>
    request(`/v1/homework/${id}/plan`, Plan, { method: "PUT", json: body }),
  toggleStep: (id: string, stepId: string, done: boolean) =>
    request(`/v1/homework/${id}/plan/${stepId}`, Plan, { method: "PATCH", json: { done } }),
  suggestPlan: (id: string) =>
    request(`/v1/homework/${id}/plan/suggest`, PlanSuggestion, { method: "POST" }),
  today: (date: string) => request(`/v1/today?date=${date}`, Today),
  reminders: () => request("/v1/reminders", RemindersOverview),
  videoState: (documentId: string) => request(`/v1/documents/${documentId}/video`, VideoState),
  makeVideo: (documentId: string) =>
    request(`/v1/documents/${documentId}/video`, Video, { method: "POST" }),
  videoStreamUrl: (id: string) => `${API_BASE}/v1/videos/${id}/stream`,
  videoCaptionsUrl: (id: string) => `${API_BASE}/v1/videos/${id}/captions.vtt`,
  saveReminderPrefs: (body: UpdateReminderPrefs) =>
    request("/v1/reminders/prefs", RemindersOverview, { method: "PUT", json: body }),
  testReminder: () =>
    request("/v1/reminders/test", z.object({ sentTo: z.string() }), { method: "POST" }),
  /** Streams an answer; calls `onEvent` for each server-sent event. */
  ask: async (input: AskInput, onEvent: (e: AskEvent) => void, signal?: AbortSignal) => {
    const res = await fetch(`${API_BASE}/v1/ask`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
    if (!res.ok || !res.body) {
      const body: unknown = await res.json().catch(() => null);
      const parsed = ApiError.safeParse(body);
      throw new ApiRequestError(res.status, parsed.success ? parsed.data : null);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let cut = buffer.indexOf("\n\n");
      while (cut >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data) {
          const parsed = AskEventSchema.safeParse(JSON.parse(data));
          if (parsed.success) onEvent(parsed.data);
        }
        cut = buffer.indexOf("\n\n");
      }
    }
  },
};
