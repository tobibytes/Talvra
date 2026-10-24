import { ApiError, CanvasCourseList, ConnectCanvasResult, CourseList, Me } from "@talvra/contracts";
import { schema } from "@talvra/db";
import { describe, expect, it, vi } from "vitest";
import { harness, signedInUser } from "./helpers.js";

const TOKEN = "1234~validtokenvalidtokenvalidtoken";

/** A fake Canvas that accepts TOKEN and serves two pages of courses. */
function fakeCanvas() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization");
    if (auth !== `Bearer ${TOKEN}`) return new Response("{}", { status: 401 });
    if (url.pathname === "/api/v1/users/self") {
      return Response.json({ id: 42, name: "Test Student" });
    }
    if (url.pathname === "/api/v1/courses") {
      if (url.searchParams.get("page") === "2") {
        return Response.json([
          { id: 103, name: "ENGL 101", course_code: "ENGL 101", term: { name: "Fall 2026" } },
        ]);
      }
      return Response.json(
        [
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
          { id: 999, access_restricted_by_date: true },
        ],
        { headers: { link: `<${url.origin}/api/v1/courses?page=2&per_page=100>; rel="next"` } },
      );
    }
    return new Response("not found", { status: 404 });
  });
}

describe("canvas connection", () => {
  it("checks the token with Canvas, then stores it encrypted", async () => {
    const canvasFetch = fakeCanvas();
    const h = await harness({ canvasFetch });
    await signedInUser(h);

    const res = await h.request("/api/v1/canvas/connection", {
      method: "PUT",
      json: { token: TOKEN },
    });
    expect(res.status).toBe(200);
    const body = ConnectCanvasResult.parse(await res.json());
    expect(body.canvasUserName).toBe("Test Student");
    expect(body.connection).toMatchObject({
      baseUrl: "https://morganstate.instructure.com",
      tokenLast4: "oken",
      status: "active",
    });

    const [row] = await h.db.select().from(schema.canvasConnections);
    const stored = new TextDecoder().decode(row?.tokenCiphertext);
    expect(stored).not.toContain(TOKEN);
    expect(JSON.stringify(await (await h.request("/api/v1/me")).json())).not.toContain(TOKEN);
  });

  it("connects one Canvas user to one Talvra account only", async () => {
    const canvasFetch = fakeCanvas();
    const h = await harness({ canvasFetch });
    const connect = () =>
      h.request("/api/v1/canvas/connection", { method: "PUT", json: { token: TOKEN } });
    await signedInUser(h, "first@morgan.edu");
    expect((await connect()).status).toBe(200);
    // Reconnecting the same account (e.g. a new token) is fine.
    expect((await connect()).status).toBe(200);
    const [first] = await h.db.select().from(schema.canvasConnections);
    expect(first?.canvasUserId).toBeTruthy();

    h.clearCookies();
    await signedInUser(h, "second@morgan.edu");
    const res = await connect();
    expect(res.status).toBe(409);
    const msg = ApiError.parse(await res.json()).error.message;
    expect(msg).toMatch(/already connected to another Talvra account/);
    expect(msg).not.toContain("first@morgan.edu");
    expect(await h.db.select().from(schema.canvasConnections)).toHaveLength(1);
  });

  it("rejects a token Canvas doesn't accept, and stores nothing", async () => {
    const h = await harness({ canvasFetch: fakeCanvas() });
    await signedInUser(h);
    const res = await h.request("/api/v1/canvas/connection", {
      method: "PUT",
      json: { token: "1234~wrongwrongwrongwrongwrong" },
    });
    expect(res.status).toBe(422);
    expect(ApiError.parse(await res.json()).error.details?.[0]?.path).toBe("token");
    expect(await h.db.select().from(schema.canvasConnections)).toHaveLength(0);
  });

  it("never calls hosts outside *.instructure.com", async () => {
    const canvasFetch = fakeCanvas();
    const h = await harness({ canvasFetch });
    await signedInUser(h);
    const res = await h.request("/api/v1/canvas/connection", {
      method: "PUT",
      json: { token: TOKEN, baseUrl: "https://169.254.169.254" },
    });
    expect(res.status).toBe(422);
    expect(canvasFetch).not.toHaveBeenCalled();
  });

  it("lists live courses across pages and saves the selection", async () => {
    const h = await harness({ canvasFetch: fakeCanvas() });
    await signedInUser(h);
    await h.request("/api/v1/canvas/connection", { method: "PUT", json: { token: TOKEN } });

    const live = CanvasCourseList.parse(await (await h.request("/api/v1/canvas/courses")).json());
    expect(live.items.map((c) => c.name)).toEqual([
      "COSC 220 Data Structures",
      "MATH 241 Calculus I",
      "ENGL 101",
    ]);
    expect(live.items.every((c) => !c.selected)).toBe(true);

    const saved = CourseList.parse(
      await (
        await h.request("/api/v1/courses/selection", {
          method: "PUT",
          json: { canvasIds: ["101", "103"] },
        })
      ).json(),
    );
    expect(saved.items.map((c) => c.name)).toEqual(["COSC 220 Data Structures", "ENGL 101"]);

    const after = CanvasCourseList.parse(await (await h.request("/api/v1/canvas/courses")).json());
    expect(after.items.filter((c) => c.selected).map((c) => c.canvasId)).toEqual(["101", "103"]);

    const bad = await h.request("/api/v1/courses/selection", {
      method: "PUT",
      json: { canvasIds: ["555"] },
    });
    expect(bad.status).toBe(422);
  });

  it("finishes onboarding once Canvas is connected", async () => {
    const h = await harness({ canvasFetch: fakeCanvas() });
    await signedInUser(h);
    await h.request("/api/v1/canvas/connection", { method: "PUT", json: { token: TOKEN } });
    const res = await h.request("/api/v1/me/onboarding/complete", { method: "POST" });
    expect(Me.parse(await res.json()).onboarded).toBe(true);
  });

  it("marks the connection invalid when Canvas later rejects the token", async () => {
    const canvasFetch = fakeCanvas();
    const h = await harness({ canvasFetch });
    await signedInUser(h);
    await h.request("/api/v1/canvas/connection", { method: "PUT", json: { token: TOKEN } });
    canvasFetch.mockImplementation(async () => new Response("{}", { status: 401 }));
    const res = await h.request("/api/v1/canvas/connection/verify", { method: "POST" });
    expect(res.status).toBe(422);
    const me = Me.parse(await (await h.request("/api/v1/me")).json());
    expect(me.canvas?.status).toBe("invalid");
  });

  it("disconnects", async () => {
    const h = await harness({ canvasFetch: fakeCanvas() });
    await signedInUser(h);
    await h.request("/api/v1/canvas/connection", { method: "PUT", json: { token: TOKEN } });
    expect((await h.request("/api/v1/canvas/connection", { method: "DELETE" })).status).toBe(204);
    expect(Me.parse(await (await h.request("/api/v1/me")).json()).canvas).toBeNull();
    expect((await h.request("/api/v1/canvas/courses")).status).toBe(409);
  });
});
