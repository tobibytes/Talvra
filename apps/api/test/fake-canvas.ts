import { vi } from "vitest";

export const TOKEN = "1234~validtokenvalidtokenvalidtoken";

type Item = {
  id: number;
  title: string;
  type: string;
  content_id?: number;
  page_url?: string;
  position?: number;
};
type Module = { id: number; name: string; position: number; items: Item[] };
type Assignment = {
  id: number;
  name: string;
  due_at: string | null;
  updated_at: string;
  description?: string;
  submission_types?: string[];
};
type File = {
  id: number;
  display_name: string;
  "content-type": string;
  size: number;
  folder_id: number;
  updated_at: string;
};
type Page = { page_id: number; url: string; title: string; updated_at: string; body: string };

export type CanvasCourseState = {
  modules: Module[];
  assignments: Assignment[];
  files: File[];
  /** Course hides its Files tab: the list 403s, single files still work. */
  filesForbidden?: boolean;
  pages: Page[];
};

export type FakeCanvasState = {
  token: string;
  courses: { id: number; name: string; course_code: string; term: { name: string } }[];
  byCourse: Record<string, CanvasCourseState>;
};

export function defaultState(): FakeCanvasState {
  return {
    token: TOKEN,
    courses: [
      {
        id: 101,
        name: "COSC 220 Data Structures",
        course_code: "COSC 220",
        term: { name: "Fall 2026" },
      },
      {
        id: 102,
        name: "MATH 241 Calculus I",
        course_code: "MATH 241",
        term: { name: "Fall 2026" },
      },
    ],
    byCourse: {
      "101": {
        modules: [
          {
            id: 1,
            name: "Week 1: Arrays",
            position: 1,
            items: [
              { id: 11, title: "Lecture 1 slides", type: "File", content_id: 501, position: 1 },
              { id: 12, title: "Welcome", type: "Page", page_url: "welcome", position: 2 },
              { id: 13, title: "Lab 1", type: "Assignment", content_id: 301, position: 3 },
              { id: 14, title: "Readings", type: "SubHeader", position: 4 },
            ],
          },
          { id: 2, name: "Week 2: Lists", position: 2, items: [] },
        ],
        assignments: [
          {
            id: 301,
            name: "Lab 1",
            due_at: "2026-11-01T03:59:00Z",
            updated_at: "2026-10-01T00:00:00Z",
            submission_types: ["online_upload"],
          },
          {
            id: 302,
            name: "Homework 1",
            due_at: null,
            updated_at: "2026-10-01T00:00:00Z",
          },
        ],
        files: [
          {
            id: 501,
            display_name: "Lecture 1.pdf",
            "content-type": "application/pdf",
            size: 1234,
            folder_id: 9,
            updated_at: "2026-10-01T00:00:00Z",
          },
          {
            id: 502,
            display_name: "Syllabus.docx",
            "content-type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 999,
            folder_id: 9,
            updated_at: "2026-10-01T00:00:00Z",
          },
        ],
        pages: [
          {
            page_id: 701,
            url: "welcome",
            title: "Welcome to COSC 220",
            updated_at: "2026-10-01T00:00:00Z",
            body: "<p>Hello class</p>",
          },
        ],
      },
      "102": { modules: [], assignments: [], files: [], pages: [] },
    },
  };
}

/** A stateful fake Canvas. Mutate `state` between syncs to simulate changes. */
export function fakeCanvas(state: FakeCanvasState = defaultState()) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization");
    if (auth !== `Bearer ${state.token}`) return new Response("{}", { status: 401 });
    const p = url.pathname.replace(/^\/api\/v1/, "");
    if (p === "/users/self") return Response.json({ id: 42, name: "Test Student" });
    if (p === "/courses") return Response.json(state.courses);
    const m = p.match(/^\/courses\/(\d+)(\/.*)$/);
    const course = m ? state.byCourse[m[1] as string] : undefined;
    if (!m || !course) return new Response("not found", { status: 404 });
    const rest = m[2] as string;
    if (rest === "/modules") return Response.json(course.modules);
    if (rest === "/assignments") return Response.json(course.assignments);
    if (rest === "/files") {
      if (course.filesForbidden) return new Response("unauthorized", { status: 403 });
      return Response.json(course.files);
    }
    const file = rest.match(/^\/files\/(\d+)$/);
    if (file) {
      const f = course.files.find((x) => String(x.id) === file[1]);
      return f ? Response.json(f) : new Response("not found", { status: 404 });
    }
    if (rest === "/folders") return Response.json([{ id: 9, full_name: "course files/Lectures" }]);
    if (rest === "/pages")
      return Response.json(course.pages.map(({ body: _body, ...meta }) => meta));
    const page = rest.match(/^\/pages\/(.+)$/);
    if (page) {
      const pg = course.pages.find((x) => x.url === decodeURIComponent(page[1] as string));
      return pg ? Response.json(pg) : new Response("not found", { status: 404 });
    }
    return new Response("not found", { status: 404 });
  });
  return { fetch, state };
}
