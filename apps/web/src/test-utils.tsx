import type {
  Course,
  DocumentAids,
  DocumentDetail,
  Flashcard,
  HomeworkItem,
  Me,
  PlanStep,
  ReminderPrefs,
  StudyAid,
  SyncRun,
  Video,
} from "@talvra/contracts";
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
  // The first render loads the whole route tree; allow for a busy machine (turbo runs suites in parallel).
  await screen.findByRole("main", undefined, { timeout: 15_000 });
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
      baseUrl: "https://morganstate.instructure.com",
      status: "active",
      tokenLast4: "good",
      lastVerifiedAt: "2026-10-23T12:00:00.000Z",
    },
    features: { doHomework: false },
    ...overrides,
  } as Me;
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
    canvasHtmlUrl: "https://morganstate.instructure.com/courses/101/files/501",
    hasOriginal: true,
    ...overrides,
  };
}

export const NOTES = {
  title: "Arrays and lists",
  summary: "How arrays and linked lists store data.",
  sections: [
    {
      heading: "Arrays",
      bullets: [
        { text: "Arrays store elements contiguously.", cite: [{ kind: "page" as const, n: 1 }] },
      ],
    },
  ],
  keyTerms: [{ term: "Array", definition: "A contiguous block.", cite: [] }],
};

export const QUIZ = {
  questions: [
    {
      type: "multiple_choice" as const,
      prompt: "How are arrays stored?",
      choices: ["Contiguously", "As linked nodes", "In a hash table", "As a tree"],
      answerIndex: 0,
      answer: "Contiguously",
      explanation: "Arrays use one block of memory.",
      cite: [{ kind: "page" as const, n: 1 }],
    },
    {
      type: "short_answer" as const,
      prompt: "Why is array indexing O(1)?",
      choices: [],
      answerIndex: -1,
      answer: "The address is base + index × size.",
      explanation: "Direct address arithmetic.",
      cite: [],
    },
  ],
};

export function makeAid(kind: StudyAid["kind"], overrides: Partial<StudyAid> = {}): StudyAid {
  return {
    id: crypto.randomUUID(),
    documentId: DOC_ID,
    kind,
    version: 1,
    status: "ready",
    error: null,
    model: "claude-opus-5-5",
    content:
      kind === "notes"
        ? NOTES
        : kind === "quiz"
          ? QUIZ
          : { cards: [{ front: "How are arrays stored?", back: "Contiguously.", cite: [] }] },
    createdAt: "2026-10-23T12:00:00.000Z",
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as StudyAid;
}

export function makeCard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: crypto.randomUUID(),
    documentId: DOC_ID,
    documentTitle: "Lecture 1.pdf",
    courseId: COURSE_ID,
    front: "How are arrays stored?",
    back: "Contiguously, in one block.",
    cite: [],
    due: "2026-10-23T00:00:00.000Z",
    state: "new",
    reps: 0,
    ...overrides,
  };
}

export const ASSIGNMENT_ID = "66666666-6666-4666-8666-666666666666";

export function makeHomework(overrides: Partial<HomeworkItem> = {}): HomeworkItem {
  return {
    id: ASSIGNMENT_ID,
    courseId: COURSE_ID,
    courseName: "COSC 220 Data Structures",
    courseCode: "COSC 220",
    name: "Lab 2: reverse an array",
    dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    pointsPossible: 10,
    htmlUrl: "https://morganstate.instructure.com/courses/101/assignments/2",
    status: "todo",
    late: false,
    plan: { done: 0, total: 0 },
    ...overrides,
  };
}

export function fakeApi(state: {
  me: Me | null;
  homework?: HomeworkItem[];
  reminderPrefs?: ReminderPrefs;
  plan?: PlanStep[];
  runs?: SyncRun[];
  courses?: Course[];
  documents?: DocumentDetail[];
  aids?: StudyAid[];
  video?: Video;
  cards?: Flashcard[];
  ai?: Record<string, unknown>;
  draft?: Record<string, unknown>;
}) {
  state.documents ??= [];
  state.aids ??= [];
  state.cards ??= [];
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
    if (p.startsWith("/api/v1/me/ai")) {
      const talvra = {
        source: "talvra",
        provider: null,
        model: null,
        keyLast4: null,
        status: null,
        lastError: null,
        defaults: { standard: "Claude Haiku 4.5", advanced: "Claude Opus 5.5", basic: "@cf/basic" },
      };
      if (p === "/api/v1/me/ai/models") {
        if (!String(body?.apiKey).includes("good"))
          return apiError(422, "validation_failed", "Anthropic rejected your API key.");
        return json({
          models: [
            { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
            { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
          ],
          suggested: "claude-opus-5-5",
        });
      }
      if (method === "PUT") {
        state.ai = {
          ...talvra,
          source: "own",
          provider: body.provider,
          model: body.model,
          keyLast4: String(body.apiKey).slice(-4),
          status: "active",
        };
        return json(state.ai);
      }
      if (method === "DELETE") state.ai = undefined;
      return json(state.ai ?? talvra);
    }
    if (p === "/api/v1/me" && method === "DELETE") {
      if (String(body?.confirm).toLowerCase() !== me.user.email) {
        return apiError(422, "validation_failed", "Type your email exactly to confirm.");
      }
      state.me = null;
      return new Response(null, { status: 204 });
    }
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
                htmlUrl: "https://morganstate.instructure.com/courses/101/modules/items/11",
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
            htmlUrl: "https://morganstate.instructure.com/courses/101/assignments/301",
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
    if (p === "/api/v1/reminders" || p === "/api/v1/reminders/prefs") {
      state.reminderPrefs ??= {
        emailEnabled: true,
        offsets: [1440, 180],
        digestEnabled: true,
        digestHour: 7,
        timezone: "America/New_York",
        quietStart: 22,
        quietEnd: 7,
      };
      const prefs = state.reminderPrefs;
      if (method === "PUT") Object.assign(prefs, body);
      return json({
        prefs,
        upcoming: prefs.emailEnabled
          ? [
              {
                assignmentId: ASSIGNMENT_ID,
                assignmentName: "Lab 2: reverse an array",
                courseName: "COSC 220",
                dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
                remindAt: new Date(Date.now() + 86_400_000).toISOString(),
                offsetMinutes: 1440,
              },
            ]
          : [],
        history: [],
      });
    }
    if (p === "/api/v1/reminders/test") return json({ sentTo: state.me?.user.email ?? "" });
    if (p === "/api/v1/homework") return json({ items: state.homework ?? [] });
    if (p === "/api/v1/today") {
      const items = state.homework ?? [];
      return json({
        overdue: items.filter((i) => i.status === "overdue"),
        upcoming: items.filter((i) => i.status === "todo"),
        study: { dueNow: state.cards?.length ?? 0, newCards: 0, reviewedToday: 0 },
        recent: [],
        todaySteps: (state.plan ?? [])
          .filter((s) => s.plannedFor)
          .map((s) => ({
            ...s,
            assignmentId: ASSIGNMENT_ID,
            assignmentName: "Lab 2: reverse an array",
          })),
      });
    }
    const hw = p.match(
      /^\/api\/v1\/homework\/([^/]+)(\/brief|\/resources|\/plan(?:\/suggest|\/[^/]+)?|\/draft(?:\/submit|\/files\/.+)?)?$/,
    );
    if (hw) {
      const item = (state.homework ?? []).find((i) => i.id === hw[1]);
      if (!item) return apiError(404, "not_found", "Assignment not found.");
      const sub = hw[2] ?? "";
      state.plan ??= [];
      const planJson = () => json({ steps: state.plan });
      if (sub === "") {
        return json({
          ...item,
          descriptionMd: "## Task\n\nReverse an array **in place**.",
          unlockAt: null,
          lockAt: null,
          submissionTypes: ["online_upload"],
        });
      }
      if (sub.startsWith("/draft")) {
        if (!me.features?.doHomework) return apiError(404, "not_found", "Not found.");
        const file = sub.match(/^\/draft\/files\/(.+)$/);
        if (file) return new Response(`print("answer")  # ${decodeURIComponent(file[1] ?? "")}`);
        if (sub === "/draft/submit") {
          if (!state.draft) return apiError(409, "conflict", "Make the files first.");
          state.draft = {
            ...state.draft,
            status: "submitted",
            submittedAt: new Date().toISOString(),
          };
          return json({ draft: state.draft });
        }
        if (method === "POST") {
          state.draft = {
            id: "55555555-5555-4555-8555-555555555555",
            status: "ready",
            progress: null,
            files: [{ name: "lab2.py", contentType: "text/x-python", size: 2048 }],
            notes: "Put your name at the top.",
            instructions: body?.instructions ?? null,
            error: null,
            model: "claude-opus-5-5",
            submittedAt: null,
            updatedAt: new Date().toISOString(),
          };
        }
        return json({ draft: state.draft ?? null });
      }
      if (sub === "/brief" && method === "GET") return json({ brief: null });
      if (sub === "/brief") {
        return json({
          brief: {
            status: "ready",
            updatedAt: new Date().toISOString(),
            error: null,
            content: {
              summary: "Write a function that reverses an array without a built-in.",
              deliverables: ["reverse.py"],
              requirements: ["No built-in reverse"],
              rubricPoints: ["Correctness"],
              skills: ["Indexing"],
              questionsForInstructor: ["Is Python 3.12 OK?"],
              searchQueries: ["arrays"],
              attachments: [
                { documentId: DOC_ID, title: "Lab2.pdf", read: true, note: null },
                {
                  documentId: null,
                  title: "data.csv",
                  read: false,
                  note: "Talvra can't read this type of file.",
                },
              ],
            },
          },
        });
      }
      if (sub === "/resources") return json({ hits: [], titles: [], mode: "keyword" });
      if (sub === "/plan/suggest") {
        return json({
          steps: [
            { title: "Re-read the arrays lecture", detail: "Pages 1-3.", estimateMinutes: 20 },
            { title: "Outline your approach", detail: "Two pointers.", estimateMinutes: 15 },
          ],
        });
      }
      if (sub === "/plan" && method === "PUT") {
        state.plan = body.steps.map((s: Partial<PlanStep>, i: number) => ({
          id: s.id ?? `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
          title: s.title,
          detail: s.detail ?? null,
          estimateMinutes: s.estimateMinutes ?? null,
          plannedFor: s.plannedFor ?? null,
          done: s.done ?? false,
        }));
        return planJson();
      }
      if (sub.startsWith("/plan/") && method === "PATCH") {
        state.plan = state.plan.map((s) => (s.id === sub.slice(6) ? { ...s, done: body.done } : s));
        return planJson();
      }
      if (sub === "/plan") return planJson();
    }
    if (p === "/api/v1/search") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const match = "contiguous".startsWith(q.slice(0, 6)) || q.includes("array");
      return json({
        mode: "keyword",
        titles: match
          ? [
              {
                kind: "document",
                id: DOC_ID,
                title: "Lecture 1.pdf",
                courseId: COURSE_ID,
                courseName: "COSC 220",
              },
            ]
          : [],
        hits: match
          ? [
              {
                chunkId: "55555555-5555-4555-8555-555555555555",
                documentId: DOC_ID,
                documentTitle: "Lecture 1.pdf",
                courseId: COURSE_ID,
                courseName: "COSC 220 Data Structures",
                anchor: { kind: "page", n: 3 },
                heading: "Page 3",
                snippet: "Arrays store elements «contiguously» in memory.",
                score: 0.03,
              },
            ]
          : [],
      });
    }
    if (p === "/api/v1/ask") {
      const events = [
        {
          type: "sources",
          sources: [
            {
              n: 1,
              documentId: DOC_ID,
              documentTitle: "Lecture 1.pdf",
              anchor: { kind: "page", n: 3 },
              heading: "Page 3",
            },
          ],
        },
        { type: "delta", text: "Arrays are stored **contiguously** " },
        { type: "delta", text: "[1]." },
        { type: "done" },
      ];
      return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    }
    if (p === "/api/v1/study/summary") {
      return json({ dueNow: state.cards?.length ?? 0, newCards: 0, reviewedToday: 0 });
    }
    if (p === "/api/v1/flashcards/due") return json({ items: state.cards });
    const reviewMatch = p.match(/^\/api\/v1\/flashcards\/([^/]+)\/review$/);
    if (reviewMatch) {
      const card = state.cards?.find((c) => c.id === reviewMatch[1]);
      if (!card) return apiError(404, "not_found", "Card not found.");
      state.cards = state.cards?.filter((c) => c.id !== card.id);
      const next = new Date(Date.now() + 3 * 86_400_000).toISOString();
      return json({ card: { ...card, due: next, reps: card.reps + 1 }, nextDue: next });
    }
    const videoMatch = p.match(/^\/api\/v1\/documents\/([^/]+)\/video$/);
    if (videoMatch) {
      const notesReady = (state.aids ?? []).some((a) => a.kind === "notes" && a.status === "ready");
      if (method === "POST") {
        state.video = {
          id: "77777777-7777-4777-8777-777777777777",
          documentId: videoMatch[1] ?? "",
          status: "ready",
          durationSeconds: 154,
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        return json(state.video, 202);
      }
      return json({ video: state.video ?? null, notesReady });
    }
    const aidsMatch = p.match(/^\/api\/v1\/documents\/([^/]+)\/aids$/);
    if (aidsMatch) {
      if (method === "POST") {
        // Generation "finishes" on the next read.
        const aid = makeAid(body.kind, {
          documentId: aidsMatch[1],
          status: "generating",
          content: null,
        });
        state.aids?.push(aid);
        setTimeout(() => {
          const ready = makeAid(body.kind, { id: aid.id, documentId: aid.documentId });
          state.aids = state.aids?.map((a) => (a.id === aid.id ? ready : a));
        }, 0);
        return json(aid, 202);
      }
      const slot = (kind: StudyAid["kind"]) => {
        const mine = (state.aids ?? []).filter(
          (a) => a.documentId === aidsMatch[1] && a.kind === kind,
        );
        return {
          current: [...mine].reverse().find((a) => a.status === "ready") ?? null,
          latest: mine.at(-1) ?? null,
        };
      };
      const aids: DocumentAids = {
        notes: slot("notes"),
        flashcards: slot("flashcards"),
        quiz: slot("quiz"),
      };
      return json(aids);
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
