import type { Course, DocumentDetail, Me, SyncRun } from "@talvra/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { ThemeProvider } from "@/components/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routeTree } from "./routeTree.gen";

/** Renders the full app (guards + shell + routes) at a path, with retries off. */
export async function renderApp(path = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const utils = render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  await screen.findByRole("main");
  return { ...utils, router };
}

export const GOOD_TOKEN = "1234~goodgoodgoodgoodgoodgood";

export function makeMe(overrides: Partial<Me> = {}): Me {
  return {
    user: {
      id: "0b8f6c3e-6a0a-4b6a-9c43-2f1f4e1a8c11",
      name: "Oluwatobi Olajide",
      email: "olola@morgan.edu",
      image: null,
      emailVerified: true,
    },
    onboarded: true,
    canvas: {
      baseUrl: "https://morgan.instructure.com",
      status: "active",
      tokenLast4: "good",
      lastVerifiedAt: "2026-10-23T12:00:00.000Z",
    },
    ...overrides,
  };
}

/**
 * A fake backend for the web tests: just enough of /api and Better Auth's
 * /api/auth to drive the real UI. `state.me = null` means signed out.
 */
export const COURSE_ID = "11111111-1111-4111-8111-111111111111";
export const MODULE_ID = "22222222-2222-4222-8222-222222222222";

export function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: COURSE_ID,
    canvasId: "101",
    name: "COSC 220 Data Structures",
    courseCode: "COSC 220",
    term: "Fall 2026",
    selected: true,
    lastSyncedAt: "2026-10-23T12:00:00.000Z",
    ...overrides,
  };
}

const counts = { modules: 1, moduleItems: 3, assignments: 2, files: 1, pages: 1 };

export function makeRun(overrides: Partial<SyncRun> = {}): SyncRun {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    courseId: null,
    trigger: "manual",
    status: "succeeded",
    progress: {
      stage: "done",
      coursesDone: 1,
      coursesTotal: 1,
      courses: [{ courseId: COURSE_ID, name: "COSC 220 Data Structures", state: "done", counts }],
    },
    stats: { ...counts, failedCourses: 0 },
    error: null,
    errorCode: null,
    startedAt: "2026-10-23T12:00:00.000Z",
    finishedAt: "2026-10-23T12:01:00.000Z",
    createdAt: "2026-10-23T12:00:00.000Z",
    ...overrides,
  };
}

export const DOC_ID = "44444444-4444-4444-8444-444444444444";

export function makeDocument(overrides: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    id: DOC_ID,
    courseId: COURSE_ID,
    moduleId: null,
    source: "canvas_file",
    title: "Lecture 1.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2_400_000,
    folderPath: "course files/Lectures",
    status: "ready",
    updatedAt: "2026-10-20T00:00:00.000Z",
    courseName: "COSC 220 Data Structures",
    pageCount: 2,
    wordCount: 1234,
    warnings: [],
    error: null,
    extractedAt: "2026-10-20T00:00:00.000Z",
    canvasHtmlUrl: "https://morgan.instructure.com/courses/101/files/501",
    hasOriginal: true,
    ...overrides,
  };
}

export function fakeApi(state: {
  me: Me | null;
  runs?: SyncRun[];
  courses?: Course[];
  documents?: DocumentDetail[];
}) {
  state.documents ??= [];
  state.runs ??= [];
  state.courses ??= [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const apiError = (status: number, code: string, message: string, details?: unknown) =>
    json(
      { error: { code, message, requestId: "req_test", ...(details ? { details } : {}) } },
      status,
    );
  const canvasCourses = [
    {
      canvasId: "101",
      name: "COSC 220 Data Structures",
      courseCode: "COSC 220",
      term: "Fall 2026",
      selected: false,
    },
    {
      canvasId: "102",
      name: "MATH 241 Calculus I",
      courseCode: "MATH 241",
      term: "Fall 2026",
      selected: false,
    },
  ];
  let selected: string[] = [];

  const handler = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req =
      input instanceof Request
        ? input
        : new Request(new URL(String(input), "http://localhost"), init);
    const url = new URL(req.url);
    const method = req.method;
    const body =
      method === "GET"
        ? null
        : await req
            .clone()
            .json()
            .catch(() => null);
    const p = url.pathname;

    if (p === "/api/health")
      return json({ status: "ok", version: "test", checks: { database: "ok" } });
    if (p === "/api/config")
      return json({ googleEnabled: false, allowedEmailDomains: ["morgan.edu"] });

    // Better Auth
    if (p === "/api/auth/sign-in/email") {
      if (body?.password === "correct horse battery") {
        state.me = makeMe();
        return json({ redirect: false, token: "t", user: state.me.user });
      }
      return json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, 401);
    }
    if (p === "/api/auth/sign-up/email") return json({ token: null, user: {} });
    if (p === "/api/auth/sign-out") {
      state.me = null;
      return json({ success: true });
    }
    if (p === "/api/auth/get-session") {
      return json(
        state.me ? { session: { token: "current", id: "s1" }, user: state.me.user } : null,
      );
    }
    if (p === "/api/auth/list-sessions") {
      return json([
        {
          id: "s1",
          token: "current",
          userAgent: "Mozilla/5.0 (Macintosh) Chrome/140",
          createdAt: "2026-10-20T00:00:00Z",
        },
        {
          id: "s2",
          token: "other",
          userAgent: "Mozilla/5.0 (iPhone) Safari",
          createdAt: "2026-10-01T00:00:00Z",
        },
      ]);
    }

    if (!state.me) return apiError(401, "unauthorized", "Sign in to continue.");
    const me = state.me;

    if (p === "/api/v1/me" && method === "GET") return json(me);
    if (p === "/api/v1/me" && method === "PATCH") {
      state.me = { ...me, user: { ...me.user, name: body.name } };
      return json(state.me);
    }
    if (p === "/api/v1/me/onboarding/complete") {
      state.me = { ...me, onboarded: true };
      state.runs?.unshift(
        makeRun({
          trigger: "onboarding",
          status: "running",
          finishedAt: null,
          progress: {
            stage: "courses",
            coursesDone: 0,
            coursesTotal: 1,
            courses: [
              {
                courseId: COURSE_ID,
                name: "COSC 220 Data Structures",
                state: "running",
                counts: { ...counts, files: 0, pages: 0 },
              },
            ],
          },
        }),
      );
      return json(state.me);
    }
    if (p === "/api/v1/sync/runs") return json({ items: state.runs?.slice(0, 1) ?? [] });
    if (p === "/api/v1/sync" && method === "POST") {
      if (state.runs?.some((r) => r.status === "running" || r.status === "queued")) {
        return apiError(409, "conflict", "A sync is already running.");
      }
      const run = makeRun({
        id: crypto.randomUUID(),
        status: "queued",
        finishedAt: null,
        createdAt: new Date().toISOString(),
      });
      state.runs?.unshift(run);
      return json(run, 202);
    }
    if (p === `/api/v1/courses/${COURSE_ID}`) {
      return json({ ...makeCourse(), counts: { modules: 1, assignments: 2, files: 1, pages: 1 } });
    }
    if (p === `/api/v1/courses/${COURSE_ID}/modules`) {
      return json({
        items: [
          {
            id: MODULE_ID,
            name: "Week 1: Arrays",
            position: 1,
            items: [
              {
                id: crypto.randomUUID(),
                title: "Lecture 1 slides",
                kind: "file",
                indent: 0,
                documentId: null,
                assignmentId: null,
                htmlUrl: "https://morgan.instructure.com/courses/101/modules/items/11",
                externalUrl: null,
              },
              {
                id: crypto.randomUUID(),
                title: "Readings",
                kind: "subheader",
                indent: 0,
                documentId: null,
                assignmentId: null,
                htmlUrl: null,
                externalUrl: null,
              },
            ],
          },
        ],
      });
    }
    if (p === `/api/v1/courses/${COURSE_ID}/documents`) {
      return json({
        items: [
          {
            id: crypto.randomUUID(),
            courseId: COURSE_ID,
            moduleId: MODULE_ID,
            source: "canvas_file",
            title: "Lecture 1.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2_400_000,
            folderPath: "course files/Lectures",
            status: "pending",
            updatedAt: "2026-10-20T00:00:00.000Z",
          },
          {
            id: crypto.randomUUID(),
            courseId: COURSE_ID,
            moduleId: null,
            source: "canvas_page",
            title: "Welcome to COSC 220",
            mimeType: "text/html",
            sizeBytes: 300,
            folderPath: null,
            status: "pending",
            updatedAt: "2026-10-20T00:00:00.000Z",
          },
        ],
      });
    }
    if (p === `/api/v1/courses/${COURSE_ID}/assignments`) {
      return json({
        items: [
          {
            id: crypto.randomUUID(),
            courseId: COURSE_ID,
            name: "Lab 1",
            dueAt: "2099-11-01T03:59:00.000Z",
            unlockAt: null,
            lockAt: null,
            pointsPossible: 10,
            submissionTypes: ["online_upload"],
            htmlUrl: "https://morgan.instructure.com/courses/101/assignments/301",
            moduleIds: [MODULE_ID],
          },
          {
            id: crypto.randomUUID(),
            courseId: COURSE_ID,
            name: "Homework 1",
            dueAt: null,
            unlockAt: null,
            lockAt: null,
            pointsPossible: null,
            submissionTypes: [],
            htmlUrl: null,
            moduleIds: [],
          },
        ],
      });
    }
    if (p === "/api/v1/canvas/connection" && method === "PUT") {
      if (body?.token !== GOOD_TOKEN) {
        return apiError(
          422,
          "validation_failed",
          "Canvas didn't accept that token. Check it and try again.",
          [{ path: "token", message: "Canvas rejected this token" }],
        );
      }
      const connection = makeMe().canvas;
      state.me = { ...me, canvas: connection };
      return json({ connection, canvasUserName: "Oluwatobi Olajide" });
    }
    if (p === "/api/v1/canvas/courses") {
      return json({
        items: canvasCourses.map((c) => ({ ...c, selected: selected.includes(c.canvasId) })),
      });
    }
    if (p === "/api/v1/courses/selection") {
      selected = body.canvasIds;
      return json({
        items: canvasCourses
          .filter((c) => selected.includes(c.canvasId))
          .map((c, i) => ({
            ...c,
            id: `00000000-0000-4000-8000-00000000000${i}`,
            selected: true,
            lastSyncedAt: null,
          })),
        nextCursor: null,
      });
    }
    if (p === "/api/v1/courses") return json({ items: state.courses, nextCursor: null });
    if (p === "/api/v1/documents" && method === "GET") {
      const source = url.searchParams.get("source");
      return json({ items: state.documents?.filter((d) => !source || d.source === source) ?? [] });
    }
    const docMatch = p.match(/^\/api\/v1\/documents\/([^/]+)(\/content|\/retry)?$/);
    if (docMatch) {
      const doc = state.documents?.find((d) => d.id === docMatch[1]);
      if (!doc) return apiError(404, "not_found", "Document not found.");
      if (docMatch[2] === "/retry") {
        Object.assign(doc, { status: "pending", error: null });
        return json(doc, 202);
      }
      if (docMatch[2] === "/content") {
        if (doc.status !== "ready") return apiError(404, "not_found", "Not ready.");
        return json({
          markdown:
            "## Page 1\n\nArrays store elements **contiguously**.\n\n## Page 2\n\n| Op | Cost |\n|---|---|\n| index | O(1) |",
          sections: [
            { heading: "Page 1", level: 2, text: "Arrays…", anchor: { kind: "page", n: 1 } },
            { heading: "Page 2", level: 2, text: "Table", anchor: { kind: "page", n: 2 } },
          ],
        });
      }
      return json(doc);
    }
    return apiError(404, "not_found", `No fake for ${method} ${p}`);
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(handler);
  return handler;
}
